import { logger } from '../logger';
import { SettingsStore } from '../settings/SettingsStore';

interface TradeRecord {
  timestamp: number;
  success: boolean;
  profitUsd: number;
}

export class RiskManager {
  private store: SettingsStore;
  private emergencyPaused: boolean = false;
  private emergencyPauseReason: string = '';
  private trades: TradeRecord[] = [];
  private consecutiveFailures: number = 0;
  private lastFailureAt: number = 0;

  constructor(store: SettingsStore) {
    this.store = store;
    logger.info('RiskManager initialized');
  }

  /**
   * Check if a trade is safe based on dynamic risk parameters from settings
   */
  isSafe(opportunity: any): boolean {
    const risk = this.store.get().risk;
    const trading = this.store.getEffective().trading;

    // Active wallet network restriction (Wallet Settings → allowed networks)
    const wallet = this.store.getActiveWallet();
    if (wallet && wallet.enabled) {
      const allowed = wallet.settings?.allowedNetworks || [];
      if (allowed.length > 0 && opportunity.network && !allowed.includes(opportunity.network)) {
        logger.debug(`Trade rejected: network ${opportunity.network} is not allowed for wallet ${wallet.label}`);
        return false;
      }
    }

    if (risk.emergencyPause || this.emergencyPaused) {
      logger.warn(`Trade rejected due to emergency pause: ${this.emergencyPauseReason || 'set in settings'}`);
      return false;
    }

    // Cooldown after failure
    if (this.lastFailureAt > 0 && risk.cooldownAfterFailureSec > 0) {
      const elapsed = (Date.now() - this.lastFailureAt) / 1000;
      if (elapsed < risk.cooldownAfterFailureSec) {
        logger.debug(`Trade rejected: cooldown active (${elapsed.toFixed(0)}/${risk.cooldownAfterFailureSec}s after failure)`);
        return false;
      }
    }

    // Consecutive failures
    if (risk.maxConsecutiveFailures > 0 && this.consecutiveFailures >= risk.maxConsecutiveFailures) {
      logger.warn(`Trade rejected: ${this.consecutiveFailures} consecutive failures (max ${risk.maxConsecutiveFailures})`);
      return false;
    }

    // Daily loss limit
    const dayStart = new Date().setHours(0, 0, 0, 0);
    const todayLoss = this.trades
      .filter(t => t.timestamp >= dayStart && !t.success)
      .reduce((sum, t) => sum + Math.abs(t.profitUsd), 0);
    if (risk.maxDailyLossUsd > 0 && todayLoss >= risk.maxDailyLossUsd) {
      logger.warn(`Trade rejected: daily loss limit reached ($${todayLoss.toFixed(2)}/$${risk.maxDailyLossUsd})`);
      return false;
    }

    // Kill switch: drawdown from peak daily profit
    if (risk.killSwitchDrawdownPct > 0) {
      const todayProfit = this.trades
        .filter(t => t.timestamp >= dayStart && t.success)
        .reduce((sum, t) => sum + t.profitUsd, 0);
      const peak = Math.max(todayProfit, 0);
      if (peak > 0) {
        const drawdownPct = ((peak - todayProfit) / peak) * 100;
        if (drawdownPct >= risk.killSwitchDrawdownPct) {
          logger.warn(`Trade rejected: kill switch, drawdown ${drawdownPct.toFixed(1)}% >= ${risk.killSwitchDrawdownPct}%`);
          return false;
        }
      }
    }

    // Blacklisted tokens
    const blacklist = (risk.blacklistTokens || []).map(t => t.toLowerCase());
    if (blacklist.length > 0) {
      const tokens = [opportunity.tokenIn, opportunity.tokenOut].filter(Boolean).map((t: string) => t.toLowerCase());
      if (tokens.some(t => blacklist.includes(t))) {
        logger.warn('Trade rejected: token is blacklisted');
        return false;
      }
    }

    // Minimum profit
    const profit = opportunity.profitEstimate || 0;
    if (profit < trading.minProfitUsd) {
      logger.debug(`Trade rejected due to insufficient profit: $${profit.toFixed(2)} < $${trading.minProfitUsd}`);
      return false;
    }

    // Max trade amount
    if (risk.maxTradeAmountUsd > 0 && (opportunity.inputUsd || 0) > risk.maxTradeAmountUsd) {
      logger.warn(`Trade rejected: trade amount $${opportunity.inputUsd} > max $${risk.maxTradeAmountUsd}`);
      return false;
    }

    // Slippage estimate (placeholder)
    const slippage = Math.random() * 0.05;
    if (slippage > trading.maxSlippagePct / 100) {
      logger.debug(`Trade rejected due to excessive slippage: ${(slippage * 100).toFixed(2)}% > ${trading.maxSlippagePct}%`);
      return false;
    }

    // Honeypot check (placeholder, can be disabled)
    if (risk.honeypotCheck && Math.random() < 0.01) {
      logger.warn('Trade rejected due to potential honeypot');
      return false;
    }

    // Liquidity check (placeholder)
    if (Math.random() < 0.1) {
      logger.warn(`Trade rejected due to insufficient liquidity (min $${risk.minLiquidityUsd})`);
      return false;
    }

    return true;
  }

  public recordTrade(profitUsd: number, success: boolean): void {
    this.trades.push({ timestamp: Date.now(), success, profitUsd });
    if (this.trades.length > 5000) this.trades = this.trades.slice(-5000);
    if (success) {
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures++;
      this.lastFailureAt = Date.now();
    }

    // Emergency pause triggers
    const risk = this.store.get().risk;
    const dayStart = new Date().setHours(0, 0, 0, 0);
    const todayLoss = this.trades
      .filter(t => t.timestamp >= dayStart && !t.success)
      .reduce((sum, t) => sum + Math.abs(t.profitUsd), 0);
    if (risk.maxDailyLossUsd > 0 && todayLoss >= risk.maxDailyLossUsd) {
      this.pauseEmergency(`Daily loss limit hit: $${todayLoss.toFixed(2)} >= $${risk.maxDailyLossUsd}`);
    }
  }

  public getStats() {
    return {
      consecutiveFailures: this.consecutiveFailures,
      emergencyPaused: this.emergencyPaused || this.store.get().risk.emergencyPause,
      tradesTracked: this.trades.length,
    };
  }

  pauseEmergency(reason: string): void {
    this.emergencyPaused = true;
    this.emergencyPauseReason = reason;
    logger.error(`Emergency pause triggered: ${reason}`);
  }

  resume(): void {
    this.emergencyPaused = false;
    this.emergencyPauseReason = '';
    this.consecutiveFailures = 0;
    logger.info('Trading resumed after emergency pause');
  }

  getDynamicSlippage(): number {
    return this.store.getEffective().trading.maxSlippagePct / 100;
  }

  shouldExit(currentProfit: number): boolean {
    const risk = this.store.get().risk;
    if (currentProfit >= risk.takeProfitUsd) {
      logger.info(`Take profit triggered: $${currentProfit} >= $${risk.takeProfitUsd}`);
      return true;
    }
    if (currentProfit <= -risk.stopLossUsd) {
      logger.info(`Stop loss triggered: $${currentProfit} <= -$${risk.stopLossUsd}`);
      return true;
    }
    return false;
  }
}