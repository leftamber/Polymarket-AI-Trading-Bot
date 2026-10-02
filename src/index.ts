import { MempoolMonitor } from './mempool/MempoolMonitor';
import { ArbitrageDetector, Opportunity } from './trading/ArbitrageDetector';
import { TransactionExecutor } from './trading/TransactionExecutor';
import { RiskManager } from './risk/RiskManager';
import { logger } from './logger';
import { SettingsStore } from './settings/SettingsStore';
import { WebServer } from './web/server';
import { jsonSafe } from './utils';
import { PriceOracle } from './ai/PriceOracle';
import { AiAgent } from './ai/AiAgent';

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: any;
}

export interface ProfitPoint {
  t: number;
  profit: number;
  balance: number;
}

const TOKEN_SYMBOLS: Record<string, string> = {
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

export class ArbAiBot {
  private store: SettingsStore;
  private oracle: PriceOracle;
  private aiAgent: AiAgent;
  private mempoolMonitor: MempoolMonitor;
  private arbitrageDetector: ArbitrageDetector;
  private transactionExecutor: TransactionExecutor;
  private riskManager: RiskManager;
  private webServer: WebServer;
  private isRunning: boolean = false;
  private lastSettingsVersion: number = 0;
  private aiAnalysisTimer: any = null;

  // Stats tracking
  private totalProfit: number = 0;
  private totalTrades: number = 0;
  private successfulTrades: number = 0;
  private opportunitiesFound: number = 0;
  private logs: LogEntry[] = [];
  private walletBalances: Record<string, string> = {};
  private profitHistory: ProfitPoint[] = [];
  private recentOpportunities: Opportunity[] = [];
  private startedAt: number = 0;
  private dayStartProfit: number = 0;

  constructor(store: SettingsStore) {
    this.store = store;
    this.lastSettingsVersion = store.getVersion();
    this.oracle = new PriceOracle(store);
    this.mempoolMonitor = new MempoolMonitor(store);
    this.arbitrageDetector = new ArbitrageDetector(store, this.oracle);
    this.transactionExecutor = new TransactionExecutor(store);
    this.riskManager = new RiskManager(store);
    this.aiAgent = new AiAgent(store, this.oracle, {
      getStats: () => this.getStats(),
      getRecentOpportunities: () => this.recentOpportunities,
    });
    const ws = new WebServer(this, store, 4449);
    this.webServer = ws;
    logger.info('ArbAiBot initialized');
  }

  // Getters for web dashboard
  public getIsRunning(): boolean {
    return this.isRunning;
  }

  public getStore(): SettingsStore {
    return this.store;
  }

  public getAiAgent(): AiAgent {
    return this.aiAgent;
  }

  public getOracle(): PriceOracle {
    return this.oracle;
  }

  public getRiskManager(): RiskManager {
    return this.riskManager;
  }

  public getRecentOpportunities(): Opportunity[] {
    return this.recentOpportunities.slice(-50);
  }

  public tokenSymbol(address?: string): string {
    if (!address) return '?';
    return TOKEN_SYMBOLS[address.toLowerCase()] || `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  public getStats() {
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

  public getLogs(limit: number = 200, level?: string): LogEntry[] {
    let logs = this.logs;
    if (level && level !== 'all') {
      logs = logs.filter(l => l.level === level);
    }
    return logs.slice(-limit);
  }

  public addLog(level: string, message: string, data?: any) {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data: data ? jsonSafe(data) : undefined
    };
    this.logs.push(logEntry);
    if (this.logs.length > 2000) {
      this.logs = this.logs.slice(-2000);
    }

    if (level === 'error') {
      logger.error(message);
    } else if (level === 'warn') {
      logger.warn(message);
    } else {
      logger.info(message);
    }
  }

  public updateWalletBalances(balances: Record<string, string>) {
    this.walletBalances = balances;
  }

  public incrementOpportunitiesFound(count: number = 1) {
    this.opportunitiesFound += count;
  }

  public addTrade(profit: number, success: boolean, opportunity?: Opportunity) {
    this.totalTrades++;
    if (success) {
      this.successfulTrades++;
      this.totalProfit += profit;
    } else {
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
      } else {
        this.addLog('error', `TRADE FAILED | ${route} | ${tokens} | loss: $${Math.abs(profit).toFixed(2)} (total: $${this.totalProfit.toFixed(2)})`, {
          kind: 'trade', network: opportunity.network, dexIn: opportunity.dexIn, dexOut: opportunity.dexOut,
          tokenIn: opportunity.tokenIn, tokenOut: opportunity.tokenOut, profit: -Math.abs(profit), totalProfit: this.totalProfit
        });
      }
    }
  }

  public async startTrading(): Promise<void> {
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
    } catch (err) {
      this.addLog('error', `Failed to start mempool monitor (bot keeps running): ${(err as Error).message}`);
    }

    this.lastSettingsVersion = this.store.getVersion();
    this.startAiAutoAnalysis();
    this.detectArbitrageLoop().catch(err => {
      this.addLog('error', `Arbitrage detection loop crashed: ${(err as Error).message}`);
    });

    this.addLog('success', `Bot started | mode: ${settings.trading.scanMode} | dry-run: ${settings.features.dryRun} | AI autonomous: ${settings.ai.autonomousTrading ? 'ON' : 'off'} | wallet: ${activeWallet ? `${activeWallet.label} (${activeWallet.address || 'no address'})` : 'env fallback'} | networks: ${Object.keys(settings.networks).filter(k => settings.networks[k].enabled).join(', ')}`);
    if (settings.ai.autonomousTrading) {
      this.addLog('warn', 'AI AUTONOMOUS MODE ENABLED — the agent will change settings automatically and trade without manual approval');
    }
  }

  public async stopTrading(): Promise<void> {
    if (!this.isRunning) {
      this.addLog('warn', 'Bot is not running');
      return;
    }
    this.isRunning = false;
    this.addLog('info', 'Stopping bot...');

    try {
      await this.mempoolMonitor.stop();
    } catch (err) {
      this.addLog('warn', `Mempool monitor stop error: ${(err as Error).message}`);
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
  private startAiAutoAnalysis(): void {
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
    if (intervalMin <= 0) return;
    this.aiAnalysisTimer = setInterval(async () => {
      try {
        if (!this.isRunning || !this.aiAgent.isConfigured()) return;
        const result = await this.aiAgent.analyzeMarket();
        this.addLog('info', `AI market analysis (${result.provider}): ${result.analysis.slice(0, 200)}`, {
          kind: 'ai',
          recommendations: result.recommendations,
          applied: result.applied,
        });
        if (result.applied) {
          this.addLog('success', 'AI recommendations were auto-applied to settings', { kind: 'ai' });
        }
      } catch (err) {
        this.addLog('warn', `AI auto-analysis failed: ${(err as Error).message}`);
      }
    }, Math.max(1, intervalMin) * 60 * 1000);
    this.addLog('info', `AI auto-analysis scheduled every ${intervalMin} min${implicit ? ' (autonomous mode default)' : ''}`);
  }

  // Hot-reload settings: rebuild components if the settings version changed
  private checkSettingsReload(): void {
    const version = this.store.getVersion();
    if (version !== this.lastSettingsVersion) {
      this.lastSettingsVersion = version;
      this.addLog('info', 'Settings changed - reconfiguring bot components...');
      try {
        this.arbitrageDetector.reconfigureDexes();
        this.transactionExecutor.reconfigureDexes();
        this.transactionExecutor.resetSigners();
        this.mempoolMonitor.reconfigure().catch(err =>
          this.addLog('warn', `Mempool reconfigure failed: ${(err as Error).message}`)
        );
        this.startAiAutoAnalysis();
        this.addLog('success', 'Bot reconfigured with new settings');
      } catch (err) {
        this.addLog('error', `Reconfiguration failed: ${(err as Error).message}`);
      }
    }
  }

  private async detectArbitrageLoop(): Promise<void> {
    this.addLog('info', 'Starting arbitrage detection loop');
    while (this.isRunning) {
      try {
        this.checkSettingsReload();

        const settings = this.store.get();
        const pendingTxns = this.mempoolMonitor.getPendingTransactions() as Record<string, any[]>;

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
          const bestOpportunity = this.arbitrageDetector.getBestOpportunity(safeOpportunities)!;

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
      } catch (error) {
        const err = error as Error;
        logger.error('Error in arbitrage detection loop:', err);
        this.addLog('error', `Error in arbitrage detection loop: ${err.message}`);
        await new Promise((resolve) => setTimeout(resolve, 15000));
      }
    }
  }
}

// Instantiate and start the bot
const store = new SettingsStore();
const bot = new ArbAiBot(store);

// Auto-start trading loop; web dashboard is always available
bot.startTrading().catch(err => {
    logger.error('Failed to start bot components:', err);
    logger.error('Web dashboard remains running (Ctrl+C to stop)');
});

// Keep the process (and the web dashboard) alive on unexpected async errors
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
});

// Graceful shutdown
process.on('SIGINT', () => { bot.stopTrading().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { bot.stopTrading().finally(() => process.exit(0)); });