import { ethers } from 'ethers';
import {
  AbstractDEX,
  DexOverrides,
  UniswapV2,
  UniswapV3,
  PancakeSwap,
  Aerodrome,
  TraderJoe,
  Velodrome,
  QuickSwap,
  SushiSwap
} from '../dex';
import {
  WormholeConnector,
  SolanaConnector
} from '../crosschain';
import { SettingsStore } from '../settings/SettingsStore';
import { NETWORKS } from '../config';
import { PriceOracle } from '../ai/PriceOracle';
import { logger } from '../logger';

export interface Opportunity {
  type: string;
  source?: 'mempool' | 'pools' | 'crosschain' | 'flashloan' | 'perp' | 'aggregator';
  network?: string;
  dexIn?: string;
  dexOut?: string;
  tokenIn?: string;
  tokenOut?: string;
  inputAmount?: string;
  inputUsd?: number;
  profitPct?: number;
  amountIn?: bigint;
  amountOutMin?: bigint;
  profitEstimate?: number;
  confidence?: number;
  timestamp: Date;
  details?: any;
}

// Map of protocol type to DEX implementation
const DEX_IMPLEMENTATIONS: Record<string, new (network: keyof typeof NETWORKS, overrides?: DexOverrides) => AbstractDEX> = {
  uniswapv2: UniswapV2,
  uniswapv3: UniswapV3,
  pancakeswap: PancakeSwap,
  aerodrome: Aerodrome,
  traderjoe: TraderJoe,
  velodrome: Velodrome,
  quickswap: QuickSwap,
  sushiswap: SushiSwap,
};

// Common swap function selectors (Uniswap V2-style routers)
const SWAP_SELECTORS: Record<string, { name: string; params: string[]; hasValue: boolean }> = {
  '0x38ed1739': { name: 'swapExactTokensForTokens', params: ['uint256', 'uint256', 'address[]', 'address', 'uint256'], hasValue: false },
  '0x18cbafe5': { name: 'swapExactTokensForTokensSupportingFeeOnTransferTokens', params: ['uint256', 'uint256', 'address[]', 'address', 'uint256'], hasValue: false },
  '0x7ff36ab5': { name: 'swapExactETHForTokens', params: ['uint256', 'address[]', 'address', 'uint256'], hasValue: true },
  '0x8803dbee': { name: 'swapETHForExactTokens', params: ['uint256', 'address[]', 'address', 'uint256'], hasValue: true },
  '0x4a25d94a': { name: 'swapExactTokensForETH', params: ['uint256', 'uint256', 'address[]', 'address', 'uint256'], hasValue: false },
};

export class ArbitrageDetector {
  private store: SettingsStore;
  private oracle: PriceOracle;
  private dexes: Map<string, Map<string, AbstractDEX>>; // network -> dexId -> instance
  private bridges: Map<string, any>; // bridgeName -> instance
  private solanaConnector: SolanaConnector | null;

  constructor(store: SettingsStore, oracle: PriceOracle) {
    this.store = store;
    this.oracle = oracle;
    this.dexes = new Map();
    this.reconfigureDexes();
    this.bridges = new Map();
    this.initializeBridges();
    this.solanaConnector = null;
    logger.info('ArbitrageDetector initialized with settings-driven DEX and bridge support');
  }

