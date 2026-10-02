import { ethers } from 'ethers';
import { OracleConfig, SettingsStore } from '../settings/SettingsStore';
import { logger } from '../logger';

const ERC20_ABI = [
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

// DefiLlama chain slugs
const LLAMA_CHAINS: Record<string, string> = {
  ethereum: 'ethereum',
  base: 'base',
  bsc: 'bsc',
  arbitrum: 'arbitrum',
  avalanche: 'avalanche',
  optimism: 'optimism',
  polygon: 'polygon',
  solana: 'solana',
};

// CoinGecko platform ids
const COINGECKO_PLATFORMS: Record<string, string> = {
  ethereum: 'ethereum',
  base: 'base',
  bsc: 'binance-smart-chain',
  arbitrum: 'arbitrum-one',
  avalanche: 'avalanche',
  optimism: 'optimistic-ethereum',
  polygon: 'matic-pos-network',
};

interface PriceEntry {
  price: number;
  ts: number;
}

export interface PriceSnapshot {
  network: string;
  token: string;
  price: number;
}

/**
 * Price oracle + token metadata service (decimals caching, USD price lookups).
 * Providers: DeFi Llama (free), CoinGecko (optional key), custom coingecko-compatible endpoint.
 */
export class PriceOracle {
  private store: SettingsStore;
  private priceCache: Map<string, PriceEntry> = new Map(); // network:address -> price
  private decimalsCache: Map<string, number> = new Map();  // network:address -> decimals
  private symbolsCache: Map<string, string> = new Map();   // network:address -> symbol
  private providers: Map<string, ethers.JsonRpcProvider> = new Map();

  constructor(store: SettingsStore) {
    this.store = store;
  }

  private key(network: string, address: string): string {
    return `${network}:${address.toLowerCase()}`;
  }

  private getProvider(network: string): ethers.JsonRpcProvider | undefined {
    const netCfg = this.store.get().networks[network];
    if (!netCfg) return undefined;
    let p = this.providers.get(network);
    if (!p) {
      p = new ethers.JsonRpcProvider(netCfg.rpcUrl);
      this.providers.set(network, p);
    }
    return p;
  }

  async getDecimals(network: string, address: string): Promise<number> {
    const k = this.key(network, address);
    const cached = this.decimalsCache.get(k);
    if (cached !== undefined) return cached;
    const provider = this.getProvider(network);
    if (!provider || !/^0x[0-9a-fA-F]{40}$/.test(address)) return 18;
    try {
      const c = new ethers.Contract(address, ERC20_ABI, provider);
      const dec = Number(await c.decimals());
      this.decimalsCache.set(k, dec);
      return dec;
    } catch {
      this.decimalsCache.set(k, 18);
      return 18;
    }
  }

  async getSymbol(network: string, address: string): Promise<string> {
    const k = this.key(network, address);
    const cached = this.symbolsCache.get(k);
    if (cached !== undefined) return cached;
    const provider = this.getProvider(network);
    if (!provider || !/^0x[0-9a-fA-F]{40}$/.test(address)) return address.slice(0, 6);
    try {
      const c = new ethers.Contract(address, ERC20_ABI, provider);
      const sym: string = await c.symbol();
      this.symbolsCache.set(k, sym);
      return sym;
    } catch {
      this.symbolsCache.set(k, address.slice(0, 6));
      return address.slice(0, 6);
    }
  }

  /**
   * USD price for a token (cached for cacheTtlSec). Returns null when unavailable.
   */
  async getPrice(network: string, address: string): Promise<number | null> {
    const cfg = this.store.get().oracle;
    const ttl = (cfg.cacheTtlSec || 60) * 1000;
    const k = this.key(network, address);
    const cached = this.priceCache.get(k);
    if (cached && Date.now() - cached.ts < ttl) return cached.price;

    const price = await this.fetchPrices(network, [address])
      .then(m => m.get(address.toLowerCase()) ?? null)
      .catch(() => null);
    if (price !== null && price > 0) {
      this.priceCache.set(k, { price, ts: Date.now() });
      return price;
    }
    return cached ? cached.price : null;
  }

  /**
   * Fetch USD prices for multiple tokens in one request.
   */
  async fetchPrices(network: string, addresses: string[]): Promise<Map<string, number>> {
    const cfg: OracleConfig = this.store.get().oracle;
    const out = new Map<string, number>();
    const evm = addresses.filter(a => /^0x[0-9a-fA-F]{40}$/.test(a));
    if (evm.length === 0) return out;

    try {
      if (cfg.provider === 'defillama') {
        const chain = LLAMA_CHAINS[network];
        if (!chain) return out;
        const coinsParam = evm.map(a => `${chain}:${a}`).join(',');
        const res = await fetch(`https://coins.llama.fi/prices/current/${coinsParam}`);
        if (!res.ok) throw new Error(`defillama ${res.status}`);
        const json: any = await res.json();
        const coins: Record<string, { price: number }> = json.coins || {};
        for (const [key, val] of Object.entries(coins)) {
          const addr = key.split(':').pop()?.toLowerCase();
          if (addr && val?.price) out.set(addr, val.price);
        }
      } else {
        // coingecko or custom (coingecko-compatible)
        const platform = COINGECKO_PLATFORMS[network];
        if (!platform) return out;
        const base = cfg.provider === 'coingecko'
          ? 'https://api.coingecko.com/api/v3'
          : (cfg.apiBaseUrl || '').replace(/\/+$/, '');
        if (!base) return out;
        const url = `${base}/simple/token_price/${platform}?contract_addresses=${evm.join(',')}&vs_currencies=usd`;
        const headers: Record<string, string> = { accept: 'application/json' };
        if (cfg.apiKey) headers['x-cg-pro-api-key'] = cfg.apiKey;
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`oracle ${res.status}`);
        const json: Record<string, { usd: number }> = await res.json() as Record<string, { usd: number }>;
        for (const [addr, val] of Object.entries(json)) {
          if (val?.usd) out.set(addr.toLowerCase(), val.usd);
        }
      }
    } catch (err) {
      logger.debug(`Oracle fetch failed (${cfg.provider}/${network}): ${err instanceof Error ? err.message : String(err)}`);
    }
    return out;
  }

  /**
   * Convert a USD amount into raw token units for a given token.
   */
  async getTokenAmountForUsd(network: string, address: string, usd: number): Promise<bigint | null> {
    const price = await this.getPrice(network, address);
    if (price === null || price <= 0) return null;
    const decimals = await this.getDecimals(network, address);
    const amount = usd / price;
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return ethers.parseUnits(amount.toFixed(Math.min(decimals, 18)), decimals);
  }

  /**
   * Snapshot of all watched token prices (for dashboard / AI)
   */
  async getSnapshot(): Promise<PriceSnapshot[]> {
    const settings = this.store.get();
    const out: PriceSnapshot[] = [];
    for (const [network, cfg] of Object.entries(settings.networks)) {
      if (!cfg.enabled) continue;
      const prices = await this.fetchPrices(network, cfg.tokens);
      for (const token of cfg.tokens) {
        const p = prices.get(token.toLowerCase()) ?? this.priceCache.get(this.key(network, token))?.price;
        if (p) out.push({ network, token, price: p });
      }
    }
    return out;
  }
}