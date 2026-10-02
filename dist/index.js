"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArbAiBot = void 0;
const MempoolMonitor_1 = require("./mempool/MempoolMonitor");
const ArbitrageDetector_1 = require("./trading/ArbitrageDetector");
const TransactionExecutor_1 = require("./trading/TransactionExecutor");
const RiskManager_1 = require("./risk/RiskManager");
const logger_1 = require("./logger");
const SettingsStore_1 = require("./settings/SettingsStore");
const server_1 = require("./web/server");
const utils_1 = require("./utils");
const PriceOracle_1 = require("./ai/PriceOracle");
const AiAgent_1 = require("./ai/AiAgent");
const TOKEN_SYMBOLS = {
    '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
    '0x4200000000000000000000000000000000000006': 'WETH',
    '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 'WETH',
    '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': 'WBNB',
    '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': 'WMATIC',
    '0xb31f66aa3c1e785363f0875a1b74e27b85fd9c63': 'WAVAX',
    '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
    '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC',
    '0x0b2c639c533813f4aa9d7837caf62653d097ff85': 'USDC',
    '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e': 'USDC',
    '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': 'USDC',
    '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
    '0x55d398326f99059ff775485246999027b3197955': 'USDT',
    '0xe9e7cea3dedca5984780bafc599bd69add087d56': 'BUSD',
    '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'USDT',
    '0x970229a8a518b4ede774191bfade9e3414391742': 'USDT.e',
    '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 'USDT',
};
class ArbAiBot {
    constructor(store) {
        this.isRunning = false;
        this.lastSettingsVersion = 0;
        this.aiAnalysisTimer = null;
        // Stats tracking
        this.totalProfit = 0;
        this.totalTrades = 0;
        this.successfulTrades = 0;
        this.opportunitiesFound = 0;
        this.logs = [];
        this.walletBalances = {};
        this.profitHistory = [];
        this.recentOpportunities = [];
        this.startedAt = 0;
        this.dayStartProfit = 0;
        this.store = store;
        this.lastSettingsVersion = store.getVersion();
        this.oracle = new PriceOracle_1.PriceOracle(store);
        this.mempoolMonitor = new MempoolMonitor_1.MempoolMonitor(store);
        this.arbitrageDetector = new ArbitrageDetector_1.ArbitrageDetector(store, this.oracle);
        this.transactionExecutor = new TransactionExecutor_1.TransactionExecutor(store);
        this.riskManager = new RiskManager_1.RiskManager(store);
        this.aiAgent = new AiAgent_1.AiAgent(store, this.oracle, {
            getStats: () => this.getStats(),
            getRecentOpportunities: () => this.recentOpportunities,
        });
        const ws = new server_1.WebServer(this, store, 4449);
        this.webServer = ws;
        logger_1.logger.info('ArbAiBot initialized');
    }
    // Getters for web dashboard
    getIsRunning() {
        return this.isRunning;
    }
    getStore() {
        return this.store;
    }
    getAiAgent() {
        return this.aiAgent;
    }
    getOracle() {
        return this.oracle;
    }
    getRiskManager() {
        return this.riskManager;
    }
    getRecentOpportunities() {
        return this.recentOpportunities.slice(-50);
    }
    tokenSymbol(address) {
        if (!address)
            return '?';
        return TOKEN_SYMBOLS[address.toLowerCase()] || `${address.slice(0, 6)}...${address.slice(-4)}`;
    }
    getStats() {
        const deployedPerTrade = this.store.get().trading.tradeAmountUsd || 1;
        const roi = this.totalTrades > 0 ? (this.totalProfit / (deployedPerTrade * this.totalTrades)) * 100 : 0;
        const dayStart = new Date().setHours(0, 0, 0, 0);
        const dailyPnl = this.profitHistory
            .filter(p => p.t >= dayStart)
            .reduce((sum, p) => sum + p.profit, 0);
        return {
            status: this.isRunning ? 'running' : 'stopped',
            uptimeSec: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
            totalProfit: this.totalProfit,
            totalTrades: this.totalTrades,
            successfulTrades: this.successfulTrades,
            failedTrades: this.totalTrades - this.successfulTrades,
            successRate: this.totalTrades > 0 ? (this.successfulTrades / this.totalTrades) * 100 : 0,
            opportunitiesFound: this.opportunitiesFound,
            roiPct: roi,
            dailyPnl,
            dryRun: this.store.get().features.dryRun,
            walletBalances: this.walletBalances,
            profitHistory: this.profitHistory.slice(-120),
            networksEnabled: Object.entries(this.store.get().networks).filter(([, v]) => v.enabled).map(([k]) => k),
            riskStats: this.riskManager.getStats(),
        };
    }
    getLogs(limit = 200, level) {
        let logs = this.logs;
        if (level && level !== 'all') {
            logs = logs.filter(l => l.level === level);
        }
        return logs.slice(-limit);
    }
    addLog(level, message, data) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            data: data ? (0, utils_1.jsonSafe)(data) : undefined
        };
        this.logs.push(logEntry);
        if (this.logs.length > 2000) {
            this.logs = this.logs.slice(-2000);
        }
        if (level === 'error') {
            logger_1.logger.error(message);
        }
        else if (level === 'warn') {
            logger_1.logger.warn(message);
        }
        else {
            logger_1.logger.info(message);
        }
    }
    updateWalletBalances(balances) {
        this.walletBalances = balances;
    }
    incrementOpportunitiesFound(count = 1) {
        this.opportunitiesFound += count;
    }
    addTrade(profit, success, opportunity) {
        this.totalTrades++;
        if (success) {
            this.successfulTrades++;
            this.totalProfit += profit;
        }
        else {
            this.totalProfit -= Math.abs(profit);
        }
        this.riskManager.recordTrade(profit, success);
        this.profitHistory.push({
            t: Date.now(),
            profit: success ? profit : -Math.abs(profit),
            balance: this.totalProfit
        });
        if (this.profitHistory.length > 2000) {
            this.profitHistory = this.profitHistory.slice(-2000);
        }
        if (opportunity) {
            const tokens = `${this.tokenSymbol(opportunity.tokenIn)} -> ${this.tokenSymbol(opportunity.tokenOut)}`;
            const route = `${opportunity.network} | ${opportunity.dexIn} -> ${opportunity.dexOut}`;
            if (success) {
                this.addLog('success', `TRADE EXECUTED | ${route} | ${tokens} | profit: $${profit.toFixed(2)} (total: $${this.totalProfit.toFixed(2)})`, {
                    kind: 'trade', network: opportunity.network, dexIn: opportunity.dexIn, dexOut: opportunity.dexOut,
                    tokenIn: opportunity.tokenIn, tokenOut: opportunity.tokenOut, profit, totalProfit: this.totalProfit
                });
            }
            else {
                this.addLog('error', `TRADE FAILED | ${route} | ${tokens} | loss: $${Math.abs(profit).toFixed(2)} (total: $${this.totalProfit.toFixed(2)})`, {
                    kind: 'trade', network: opportunity.network, dexIn: opportunity.dexIn, dexOut: opportunity.dexOut,
                    tokenIn: opportunity.tokenIn, tokenOut: opportunity.tokenOut, profit: -Math.abs(profit), totalProfit: this.totalProfit
                });
            }
        }
    }
    async startTrading() {
        if (this.isRunning) {
            this.addLog('warn', 'Bot is already running');
            return;
        }
        this.isRunning = true;
        this.startedAt = this.startedAt || Date.now();
        this.addLog('info', 'Starting bot (trading loop + monitors)...');
        const settings = this.store.get();
        const activeWallet = settings.wallets?.list?.find(w => w.id === settings.wallets.activeId);
        // Start web server first so the dashboard is available even if other components fail
        await this.webServer.start().catch(err => {
            this.addLog('warn', `Web server start issue: ${err.message}`);
        });
        try {
            await this.mempoolMonitor.start();
        }
        catch (err) {
            this.addLog('error', `Failed to start mempool monitor (bot keeps running): ${err.message}`);
        }
        this.lastSettingsVersion = this.store.getVersion();
        this.startAiAutoAnalysis();
        this.detectArbitrageLoop().catch(err => {
            this.addLog('error', `Arbitrage detection loop crashed: ${err.message}`);
        });
        this.addLog('success', `Bot started | mode: ${settings.trading.scanMode} | dry-run: ${settings.features.dryRun} | AI autonomous: ${settings.ai.autonomousTrading ? 'ON' : 'off'} | wallet: ${activeWallet ? `${activeWallet.label} (${activeWallet.address || 'no address'})` : 'env fallback'} | networks: ${Object.keys(settings.networks).filter(k => settings.networks[k].enabled).join(', ')}`);
        if (settings.ai.autonomousTrading) {
            this.addLog('warn', 'AI AUTONOMOUS MODE ENABLED — the agent will change settings automatically and trade without manual approval');
        }
    }
    async stopTrading() {
        if (!this.isRunning) {
            this.addLog('warn', 'Bot is not running');
            return;
        }
        this.isRunning = false;
        this.addLog('info', 'Stopping bot...');
        try {
            await this.mempoolMonitor.stop();
        }
        catch (err) {
            this.addLog('warn', `Mempool monitor stop error: ${err.message}`);
        }
        if (this.aiAnalysisTimer) {
            clearInterval(this.aiAnalysisTimer);
            this.aiAnalysisTimer = null;
        }
        this.addLog('success', 'Bot stopped');
    }
    // Periodic AI market analysis (Settings → AI Agent → analysisIntervalMin).
    // In autonomous mode (Enable Automatic) analysis defaults to every 5 minutes
    // even when no explicit interval is configured.
    startAiAutoAnalysis() {
        if (this.aiAnalysisTimer) {
            clearInterval(this.aiAnalysisTimer);
            this.aiAnalysisTimer = null;
        }
        const ai = this.store.get().ai;
        let intervalMin = Number(ai.analysisIntervalMin) || 0;
        let implicit = false;
        if (intervalMin <= 0 && ai.autonomousTrading) {
            intervalMin = 5;
            implicit = true;
        }
        if (intervalMin <= 0)
            return;
        this.aiAnalysisTimer = setInterval(async () => {
            try {
                if (!this.isRunning || !this.aiAgent.isConfigured())
                    return;
                const result = await this.aiAgent.analyzeMarket();
                this.addLog('info', `AI market analysis (${result.provider}): ${result.analysis.slice(0, 200)}`, {
                    kind: 'ai',
                    recommendations: result.recommendations,
                    applied: result.applied,
                });
                if (result.applied) {
                    this.addLog('success', 'AI recommendations were auto-applied to settings', { kind: 'ai' });
                }
            }
            catch (err) {
                this.addLog('warn', `AI auto-analysis failed: ${err.message}`);
            }
        }, Math.max(1, intervalMin) * 60 * 1000);
        this.addLog('info', `AI auto-analysis scheduled every ${intervalMin} min${implicit ? ' (autonomous mode default)' : ''}`);
    }
    // Hot-reload settings: rebuild components if the settings version changed
    checkSettingsReload() {
        const version = this.store.getVersion();
        if (version !== this.lastSettingsVersion) {
            this.lastSettingsVersion = version;
            this.addLog('info', 'Settings changed - reconfiguring bot components...');
            try {
                this.arbitrageDetector.reconfigureDexes();
                this.transactionExecutor.reconfigureDexes();
                this.transactionExecutor.resetSigners();
                this.mempoolMonitor.reconfigure().catch(err => this.addLog('warn', `Mempool reconfigure failed: ${err.message}`));
                this.startAiAutoAnalysis();
                this.addLog('success', 'Bot reconfigured with new settings');
            }
            catch (err) {
                this.addLog('error', `Reconfiguration failed: ${err.message}`);
            }
        }
    }
    async detectArbitrageLoop() {
        this.addLog('info', 'Starting arbitrage detection loop');
        while (this.isRunning) {
            try {
                this.checkSettingsReload();
                const settings = this.store.get();
                const pendingTxns = this.mempoolMonitor.getPendingTransactions();
                // Detect arbitrage opportunities
                const opportunities = await this.arbitrageDetector.detectOpportunities(pendingTxns);
                if (opportunities.length > 0) {
                    this.opportunitiesFound += opportunities.length;
                    this.recentOpportunities.push(...opportunities);
                    if (this.recentOpportunities.length > 200) {
                        this.recentOpportunities = this.recentOpportunities.slice(-200);
                    }
                    this.addLog('info', `Found ${opportunities.length} arbitrage opportunities`, { kind: 'summary', count: opportunities.length });
                    // Detailed log for each opportunity
                    for (const opp of opportunities) {
                        const tokens = `${this.tokenSymbol(opp.tokenIn)} -> ${this.tokenSymbol(opp.tokenOut)}`;
                        const route = `${opp.network || 'n/a'} | ${opp.dexIn || '?'} -> ${opp.dexOut || '?'}`;
                        const amount = opp.inputAmount ? `${opp.inputAmount} ${this.tokenSymbol(opp.tokenIn)}` : 'n/a';
                        const profit = opp.profitEstimate !== undefined ? `$${opp.profitEstimate.toFixed(2)}` : 'n/a';
                        const pct = opp.profitPct !== undefined ? `${opp.profitPct.toFixed(3)}%` : 'n/a';
                        this.addLog('success', `OPPORTUNITY | ${route} | ${tokens} | amount: ${amount} (~$${(opp.inputUsd || 0).toFixed(0)}) | est. profit: ${profit} (${pct})`, {
                            kind: 'opportunity',
                            ...opp,
                            timestamp: opp.timestamp,
                            tokens: tokens,
                            route: route,
                        });
                    }
                }
                // Filter opportunities through risk manager
                const safeOpportunities = opportunities.filter((opp) => this.riskManager.isSafe(opp));
                // Execute the best opportunity (if any)
                if (safeOpportunities.length > 0) {
                    const bestOpportunity = this.arbitrageDetector.getBestOpportunity(safeOpportunities);
                    const result = await this.transactionExecutor.execute(bestOpportunity);
                    const profit = result.profitUsd || 0;
                    const success = result.success;
                    this.addTrade(profit, success, bestOpportunity);
                    // Take profit / stop loss
                    if (this.riskManager.shouldExit(profit)) {
                        this.addLog('warn', `Exit condition triggered for trade profit $${profit.toFixed(2)}`);
                    }
                }
                // Wait configured interval before next iteration
                await new Promise((resolve) => setTimeout(resolve, settings.trading.loopIntervalMs || 5000));
            }
            catch (error) {
                const err = error;
                logger_1.logger.error('Error in arbitrage detection loop:', err);
                this.addLog('error', `Error in arbitrage detection loop: ${err.message}`);
                await new Promise((resolve) => setTimeout(resolve, 15000));
            }
        }
    }
}
exports.ArbAiBot = ArbAiBot;
// Instantiate and start the bot
const store = new SettingsStore_1.SettingsStore();
const bot = new ArbAiBot(store);
// Auto-start trading loop; web dashboard is always available
bot.startTrading().catch(err => {
    logger_1.logger.error('Failed to start bot components:', err);
    logger_1.logger.error('Web dashboard remains running (Ctrl+C to stop)');
});
// Keep the process (and the web dashboard) alive on unexpected async errors
process.on('unhandledRejection', (reason) => {
    logger_1.logger.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
    logger_1.logger.error('Uncaught exception:', err);
});
// Graceful shutdown
process.on('SIGINT', () => { bot.stopTrading().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { bot.stopTrading().finally(() => process.exit(0)); });
