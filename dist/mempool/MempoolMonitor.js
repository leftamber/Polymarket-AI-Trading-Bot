"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MempoolMonitor = void 0;
const ethers_1 = require("ethers");
const logger_1 = require("../logger");
class MempoolMonitor {
    constructor(store) {
        this.providers = {};
        this.pendingTransactions = {};
        this.pendingTransactionHashes = {};
        this.pollIntervals = {};
        this.isRunning = false;
        this.store = store;
    }
    async start() {
        if (this.isRunning) {
            logger_1.logger.warn('Mempool monitor is already running');
            return;
        }
        this.isRunning = true;
        logger_1.logger.info('Starting mempool monitor...');
        const settings = this.store.get();
        for (const [network, netCfg] of Object.entries(settings.networks)) {
            // Solana is not EVM-compatible
            if (!netCfg.enabled || network === 'solana')
                continue;
            if (!settings.features.enableMempoolMonitor)
                break;
            const rpc = netCfg.mempoolRpcUrl || netCfg.rpcUrl;
            this.providers[network] = new ethers_1.ethers.JsonRpcProvider(rpc);
            this.pendingTransactions[network] = [];
            this.pendingTransactionHashes[network] = new Set();
            const pollInterval = netCfg.pollIntervalMs || 2000;
            this.pollIntervals[network] = setInterval(async () => {
                try {
                    const provider = this.providers[network];
                    if (!provider)
                        return;
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
                }
                catch (error) {
                    logger_1.logger.error(`Error polling pending transactions on ${network}:`, error);
                }
            }, pollInterval);
            logger_1.logger.info(`Polling pending transactions on ${network} (rpc: ${rpc}, every ${pollInterval} ms)`);
        }
        logger_1.logger.info('Mempool monitor started');
    }
    async stop() {
        if (!this.isRunning)
            return;
        this.isRunning = false;
        for (const network of Object.keys(this.pollIntervals)) {
            clearInterval(this.pollIntervals[network]);
            delete this.pollIntervals[network];
        }
        this.providers = {};
        logger_1.logger.info('Mempool monitor stopped');
    }
    // Hot-reload: restart with current settings
    async reconfigure() {
        if (this.isRunning) {
            await this.stop();
            await this.start();
        }
    }
    getPendingTransactions(network) {
        if (network) {
            return this.pendingTransactions[network] || [];
        }
        return this.pendingTransactions;
    }
    subscribeToPending(network, callback) {
        if (!this.providers[network]) {
            throw new Error(`Network ${network} not configured`);
        }
        logger_1.logger.warn(`subscribeToPending is not fully implemented in polling mode for ${network}`);
        return () => { };
    }
}
exports.MempoolMonitor = MempoolMonitor;
