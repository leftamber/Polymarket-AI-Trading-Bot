import { ethers, TransactionResponse } from 'ethers';
import { logger } from '../logger';
import { SettingsStore } from '../settings/SettingsStore';

export class MempoolMonitor {
  private providers: Record<string, ethers.JsonRpcProvider> = {};
  private pendingTransactions: Record<string, TransactionResponse[]> = {};
  private pendingTransactionHashes: Record<string, Set<string>> = {};
  private pollIntervals: Record<string, any> = {};
  private isRunning: boolean = false;
  private store: SettingsStore;

  constructor(store: SettingsStore) {
    this.store = store;
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Mempool monitor is already running');
      return;
    }
    this.isRunning = true;
    logger.info('Starting mempool monitor...');

    const settings = this.store.get();
    for (const [network, netCfg] of Object.entries(settings.networks)) {
      // Solana is not EVM-compatible
      if (!netCfg.enabled || network === 'solana') continue;
      if (!settings.features.enableMempoolMonitor) break;

      const rpc = netCfg.mempoolRpcUrl || netCfg.rpcUrl;
      this.providers[network] = new ethers.JsonRpcProvider(rpc);
      this.pendingTransactions[network] = [];
      this.pendingTransactionHashes[network] = new Set();

      const pollInterval = netCfg.pollIntervalMs || 2000;
      this.pollIntervals[network] = setInterval(async () => {
        try {
          const provider = this.providers[network];
          if (!provider) return;
          const block = await provider.send('eth_getBlockByNumber', ['pending', true]);
          if (block && block.transactions) {
            for (const tx of block.transactions) {
              const txHash = tx.hash;
              if (!this.pendingTransactionHashes[network].has(txHash)) {
                this.pendingTransactionHashes[network].add(txHash);
                this.pendingTransactions[network].push(tx);
                const maxTx = this.store.get().trading.maxPendingTxPerNetwork || 1000;
                if (this.pendingTransactions[network].length > maxTx) {
                  this.pendingTransactions[network] = this.pendingTransactions[network].slice(-maxTx);
                  this.pendingTransactionHashes[network] = new Set(this.pendingTransactions[network].map(tx => tx.hash));
                }
              }
            }
          }
        } catch (error) {
          logger.error(`Error polling pending transactions on ${network}:`, error);
        }
      }, pollInterval);
      logger.info(`Polling pending transactions on ${network} (rpc: ${rpc}, every ${pollInterval} ms)`);
    }
    logger.info('Mempool monitor started');
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    for (const network of Object.keys(this.pollIntervals)) {
      clearInterval(this.pollIntervals[network]);
      delete this.pollIntervals[network];
    }
    this.providers = {};
    logger.info('Mempool monitor stopped');
  }

  // Hot-reload: restart with current settings
  public async reconfigure(): Promise<void> {
    if (this.isRunning) {
      await this.stop();
      await this.start();
    }
  }

  public getPendingTransactions(network?: string): Record<string, TransactionResponse[]> | TransactionResponse[] {
    if (network) {
      return this.pendingTransactions[network] || [];
    }
    return this.pendingTransactions;
  }

  public subscribeToPending(network: string, callback: (tx: TransactionResponse) => void): () => void {
    if (!this.providers[network]) {
      throw new Error(`Network ${network} not configured`);
    }
    logger.warn(`subscribeToPending is not fully implemented in polling mode for ${network}`);
    return () => {};
  }
}