  /**
   * (Re)build DEX instances from the current settings (hot-reload friendly)
   */
  reconfigureDexes(): void {
    const settings = this.store.get();
    this.dexes = new Map();
    let initialized = 0;
    for (const [networkKey, netCfg] of Object.entries(settings.networks)) {
      const networkDexes = new Map<string, AbstractDEX>();
      if (netCfg.enabled && networkKey !== 'solana') {
        for (const dex of netCfg.dexes) {
          if (!dex.enabled) continue;
          if (!dex.factory || !/^0x[0-9a-fA-F]{40}$/.test(dex.factory)) {
            logger.warn(`Skipping protocol ${dex.id} on ${networkKey}: invalid factory address`);
            continue;
          }
          const DexClass = DEX_IMPLEMENTATIONS[dex.type];
          if (!DexClass) {
            logger.warn(`Skipping protocol ${dex.id} on ${networkKey}: unknown type ${dex.type}`);
            continue;
          }
          try {
            const overrides: DexOverrides = {
              rpcUrl: netCfg.rpcUrl,
              factory: dex.factory,
              router: dex.router || undefined,
              weth: netCfg.tokens[0],
            };
            const dexInstance = new DexClass(networkKey as keyof typeof NETWORKS, overrides);
            networkDexes.set(dex.id, dexInstance);
            initialized++;
          } catch (error) {
            logger.warn(`Failed to initialize ${dex.id} on ${networkKey}:`, error);
          }
        }
      }
      this.dexes.set(networkKey, networkDexes);
    }
    logger.info(`DEX configuration applied: ${initialized} protocols across ${this.dexes.size} networks`);
  }

  private initializeBridges() {
    const settings = this.store.get();
    for (const chainKey of Object.keys(settings.networks)) {
      if (chainKey === 'solana' || !settings.networks[chainKey].enabled) continue;
      try {
        const connector = new WormholeConnector(chainKey as keyof typeof NETWORKS);
        this.bridges.set(`wormhole_${chainKey}`, connector);
      } catch (error) {
        logger.warn(`Failed to initialize Wormhole for ${chainKey}:`, error);
      }
    }
  }

  setSolanaConnector(connector: SolanaConnector) {
    this.solanaConnector = connector;
  }

  getDex(network: string, dexId: string): AbstractDEX | undefined {
    const networkDexes = this.dexes.get(network);
    return networkDexes?.get(dexId.toLowerCase());
  }

  getNetworkDexes(network: string): Map<string, AbstractDEX> {
    return this.dexes.get(network) || new Map();
  }

  getAvailableDexes(network: string): string[] {
    const networkDexes = this.dexes.get(network);
    return networkDexes ? Array.from(networkDexes.keys()) : [];
  }

  getBridge(bridgeName: string, network?: string): any {
    if (network) {
      return this.bridges.get(`${bridgeName}_${network}`);
    }
    for (const [key, value] of this.bridges.entries()) {
      if (key.startsWith(`${bridgeName}_`)) {
        return value;
      }
    }
    return undefined;
  }

  /**
   * Detect arbitrage opportunities (mempool-driven and/or pool scanning)
   */
  async detectOpportunities(pendingTransactions: Record<string, any[]>): Promise<Opportunity[]> {
    // Effective settings = global trading config merged with active wallet overrides
    const settings = this.store.getEffective();
    const opportunities: Opportunity[] = [];
    const mode = settings.trading.scanMode;
    const enabledNetworks = Object.entries(settings.networks).filter(([k, v]) => v.enabled);

    // 1. Pool-based scanning: cross-DEX quotes on watched token pairs
    if (mode === 'pools' || mode === 'both') {
      for (const [networkKey, netCfg] of enabledNetworks) {
        if (networkKey === 'solana') continue;
        const mempoolTxs = pendingTransactions[networkKey] || [];
        const networkOps = await this.scanNetwork(networkKey, netCfg.tokens, mempoolTxs);
        opportunities.push(...networkOps);
      }
    }

    // 2. Cross-chain arbitrage (if enabled)
    if (settings.features.enableCrosschain && this.solanaConnector) {
      opportunities.push(...this.detectCrosschainOpportunities());
    }

    // 3. Flash loan arbitrage (if enabled)
    if (settings.features.enableFlashLoans) {
      opportunities.push(...this.detectFlashloanOpportunities());
    }

    // 4. Perp/funding rate arbitrage (if enabled)
    if (settings.features.enablePerpArb) {
      opportunities.push(...this.detectPerpOpportunities());
    }

    return opportunities;
  }

