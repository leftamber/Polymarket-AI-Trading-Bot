"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskManager = void 0;
const logger_1 = require("../logger");
const utils_1 = require("../utils");
/**
 * Risk manager ported from the reference arbitrage bot:
 * kill switch, whitelist/blacklist, volume filter, per-market and global
 * exposure caps, daily loss and drawdown limits with auto kill switch.
 */
class RiskManager {
    constructor(store) {
        this.perMarketExposure = new Map();
        this.globalExposure = 0;
        this.dailyPnl = 0;
        this.peakPnl = 0;
        this.consecutiveFailures = 0;
        this.emergencyPaused = false;
        this.killSwitchTriggered = false;
        this.killSwitchReason = '';
        this.tradesTracked = 0;
        this.lastFailureAt = 0;
        this.dayKey = this.currentDayKey();
        this.store = store;
    }
    currentDayKey() {
        return new Date().toISOString().slice(0, 10);
    }
    get risk() {
        return this.store.get().risk;
    }
    getSummary() {
        const drawdownPct = this.peakPnl > 0 ? ((this.peakPnl - (this.peakPnl + this.dailyPnl)) / this.peakPnl) * 100 : 0;
        return {
            globalExposureUsd: this.globalExposure,
            perMarketExposureUsd: Object.fromEntries(this.perMarketExposure),
            dailyPnl: this.dailyPnl,
            peakPnl: this.peakPnl,
            drawdownPct,
            consecutiveFailures: this.consecutiveFailures,
            emergencyPaused: this.emergencyPaused,
            killSwitchTriggered: this.killSwitchTriggered,
            killSwitchReason: this.killSwitchReason,
            tradesTracked: this.tradesTracked,
        };
    }
    isTradeAllowedNow() {
        const risk = this.risk;
        if (this.killSwitchTriggered) {
            return { allowed: false, reason: `kill switch: ${this.killSwitchReason}` };
        }
        if (risk.emergencyPause) {
            return { allowed: false, reason: 'emergency pause is active' };
        }
        this.checkDayRollover();
        if (this.dailyPnl <= -risk.maxDailyLossUsd) {
            this.triggerKillSwitch('Daily loss limit exceeded');
            return { allowed: false, reason: 'daily loss limit exceeded' };
        }
        const drawdownPct = this.peakPnl > 0 ? ((this.peakPnl - (this.peakPnl + Math.min(this.dailyPnl, 0))) / this.peakPnl) * 100 : 0;
        if (drawdownPct > risk.maxDrawdownPct) {
            this.triggerKillSwitch('Drawdown limit exceeded');
            return { allowed: false, reason: 'drawdown limit exceeded' };
        }
        if (this.consecutiveFailures >= risk.maxConsecutiveFailures) {
            return { allowed: false, reason: `too many consecutive failures (${this.consecutiveFailures})` };
        }
        if (this.cooldownActive()) {
            return { allowed: false, reason: `cooldown after failure (${risk.cooldownAfterFailureSec}s)` };
        }
        return { allowed: true };
    }
    checkOrder(order) {
        const base = this.isTradeAllowedNow();
        if (!base.allowed)
            return base;
        const risk = this.risk;
        if (risk.blacklist.some(b => order.marketId.toLowerCase().includes(b.toLowerCase()))) {
            return { allowed: false, reason: 'market is blacklisted' };
        }
        if (risk.whitelist.length > 0 && !risk.whitelist.some(w => order.marketId.toLowerCase().includes(w.toLowerCase()))) {
            return { allowed: false, reason: 'market is not whitelisted' };
        }
        if (this.risk.tradeOnlyHighVolume) {
            if (order.volume24h < risk.min24hVolumeUsd) {
                return { allowed: false, reason: `volume ${Math.round(order.volume24h)} < min ${risk.min24hVolumeUsd}` };
            }
        }
        const marketExposure = this.perMarketExposure.get(order.marketId) || 0;
        if (marketExposure + order.notionalUsd > risk.maxPositionPerMarketUsd) {
            return { allowed: false, reason: `per-market exposure would exceed $${risk.maxPositionPerMarketUsd}` };
        }
        if (this.globalExposure + order.notionalUsd > risk.maxGlobalExposureUsd) {
            return { allowed: false, reason: `global exposure would exceed $${risk.maxGlobalExposureUsd}` };
        }
        return { allowed: true };
    }
    /** apply a filled order to exposure accounting */
    applyFill(marketId, notionalUsd, action) {
        const market = Math.max(0, (this.perMarketExposure.get(marketId) || 0) + (action === 'BUY' ? notionalUsd : -notionalUsd));
        this.perMarketExposure.set(marketId, market);
        this.globalExposure = Math.max(0, this.globalExposure + (action === 'BUY' ? notionalUsd : -notionalUsd));
    }
    recordTrade(profit, success) {
        this.checkDayRollover();
        this.tradesTracked++;
        this.dailyPnl += profit;
        this.peakPnl = Math.max(this.peakPnl, this.dailyPnl);
        if (success) {
            this.consecutiveFailures = 0;
        }
        else {
            this.consecutiveFailures++;
            this.lastFailureAt = Date.now();
            const risk = this.risk;
            if (this.dailyPnl <= -risk.maxDailyLossUsd && risk.killSwitchEnabled) {
                this.triggerKillSwitch('Daily loss limit exceeded');
            }
        }
    }
    cooldownActive() {
        const risk = this.risk;
        if (risk.cooldownAfterFailureSec <= 0)
            return false;
        return this.lastFailureAt > 0 && Date.now() - this.lastFailureAt < risk.cooldownAfterFailureSec * 1000;
    }
    triggerKillSwitch(reason) {
        if (!this.risk.killSwitchEnabled) {
            logger_1.logger.warn(`Kill switch condition met but disabled in settings: ${reason}`);
            return;
        }
        if (this.killSwitchTriggered)
            return;
        this.killSwitchTriggered = true;
        this.killSwitchReason = reason;
        logger_1.logger.error(`KILL SWITCH triggered: ${reason}`);
    }
    resetKillSwitch() {
        this.killSwitchTriggered = false;
        this.killSwitchReason = '';
        this.consecutiveFailures = 0;
        this.lastFailureAt = 0;
        logger_1.logger.warn('Kill switch reset by operator');
    }
    setEmergencyPause(paused) {
        this.emergencyPaused = paused;
    }
    resetDailyStats() {
        this.dailyPnl = 0;
        this.peakPnl = 0;
        this.dayKey = this.currentDayKey();
    }
    checkDayRollover() {
        const key = this.currentDayKey();
        if (key !== this.dayKey) {
            this.dayKey = key;
            this.dailyPnl = 0;
            this.peakPnl = 0;
            logger_1.logger.info('New trading day — daily stats reset');
        }
    }
    clampNotionalToAvailable(marketId, desiredNotional) {
        const risk = this.risk;
        const market = this.perMarketExposure.get(marketId) || 0;
        const perMarketRoom = Math.max(0, risk.maxPositionPerMarketUsd - market);
        const globalRoom = Math.max(0, risk.maxGlobalExposureUsd - this.globalExposure);
        return (0, utils_1.clamp)(Math.min(desiredNotional, perMarketRoom, globalRoom), 0, desiredNotional);
    }
}
exports.RiskManager = RiskManager;
