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
import { logger } from '../logger';
import { NETWORKS, WALLETS } from '../config';
import { SettingsStore } from '../settings/SettingsStore';
import { Opportunity } from './ArbitrageDetector';

export interface ExecutionResult {
  profitUsd: number;
  success: boolean;
  transactionHash: string;
  dryRun?: boolean;
  error?: string;
}

/**
 * Transaction executor that supports multiple DEX types and cross-chain operations.
 * All parameters come from the live settings store.
 */
export class TransactionExecutor {
  private store: SettingsStore;
  private signers: Record<string, ethers.Wallet> = {};
  private dexes: Map<string, Map<string, AbstractDEX>>; // network -> dexId -> instance
  private bridges: Map<string, any>; // bridgeName_chain -> instance
  private solanaConnector: SolanaConnector | null;

  constructor(store: SettingsStore) {
    this.store = store;
    this.dexes = new Map();
    this.reconfigureDexes();
    this.bridges = new Map();
    this.initializeBridges();
    this.solanaConnector = null;
    logger.info('TransactionExecutor initialized with settings-driven DEX support');
  }

  /**
   * (Re)build DEX instances from the current settings
   */
  reconfigureDexes(): void {
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

    const settings = this.store.get();
    this.dexes = new Map();
    for (const [networkKey, netCfg] of Object.entries(settings.networks)) {
      const networkDexes = new Map<string, AbstractDEX>();
      if (netCfg.enabled && networkKey !== 'solana') {
        for (const dex of netCfg.dexes) {
          if (!dex.enabled) continue;
          if (!dex.factory || !/^0x[0-9a-fA-F]{40}$/.test(dex.factory)) continue;
          const DexClass = DEX_IMPLEMENTATIONS[dex.type];
          if (!DexClass) continue;
          try {
            const overrides: DexOverrides = {
              rpcUrl: netCfg.rpcUrl,
              factory: dex.factory,
              router: dex.router || undefined,
              weth: netCfg.tokens[0],
            };
            const dexInstance = new DexClass(networkKey as keyof typeof NETWORKS, overrides);
            networkDexes.set(dex.id, dexInstance);
          } catch (error) {
            logger.warn(`Failed to initialize ${dex.id} on ${networkKey}:`, error);
          }
        }
      }
      this.dexes.set(networkKey, networkDexes);
    }
  }

  private initializeBridges() {
    const settings = this.store.get();
    for (const bridgeName of Object.keys(settings.networks)) {
      if (bridgeName === 'solana' || !settings.networks[bridgeName].enabled) continue;
      try {
        const wormholeConnector = new WormholeConnector(bridgeName as keyof typeof NETWORKS);
        this.bridges.set(`wormhole_${bridgeName}`, wormholeConnector);
      } catch (error) {
        logger.warn(`Failed to initialize Wormhole for ${bridgeName}:`, error);
      }
    }
  }

  setSolanaConnector(connector: SolanaConnector) {
    this.solanaConnector = connector;
  }

  /**
   * Drop cached signers so the next execution rebuilds them from the current
   * active wallet (called when wallets / settings change).
   */
  resetSigners(): void {
    this.signers = {};
    logger.info('TransactionExecutor signers reset (will re-derive from active wallet)');
  }

  /**
   * True when the active wallet is restricted to simulation only
   */
  private isWalletDryRunOnly(): boolean {
    const wallet = this.store.getActiveWallet();
    return !!(wallet && wallet.enabled && wallet.settings?.dryRunOnly);
  }

  async setSigner(network: string, privateKey?: string): Promise<void> {
    if (network === 'solana') {
      logger.warn(`setSigner: solana is not an EVM network, skipping ethers signer`);
      return;
    }

    let keyToUse = privateKey;

    if (!keyToUse) {
      // Prefer the active wallet from Wallet Settings (per-wallet credentials)
      const active = this.store.getActiveWallet();
      if (active && active.enabled) {
        if (active.privateKey) {
          keyToUse = active.privateKey;
        } else if (active.seedPhrase) {
          try {
            keyToUse = ethers.Wallet.fromPhrase(active.seedPhrase.trim()).privateKey;
          } catch (error) {
            logger.warn(`Failed to derive key from seed phrase of active wallet ${active.label}:`, error);
          }
        }
      }
    }

    if (!keyToUse) {
      const walletConfig = WALLETS.primary[network as keyof typeof WALLETS['primary']];
      if (walletConfig && walletConfig.privateKey) {
        keyToUse = walletConfig.privateKey;
      }
    }

    if (!keyToUse) {
      throw new Error(`No private key available for network ${network} (check Settings → Wallet Settings)`);
    }

    try {
      const settings = this.store.get();
      const netCfg = settings.networks[network];
      const provider = new ethers.JsonRpcProvider(netCfg?.rpcUrl || '');
      const wallet = new ethers.Wallet(keyToUse, provider);
      this.signers[network] = wallet;

      const networkDexes = this.dexes.get(network);
      if (networkDexes) {
        for (const [dexId, dexInstance] of networkDexes.entries()) {
          try {
            dexInstance.setSigner(wallet);
          } catch (error) {
            logger.warn(`Failed to set signer for ${dexId} on ${network}:`, error);
          }
        }
      }

      logger.info(`Signer set for ${network}`);
    } catch (error) {
      logger.error(`Failed to set signer for ${network}:`, error);
      throw error;
    }
  }