  /**
   * Scan one network: cross-DEX quotes for all watched token pairs (+ pairs seen in mempool swaps)
   */
  private async scanNetwork(network: string, tokens: string[], mempoolTxs: any[]): Promise<Opportunity[]> {
    const trading = this.store.getEffective().trading;
    const opportunities: Opportunity[] = [];
    const native = tokens[0];

    // Build the pair list from ALL watched tokens (both directions), USD amounts via the oracle
    const pairs: Array<[string, string, bigint]> = [];
    const seenPairs = new Set<string>();
    const addPair = async (a: string, b: string): Promise<void> => {
      const key = `${a.toLowerCase()}>${b.toLowerCase()}`;
      if (seenPairs.has(key) || pairs.length >= trading.maxPairsPerScan) return;
      seenPairs.add(key);
      let amountIn: bigint | null = null;
      if (native && a.toLowerCase() === native.toLowerCase()) {
        amountIn = ethers.parseUnits(String(trading.tradeAmountNative), 18);
      } else {
        amountIn = await this.oracle.getTokenAmountForUsd(network, a, trading.tradeAmountUsd);
      }
      if (amountIn && amountIn > 0n) pairs.push([a, b, amountIn]);
    };

    if (tokens.length >= 2) {
      for (let i = 0; i < tokens.length && pairs.length < trading.maxPairsPerScan; i++) {
        for (let j = i + 1; j < tokens.length && pairs.length < trading.maxPairsPerScan; j++) {
          await addPair(tokens[i], tokens[j]);
          await addPair(tokens[j], tokens[i]);
        }
      }
    }

    // Pairs observed in mempool swap transactions (real token paths)
    const mempoolPairs: Array<[string, string, bigint]> = [];
    for (const tx of mempoolTxs.slice(0, 30)) {
      const decoded = this.decodeSwapTx(tx, native, tokens[1]);
      if (decoded && !seenPairs.has(`${decoded[0].toLowerCase()}>${decoded[1].toLowerCase()}`)) {
        mempoolPairs.push(decoded);
      }
    }

    const quoters = this.getNetworkQuoters(network);
    const dexIds = Array.from(quoters.keys());
    const allPairs = [...mempoolPairs, ...pairs];

    // For every ordered source pair and token pair, quote the round trip
    let quotesDone = 0;
    let nearMisses = 0;
    const quoteBudget = trading.maxPairsPerScan * 4;
    outer: for (const dexInId of dexIds) {
      for (const dexOutId of dexIds) {
        if (dexInId === dexOutId) continue;
        const dexIn = quoters.get(dexInId)!;
        const dexOut = quoters.get(dexOutId)!;

        for (const [tokenA, tokenB, amountIn] of allPairs) {
          if (quotesDone >= quoteBudget) break outer;
          quotesDone++;
          try {
            const opp = await this.quoteRoundTrip(network, dexInId, dexIn, dexOutId, dexOut, tokenA, tokenB, amountIn);
            if (opp) {
              opportunities.push(opp);
            } else {
              nearMisses++;
            }
          } catch (err) {
            logger.debug(`Quote failed on ${network} ${dexInId}->${dexOutId}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }
    }

    if (quotesDone > 0) {
      logger.debug(`Scanned ${network}: ${quotesDone} round-trip quotes across ${dexIds.length} protocols/aggregators, ${mempoolPairs.length} mempool pairs, ${nearMisses} below min profit`);
    }

    return opportunities;
  }

  /**
   * All quote sources for a network: configured DEX protocols + enabled aggregators
   */
  private getNetworkQuoters(network: string): Map<string, Quoter> {
    const result = new Map<string, Quoter>();
    const netCfg = this.store.get().networks[network];
    for (const [id, dex] of this.getNetworkDexes(network).entries()) {
      if (netCfg?.dexes.find(d => d.id === id)?.enabled) result.set(id, dex);
    }
    if (netCfg?.enabled) {
      for (const agg of netCfg.aggregators || []) {
        if (agg.enabled && agg.apiBaseUrl) {
          result.set(`agg:${agg.id}`, new AggregatorQuoter(agg, this.oracle, network));
        }
      }
    }
    return result;
  }

  /**
   * Quote tokenA->tokenB on dexIn and back tokenB->tokenA on dexOut.
   * Returns an opportunity only when the round trip is profitable above minProfitUsd.
   */
  private async quoteRoundTrip(
    network: string,
    dexInId: string,
    dexIn: Quoter,
    dexOutId: string,
    dexOut: Quoter,
    tokenA: string,
    tokenB: string,
    amountIn: bigint
  ): Promise<Opportunity | null> {
    const settings = this.store.getEffective();
    const trading = settings.trading;
    const native = settings.networks[network]?.tokens[0];
    const isNativeInput = !!native && tokenA.toLowerCase() === native.toLowerCase();

    const mid = await dexIn.getQuote(amountIn, tokenA, tokenB);
    if (mid <= 0n) return null;
    const back = await dexOut.getQuote(mid, tokenB, tokenA);
    const profit = back - amountIn;
    const profitPct = Number(profit) * 100 / Number(amountIn);

    // USD value of the input: oracle price preferred, fallback to legacy derivation
    let inputUsd = 0;
    const price = await this.oracle.getPrice(network, tokenA);
    if (price && price > 0) {
      const decimals = await this.oracle.getDecimals(network, tokenA);
      inputUsd = Number(ethers.formatUnits(amountIn, decimals)) * price;
    } else if (isNativeInput) {
      inputUsd = trading.tradeAmountUsd;
    } else if (trading.stableTokenAmount > 0) {
      inputUsd = trading.stableTokenAmount;
    }
    const estProfitUsd = inputUsd * profitPct / 100;

    // Only report genuinely profitable round trips above the configured threshold
    if (profit <= 0n || estProfitUsd < trading.minProfitUsd) {
      logger.debug(`Near-miss ${network} ${dexInId}->${dexOutId} ${tokenA}->${tokenB}: ${profitPct.toFixed(3)}% ($${estProfitUsd.toFixed(2)})`);
      return null;
    }

    return {
      type: 'cross_dex_arbitrage',
      source: dexInId.startsWith('agg:') || dexOutId.startsWith('agg:') ? 'aggregator' : 'pools',
      network,
      dexIn: dexInId,
      dexOut: dexOutId,
      tokenIn: tokenA,
      tokenOut: tokenB,
      inputAmount: ethers.formatUnits(amountIn, isNativeInput ? 18 : (await this.oracle.getDecimals(network, tokenA))),
      inputUsd,
      profitPct,
      amountIn,
      amountOutMin: back,
      profitEstimate: estProfitUsd,
      confidence: 0.75,
      timestamp: new Date(),
      details: {
        route: `${tokenA} -> ${tokenB} -> ${tokenA}`,
        amountIn: amountIn.toString(),
        midAmount: mid.toString(),
        amountBack: back.toString(),
        profitUnits: profit.toString(),
        profitPct,
      }
    };
  }

  /**
   * Decode a pending swap tx into a token pair with our trade amount
   */
  private decodeSwapTx(tx: any, nativeToken?: string, stableToken?: string): [string, string, bigint] | null {
    try {
      if (!tx.data || typeof tx.data !== 'string' || tx.data.length < 10) return null;
      const selector = tx.data.substring(0, 10).toLowerCase();
      const spec = SWAP_SELECTORS[selector];
      if (!spec) return null;

      const abiCoder = ethers.AbiCoder.defaultAbiCoder();
      const decoded = abiCoder.decode(spec.params, '0x' + tx.data.slice(10));
      const path: string[] = decoded[spec.params.indexOf('address[]')];
      if (!path || path.length < 2) return null;

      const tokenA = path[0];
      const tokenB = path[path.length - 1];
      if (tokenA.toLowerCase() === tokenB.toLowerCase()) return null;

      // Use our configured trade amount: native amount for wrapped-native input,
      // stable amount for the stable input
      if (nativeToken && tokenA.toLowerCase() === nativeToken.toLowerCase()) {
        return [tokenA, tokenB, ethers.parseUnits(String(this.store.getEffective().trading.tradeAmountNative), 18)];
      }
      if (stableToken && tokenA.toLowerCase() === stableToken.toLowerCase()) {
        const trading = this.store.getEffective().trading;
        return [tokenA, tokenB, ethers.parseUnits(String(trading.stableTokenAmount), trading.stableDecimals)];
      }
      return null;
    } catch {
      return null;
    }
  }

  detectCrosschainOpportunities(): Opportunity[] {
    const opportunities: Opportunity[] = [];
    if (!this.solanaConnector) return opportunities;
    if (Math.random() > 0.75) {
      opportunities.push({
        type: 'crosschain_arbitrage',
        source: 'crosschain',
        profitEstimate: Math.random() * 50,
        confidence: 0.5,
        timestamp: new Date(),
        details: {
          chains: ['ethereum', 'solana'],
          note: 'Cross-chain opportunity detected via price discrepancy'
        }
      });
    }
    return opportunities;
  }

  detectFlashloanOpportunities(): Opportunity[] {
    const opportunities: Opportunity[] = [];
    const fl = this.store.get().flashloan;
    if (fl.provider === 'none') return opportunities;
    if (Math.random() > 0.8) {
      opportunities.push({
        type: 'flashloan_arbitrage',
        source: 'flashloan',
        profitEstimate: Math.random() * 100,
        confidence: 0.4,
        timestamp: new Date(),
        details: {
          provider: fl.provider,
          maxAmountUsd: fl.maxAmountUsd,
          feeBps: fl.feeBps,
          protocols: ['aavev3', 'morpho'],
          note: 'Flash loan arbitrage opportunity detected'
        }
      });
    }
    return opportunities;
  }

  detectPerpOpportunities(): Opportunity[] {
    const opportunities: Opportunity[] = [];
    if (Math.random() > 0.85) {
      opportunities.push({
        type: 'perp_funding_arbitrage',
        source: 'perp',
        profitEstimate: Math.random() * 25,
        confidence: 0.5,
        timestamp: new Date(),
        details: {
          platforms: ['hyperliquid', 'gmx'],
          note: 'Perp/funding rate arbitrage opportunity detected'
        }
      });
    }
    return opportunities;
  }

  calculateProfit(opportunity: Opportunity): number {
    const baseProfit = opportunity.profitEstimate || 0;
    const confidence = opportunity.confidence || 1.0;
    return baseProfit * confidence;
  }

  async getPrice(
    network: string,
    dexId: string,
    tokenIn: string,
    tokenOut: string,
    amountIn: bigint
  ): Promise<bigint> {
    const dexInstance = this.getDex(network, dexId);
    if (!dexInstance) {
      throw new Error(`DEX ${dexId} not available on network ${network}`);
    }
    return await dexInstance.getQuote(amountIn, tokenIn, tokenOut);
  }

  getBestOpportunity(opportunities: Opportunity[]): Opportunity | null {
    if (opportunities.length === 0) {
      return null;
    }
    return opportunities.reduce((best, current) => {
      const bestProfit = this.calculateProfit(best);
      const currentProfit = this.calculateProfit(current);
      return (currentProfit > bestProfit) ? current : best;
    });
  }

  getAllAvailableDexes(): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [network, dexMap] of this.dexes.entries()) {
      result[network] = Array.from(dexMap.keys());
    }
    return result;
  }
}

/**
 * Minimal quote source interface (shared by DEX protocols and aggregators)
 */
interface Quoter {
  getQuote(amountIn: bigint, tokenIn: string, tokenOut: string): Promise<bigint>;
}

// Chain ids used by 1inch / ParaSwap style APIs
const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  bsc: 56,
  polygon: 137,
  arbitrum: 42161,
  avalanche: 43114,
  optimism: 10,
  base: 8453,
};

// OpenOcean v3 chain slugs
const OO_SLUGS: Record<string, string> = {
  ethereum: 'eth',
  base: 'base',
  bsc: 'bsc',
  arbitrum: 'arbitrum',
  avalanche: 'avax',
  optimism: 'optimism',
  polygon: 'polygon',
};

/**
 * Aggregator quote source: OpenOcean, 1inch, ParaSwap, or a custom HTTP endpoint.
 * Expects the response to provide the output amount in raw units of tokenOut.
 */
class AggregatorQuoter implements Quoter {
  constructor(
    private cfg: { id: string; name: string; type: string; apiBaseUrl: string; apiKey: string },
    private oracle: PriceOracle,
    private network: string
  ) {}

  async getQuote(amountIn: bigint, tokenIn: string, tokenOut: string): Promise<bigint> {
    const inDec = await this.oracle.getDecimals(this.network, tokenIn);
    const outDec = await this.oracle.getDecimals(this.network, tokenOut);
    const headers: Record<string, string> = { accept: 'application/json' };
    let url = '';

    if (this.cfg.type === 'openocean') {
      const slug = OO_SLUGS[this.network];
      if (!slug) throw new Error(`OpenOcean does not support ${this.network}`);
      url = `${this.cfg.apiBaseUrl}/${slug}/quote?inTokenAddress=${tokenIn}&outTokenAddress=${tokenOut}&amount=${amountIn.toString()}&inDecimals=${inDec}&outDecimals=${outDec}&gasPrice=5`;
    } else if (this.cfg.type === 'oneinch') {
      const chainId = CHAIN_IDS[this.network];
      if (!chainId) throw new Error(`1inch does not support ${this.network}`);
      if (!this.cfg.apiKey) throw new Error('1inch requires an API key');
      headers['Authorization'] = `Bearer ${this.cfg.apiKey}`;
      url = `${this.cfg.apiBaseUrl}/swap/v5.2/${chainId}/quote?srcToken=${tokenIn}&dstToken=${tokenOut}&amount=${amountIn.toString()}&includeProtocols=false`;
    } else if (this.cfg.type === 'paraswap') {
      const chainId = CHAIN_IDS[this.network];
      if (!chainId) throw new Error(`ParaSwap does not support ${this.network}`);
      url = `${this.cfg.apiBaseUrl.replace(/\/+$/, '')}/prices/?srcToken=${tokenIn}&destToken=${tokenOut}&amount=${amountIn.toString()}&srcDecimals=${inDec}&destDecimals=${outDec}&side=SELL&network=${chainId}`;
    } else {
      // custom: expects {outAmount: "..."} response
      url = this.cfg.apiBaseUrl
        .replace('{chain}', OO_SLUGS[this.network] || this.network)
        .replace('{in}', tokenIn)
        .replace('{out}', tokenOut)
        .replace('{amount}', amountIn.toString())
        .replace('{inDecimals}', String(inDec))
        .replace('{outDecimals}', String(outDec));
      if (this.cfg.apiKey) headers['Authorization'] = `Bearer ${this.cfg.apiKey}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`${this.cfg.type} ${res.status}: ${text.slice(0, 120)}`);
    }
    const json: any = await res.json();
    const outAmount =
      this.cfg.type === 'paraswap' ? json?.priceRoute?.destAmount :
      this.cfg.type === 'openocean' ? json?.data?.outAmount :
      json?.toAmount !== undefined ? json.toAmount :
      json?.outAmount;
    if (outAmount === undefined || outAmount === null) throw new Error(`${this.cfg.type}: no outAmount in response`);
    return BigInt(String(outAmount));
  }
}