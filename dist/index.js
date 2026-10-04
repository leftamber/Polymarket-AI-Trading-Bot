"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolymarketBot = void 0;
const logger_1 = require("./logger");
const utils_1 = require("./utils");
const config_1 = require("./config");
const SettingsStore_1 = require("./settings/SettingsStore");
const server_1 = require("./web/server");
const MarketData_1 = require("./data/MarketData");
const MarketFeed_1 = require("./trading/MarketFeed");
const ArbEngine_1 = require("./trading/ArbEngine");
const Btc15Strategy_1 = require("./trading/Btc15Strategy");
const ExecutionEngine_1 = require("./trading/ExecutionEngine");
const RiskManager_1 = require("./risk/RiskManager");
const Portfolio_1 = require("./portfolio/Portfolio");
const ClobTrading_1 = require("./polymarket/ClobTrading");
const AiAgent_1 = require("./ai/AiAgent");
const Backtest_1 = require("./backtest/Backtest");
const MAX_ANALYZED_BOOKS_PER_TICK = 150;
class PolymarketBot {
    constructor(store) {
        this.isRunning = false;
        this.lastSettingsVersion = 0;
        this.aiAnalysisTimer = null;
        this.totalProfit = 0;
        this.totalTrades = 0;
        this.successfulTrades = 0;
        this.opportunitiesFound = 0;
        this.logs = [];
        this.profitHistory = [];
        this.recentOpportunities = [];
        this.signalTrades = [];
        this.startedAt = 0;
        this.store = store;
        this.lastSettingsVersion = store.getVersion();
        const pm = store.get().polymarket;
        this.marketData = new MarketData_1.MarketData();
        this.marketFeed = new MarketFeed_1.MarketFeed(store);
        this.risk = new RiskManager_1.RiskManager(store);
        this.portfolio = new Portfolio_1.Portfolio(store.get().features.dryRun ? pm.dryRunInitialBalanceUsd : 0, 'data/portfolio.json');
        this.clob = new ClobTrading_1.ClobTrading(store);
        this.arbEngine = new ArbEngine_1.ArbEngine(store);
        this.btcStrategy = new Btc15Strategy_1.Btc15Strategy(store, this.marketData);
        this.execution = new ExecutionEngine_1.ExecutionEngine(store, this.portfolio, this.risk, this.clob, {
            addLog: (level, message, data) => this.addLog(level, message, data),
            onTrade: (info) => this.handleTrade(info),
            getBook: (marketId) => this.marketFeed.getBook(marketId),
        });
        this.aiAgent = new AiAgent_1.AiAgent(store, {
            getStats: () => this.getStats(),
            getRecentOpportunities: () => this.recentOpportunities,
        });
        this.webServer = new server_1.WebServer(this, store, Number(process.env.DASHBOARD_PORT || config_1.DASHBOARD_PORT_DEFAULT));
        logger_1.logger.info('PolymarketBot initialized');
    }
    // ---------- getters for the dashboard ----------
    getIsRunning() {
        return this.isRunning;
    }
    getMarketFeed() {
        return this.marketFeed;
    }
    getPortfolio() {
        return this.portfolio;
    }
    getMarketData() {
        return this.marketData;
    }
    getAiAgent() {
        return this.aiAgent;
    }
    async startServer() {
        return this.webServer.start();
    }
    async runBacktest(durationSec = 300, markets = 3) {
        return new Backtest_1.BacktestEngine(this.store).run(durationSec, markets);
    }
    optimizeSignalWeights() {
        const result = this.btcStrategy.optimizeWeights(this.signalTrades);
        this.addLog('info', `Signal weights optimized → ${JSON.stringify(result.weights)} (from ${this.signalTrades.length} signal trades)`, {
            kind: 'ai', details: result.details,
        });
        return result;
    }
    getExecutionStats() {
        return this.execution.getStats();
    }
    getRecentOpportunities() {
        return this.recentOpportunities.slice(-50);
    }
    getStats() {
        const pnl = this.portfolio.getRealizedPnl() + this.portfolio.getUnrealizedPnl();
        const deployed = Math.max(1, this.totalTrades * this.store.get().trading.orderSizeUsd);
        const roi = this.totalTrades > 0 ? (this.totalProfit / deployed) * 100 : 0;
        const dayStart = new Date().setHours(0, 0, 0, 0);
        const dailyPnl = this.profitHistory
            .filter(p => p.t >= dayStart)
            .reduce((sum, p) => sum + p.profit, 0);
        const riskSummary = this.risk.getSummary();
        // annualized Sharpe over per-trade profits (port of performance_tracker)
        const rets = this.profitHistory.map(p => p.profit);
        let sharpe = 0;
        if (rets.length >= 2) {
            const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
            const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
            const std = Math.sqrt(variance);
            if (std > 0)
                sharpe = ((mean - 0.02 / 252) / std) * Math.sqrt(252);
        }
        return {
            status: this.isRunning ? 'running' : 'stopped',
            uptimeSec: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
            totalProfit: pnl,
            totalTrades: this.totalTrades,
            successfulTrades: this.successfulTrades,
            failedTrades: this.totalTrades - this.successfulTrades,
            successRate: this.totalTrades > 0 ? (this.successfulTrades / this.totalTrades) * 100 : 0,
            opportunitiesFound: this.opportunitiesFound,
            roiPct: roi,
            dailyPnl,
            sharpe,
            dryRun: this.store.get().features.dryRun,
            mode: this.store.get().trading.mode,
            cashBalance: this.portfolio.getCashBalance(),
            exposureUsd: this.portfolio.getExposureUsd(),
            marketsMonitored: this.marketFeed.marketsMonitored,
            liveCredentials: this.store.hasLiveCredentials(),
            profitHistory: this.profitHistory.slice(-120),
            riskStats: {
                consecutiveFailures: riskSummary.consecutiveFailures,
                emergencyPaused: riskSummary.emergencyPaused || riskSummary.killSwitchTriggered,
                killSwitchTriggered: riskSummary.killSwitchTriggered,
                killSwitchReason: riskSummary.killSwitchReason,
                tradesTracked: riskSummary.tradesTracked,
            },
            execution: this.execution.getStats(),
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
            data: data ? (0, utils_1.jsonSafe)(data) : undefined,
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
    handleTrade(info) {
        this.totalTrades++;
        if (info.success) {
            this.successfulTrades++;
            this.totalProfit += info.profit;
        }
        else {
            this.totalProfit -= Math.abs(info.profit);
        }
        this.risk.recordTrade(info.profit, info.success);
        this.profitHistory.push({
            t: Date.now(),
            profit: info.profit,
            balance: this.totalProfit,
        });
        if (this.profitHistory.length > 2000) {
            this.profitHistory = this.profitHistory.slice(-2000);
        }
        if (info.strategy === 'btc-signal') {
            this.signalTrades.push({ sources: info.sources, profit: info.profit, ts: Date.now() });
            if (this.signalTrades.length > 200)
                this.signalTrades = this.signalTrades.slice(-200);
            if (this.signalTrades.length > 0 && this.signalTrades.length % 30 === 0) {
                try {
                    this.optimizeSignalWeights();
                }
                catch (err) {
                    this.addLog('warn', `Signal weight optimization failed: ${err.message}`);
                }
            }
        }
        const label = `${info.strategy} | ${info.side} ${info.action} ${info.size.toFixed(1)} @ ${info.price.toFixed(3)}`;
        if (info.success) {
            this.addLog('success', `TRADE EXECUTED | ${label} | profit: $${info.profit.toFixed(2)} (total: $${this.totalProfit.toFixed(2)})${info.dryRun ? ' [dry-run]' : ' [LIVE]'}`, {
                kind: 'trade', ...(0, utils_1.jsonSafe)(info),
            });
        }
        else {
            this.addLog('error', `TRADE FAILED | ${label} | loss: $${Math.abs(info.profit).toFixed(2)} (total: $${this.totalProfit.toFixed(2)})`, {
                kind: 'trade', ...(0, utils_1.jsonSafe)(info),
            });
        }
    }
    // ---------- lifecycle ----------
    async startTrading() {
        if (this.isRunning) {
            this.addLog('warn', 'Bot is already running');
            return;
        }
        this.isRunning = true;
        this.startedAt = this.startedAt || Date.now();
        this.addLog('info', 'Starting bot (market discovery + trading loop)...');
        const settings = this.store.get();
        this.lastSettingsVersion = this.store.getVersion();
        this.startAiAutoAnalysis();
        // warm up the feed in the background, then start the loop
        this.marketFeed.warmup().then(() => {
            this.addLog('success', `Market feed ready: ${this.marketFeed.marketsMonitored} markets with books`);
        }).catch(err => {
            this.addLog('warn', `Market feed warmup issue: ${err.message}`);
        });
        if (!settings.features.dryRun) {
            const ready = await this.clob.init();
            this.addLog(ready ? 'success' : 'warn', ready
                ? 'Live CLOB client initialized — REAL ORDERS enabled'
                : 'Live CLOB client unavailable — staying in dry-run');
            if (!ready) {
                this.store.update({ features: { dryRun: true } });
                this.addLog('warn', 'Fell back to dry-run (no live credentials)');
            }
        }
        else {
            this.portfolio.setInitialBalance(settings.polymarket.dryRunInitialBalanceUsd);
        }
        this.tradingLoop().catch(err => {
            this.addLog('error', `Trading loop crashed: ${err.message}`);
        });
        this.addLog('success', `Bot started | mode: ${settings.trading.mode} | dry-run: ${settings.features.dryRun} | AI autonomous: ${settings.ai.autonomousTrading ? 'ON' : 'off'} | bundleArb: ${settings.features.enableBundleArb} | marketMaking: ${settings.features.enableMarketMaking} | btcSignals: ${settings.features.enableBtcSignals}`);
        if (settings.ai.autonomousTrading) {
            this.addLog('warn', 'AI AUTONOMOUS MODE ENABLED — the agent will change settings automatically');
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
            await this.execution.cancelAllOpenOrders();
        }
        catch (err) {
            this.addLog('warn', `Cancel orders error: ${err.message}`);
        }
        if (this.aiAnalysisTimer) {
            clearInterval(this.aiAnalysisTimer);
            this.aiAnalysisTimer = null;
        }
        this.addLog('success', 'Bot stopped');
    }
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
    checkSettingsReload() {
        const version = this.store.getVersion();
        if (version !== this.lastSettingsVersion) {
            this.lastSettingsVersion = version;
            this.addLog('info', 'Settings changed — reconfiguring bot components...');
            this.startAiAutoAnalysis();
            this.addLog('success', 'Bot reconfigured with new settings');
        }
    }
    // ---------- main loop ----------
    async tradingLoop() {
        this.addLog('info', 'Starting trading loop');
        while (this.isRunning) {
            try {
                this.checkSettingsReload();
                await this.tickOnce();
            }
            catch (error) {
                const err = error;
                logger_1.logger.error('Error in trading loop:', err);
                this.addLog('error', `Error in trading loop: ${err.message}`);
                await new Promise(resolve => setTimeout(resolve, 15000));
            }
            const interval = this.store.get().trading.loopIntervalMs || 5000;
            await new Promise(resolve => setTimeout(resolve, interval));
        }
    }
    async tickOnce() {
        const settings = this.store.get();
        const mode = settings.trading.mode;
        // 1. housekeeping: paper fill simulation / live fill polling, timeouts
        await this.execution.tick();
        // 2. feed refresh
        await this.marketFeed.ensureMarkets();
        await this.marketFeed.refreshBooks(100);
        const opportunities = [];
        // 3. arbitrage scan (bundle + market making)
        if ((mode === 'arb' || mode === 'both') && (settings.features.enableBundleArb || settings.features.enableMarketMaking)) {
            const books = [...this.marketFeed.getBooks().values()];
            books.sort((a, b) => b.volume24h - a.volume24h);
            let analyzed = 0;
            for (const book of books) {
                if (analyzed >= MAX_ANALYZED_BOOKS_PER_TICK)
                    break;
                analyzed++;
                const opp = this.arbEngine.analyze(book);
                if (opp) {
                    opportunities.push(opp);
                    if (opp.type === 'bundle-long' || opp.type === 'bundle-short')
                        break; // one bundle per tick
                }
            }
        }
        // 4. BTC 15m signal strategy
        if ((mode === 'btc15' || mode === 'both') && settings.features.enableBtcSignals) {
            try {
                const spot = await this.marketData.fetchSpotPrice(settings.trading.btcAsset);
                if (spot)
                    this.btcStrategy.observeSpot(spot.price);
                const candidates = this.marketFeed.getSignalMarketCandidates(settings.trading.btcAsset);
                // observe the nearest cycle market every tick (warm-up for the signal pipeline)
                if (candidates.length > 0) {
                    const nearest = candidates[0];
                    const nearestBook = this.marketFeed.getBook(nearest.market.conditionId || nearest.market.id);
                    if (nearestBook) {
                        const nearestMid = nearestBook.yes.bestBid !== null && nearestBook.yes.bestAsk !== null
                            ? (nearestBook.yes.bestBid + nearestBook.yes.bestAsk) / 2
                            : 0;
                        if (nearestMid)
                            this.btcStrategy.observeMarket(nearest.market.id, nearestMid);
                    }
                }
                for (const candidate of candidates) {
                    const book = this.marketFeed.getBook(candidate.market.conditionId || candidate.market.id);
                    if (!book)
                        continue;
                    const mid = book.yes.bestBid !== null && book.yes.bestAsk !== null
                        ? (book.yes.bestBid + book.yes.bestAsk) / 2
                        : 0;
                    if (!mid)
                        continue;
                    const opp = await this.btcStrategy.evaluate({
                        market: candidate.market,
                        book,
                        startTs: candidate.startTs,
                        endTs: candidate.endTs,
                        cycleLenSec: candidate.cycleLenSec,
                        mid,
                    });
                    if (opp) {
                        opportunities.push(opp);
                        break; // one signal trade per tick
                    }
                }
            }
            catch (err) {
                this.addLog('warn', `BTC15 strategy error: ${err.message}`);
            }
        }
        // 5. report + execute
        if (opportunities.length > 0) {
            this.opportunitiesFound += opportunities.length;
            this.recentOpportunities.push(...opportunities);
            if (this.recentOpportunities.length > 200) {
                this.recentOpportunities = this.recentOpportunities.slice(-200);
            }
            for (const opp of opportunities) {
                this.addLog(opp.type === 'btc-signal' ? 'success' : 'info', `OPPORTUNITY | ${opp.type} | ${opp.question.slice(0, 70)} | edge: ${opp.edgePct.toFixed(2)}% | size: ${opp.sizeShares.toFixed(1)} sh ($${opp.orderUsd.toFixed(2)})`, { kind: 'opportunity', ...(0, utils_1.jsonSafe)(opp), timestamp: new Date(opp.timestamp).toISOString() });
            }
        }
        const riskGate = this.risk.isTradeAllowedNow();
        if (!riskGate.allowed) {
            if (opportunities.length > 0) {
                this.addLog('warn', `Trading paused by risk manager: ${riskGate.reason}`);
            }
            return;
        }
        let mmExecuted = 0;
        for (const opp of opportunities) {
            if (opp.type === 'market-making' && mmExecuted >= 3)
                continue; // pace resting orders
            const allowed = this.risk.checkOrder({ marketId: opp.marketId, notionalUsd: opp.orderUsd, volume24h: 0 });
            if (!allowed.allowed)
                continue;
            const executed = await this.execution.execute(opp);
            if (executed && opp.type === 'market-making')
                mmExecuted++;
        }
    }
}
exports.PolymarketBot = PolymarketBot;
// Instantiate the bot; the web dashboard is always available
const store = new SettingsStore_1.SettingsStore();
const bot = new PolymarketBot(store);
async function main() {
    // --backtest [seconds]: run the simulated backtest instead of live trading
    const btIdx = process.argv.indexOf('--backtest');
    if (btIdx !== -1) {
        const duration = Number(process.argv[btIdx + 1]) || 300;
        logger_1.logger.info(`Running backtest for ${duration}s of simulated market time...`);
        const result = await bot.runBacktest(duration, 3);
        console.log('\n=== BACKTEST RESULT ===');
        console.log(JSON.stringify((0, utils_1.jsonSafe)(result), null, 2));
        process.exit(0);
    }
    // web dashboard first (available even if the trading loop hits an issue)
    await bot.startServer().catch(err => {
        logger_1.logger.error(`Web server failed to start: ${err.message}`);
    });
    // auto-start the trading loop
    bot.startTrading().catch(err => {
        logger_1.logger.error('Failed to start bot components:', err);
        logger_1.logger.error('Web dashboard remains running (Ctrl+C to stop)');
    });
}
main().catch(err => {
    logger_1.logger.error('Fatal startup error:', err);
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    logger_1.logger.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
    logger_1.logger.error('Uncaught exception:', err);
});
process.on('SIGINT', () => { bot.stopTrading().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { bot.stopTrading().finally(() => process.exit(0)); });