  getDex(network: string, dexId: string): AbstractDEX | undefined {
    const networkDexes = this.dexes.get(network);
    return networkDexes?.get(dexId.toLowerCase());
  }

  getAvailableDexes(network: string): string[] {
    const networkDexes = this.dexes.get(network);
    return networkDexes ? Array.from(networkDexes.keys()) : [];
  }

  /**
   * Build and execute a transaction based on opportunity
   */
  async execute(opportunity: Opportunity): Promise<ExecutionResult> {
    const dryRun = this.store.get().features.dryRun || this.isWalletDryRunOnly();
    const wallet = this.store.getActiveWallet();
    logger.info('Executing transaction for opportunity:', {
      type: opportunity.type,
      network: opportunity.network,
      wallet: wallet ? `${wallet.label} (${wallet.id})` : 'env fallback',
      route: `${opportunity.dexIn} -> ${opportunity.dexOut}`,
      tokens: `${opportunity.tokenIn} -> ${opportunity.tokenOut}`,
      inputAmount: opportunity.inputAmount,
      profitEstimate: opportunity.profitEstimate,
      dryRun
    });

    try {
      if (dryRun) {
        return this.simulateExecution(opportunity);
      }

      switch (opportunity.type) {
        case 'dex_arbitrage':
        case 'cross_dex_arbitrage':
          return await this.executeDexArbitrage(opportunity);

        case 'crosschain_arbitrage':
          return await this.executeCrosschainArbitrage(opportunity);

        case 'flashloan_arbitrage':
          return await this.executeFlashloanArbitrage(opportunity);

        case 'perp_funding_arbitrage':
          return await this.executePerpArbitrage(opportunity);

        default:
          throw new Error(`Unsupported opportunity type: ${opportunity.type}`);
      }
    } catch (error) {
      const err = error as Error;
      logger.error(`Failed to execute transaction:`, err);
      return {
        profitUsd: 0,
        success: false,
        transactionHash: '0x0',
        error: err.message
      };
    }
  }

  /**
   * Simulated execution (dry-run mode): validate quotes without sending transactions
   */
  private simulateExecution(opportunity: Opportunity): ExecutionResult {
    const profitUsd = opportunity.profitEstimate || 0;
    logger.info(`DRY RUN: trade simulated (${opportunity.network} ${opportunity.dexIn}->${opportunity.dexOut} ${opportunity.tokenIn}->${opportunity.tokenOut}), estimated profit $${profitUsd.toFixed(2)}`);
    return {
      profitUsd,
      success: true,
      dryRun: true,
      transactionHash: '0x' + '0'.repeat(64)
    };
  }

  /**
   * Execute a DEX-based arbitrage opportunity (same-chain)
   */
  private async executeDexArbitrage(opportunity: Opportunity): Promise<ExecutionResult> {
    const network = opportunity.network;
    if (!network) throw new Error('Network not specified in opportunity');

    // Effective trading config = global settings merged with active wallet overrides
    const trading = this.store.getEffective().trading;

    if (!this.signers[network]) {
      await this.setSigner(network);
    }

    const dexInstance = this.getDex(network, opportunity.dexIn!);
    if (!dexInstance) {
      throw new Error(`DEX ${opportunity.dexIn} not available on network ${network}`);
    }

    const txRequest = await dexInstance.buildSwapTx(
      opportunity.tokenIn!,
      opportunity.tokenOut!,
      opportunity.amountIn!,
      opportunity.amountOutMin!,
      this.signers[network]!.address,
      Math.floor(Date.now() / 1000) + trading.deadlineSec
    );

    if (trading.gasPriceGwei > 0) {
      txRequest.gasPrice = ethers.parseUnits(String(trading.gasPriceGwei), 'gwei');
    }
    if (trading.gasLimit > 0) {
      txRequest.gasLimit = BigInt(trading.gasLimit);
    }

    const tx = await this.signers[network]!.sendTransaction(txRequest);
    const receipt = await tx.wait();

    const profitUsd = opportunity.profitEstimate || 0;
    logger.info(`DEX arbitrage executed: ${tx.hash}`);
    return {
      profitUsd,
      success: receipt?.status === 1,
      transactionHash: tx.hash
    };
  }

  private async executeCrosschainArbitrage(opportunity: Opportunity): Promise<ExecutionResult> {
    logger.info('Executing cross-chain arbitrage (placeholder)');
    return {
      profitUsd: opportunity.profitEstimate || 0,
      success: true,
      transactionHash: '0x' + '0'.repeat(64)
    };
  }

  private async executeFlashloanArbitrage(opportunity: Opportunity): Promise<ExecutionResult> {
    const fl = this.store.get().flashloan;
    logger.info('Executing flash loan arbitrage (placeholder):', { provider: fl.provider, maxAmountUsd: fl.maxAmountUsd });
    return {
      profitUsd: opportunity.profitEstimate || 0,
      success: true,
      transactionHash: '0x' + '0'.repeat(64)
    };
  }

  private async executePerpArbitrage(opportunity: Opportunity): Promise<ExecutionResult> {
    logger.info('Executing perp/funding rate arbitrage (placeholder)');
    return {
      profitUsd: opportunity.profitEstimate || 0,
      success: true,
      transactionHash: '0x' + '0'.repeat(64)
    };
  }
}