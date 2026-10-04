"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Portfolio = void 0;
const logger_1 = require("../logger");
const utils_1 = require("../utils");
/**
 * Portfolio tracker: cash balance, weighted-average-cost positions,
 * realized/unrealized PnL, fees. Persisted to data/portfolio.json
 * (the Python reference kept it in memory only).
 */
class Portfolio {
    constructor(initialBalance, filePath) {
        this.feesPaid = 0;
        this.positions = new Map();
        this.trades = [];
        this.currentPrices = new Map();
        this.filePath = filePath || '';
        this.initialBalance = initialBalance;
        this.cashBalance = initialBalance;
        if (this.filePath)
            this.load();
    }
    load() {
        try {
            const fs = require('fs');
            if (!fs.existsSync(this.filePath))
                return;
            const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
            this.initialBalance = raw.initialBalance ?? this.initialBalance;
            this.cashBalance = raw.cashBalance ?? this.initialBalance;
            this.feesPaid = raw.feesPaid ?? 0;
            this.positions = new Map(Object.entries(raw.positions || {}));
            this.trades = raw.trades || [];
            this.currentPrices = new Map(Object.entries(raw.currentPrices || {}));
            logger_1.logger.info(`Portfolio loaded: ${this.positions.size} positions, cash $${this.cashBalance.toFixed(2)}`);
        }
        catch (err) {
            logger_1.logger.warn(`Portfolio load failed: ${err.message}`);
        }
    }
    save() {
        if (!this.filePath)
            return;
        try {
            const fs = require('fs');
            const path = require('path');
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            const shape = {
                initialBalance: this.initialBalance,
                cashBalance: this.cashBalance,
                feesPaid: this.feesPaid,
                positions: Object.fromEntries(this.positions),
                trades: this.trades.slice(-500),
                currentPrices: Object.fromEntries(this.currentPrices),
            };
            fs.writeFileSync(this.filePath, JSON.stringify(shape, null, 2));
        }
        catch (err) {
            logger_1.logger.warn(`Portfolio save failed: ${err.message}`);
        }
    }
    setInitialBalance(balance) {
        if (this.totalTrades() > 0)
            return;
        this.initialBalance = balance;
        this.cashBalance = balance;
        this.save();
    }
    /**
     * Apply a fill. Fee is charged on notional. Supports long AND short
     * positions (size < 0 = short), weighted-average cost method:
     * reducing sells realize (price - avgEntry) * qty, covering buys realize
     * (avgEntry - price) * qty.
     */
    applyFill(input) {
        const key = `${input.marketId}::${input.side}`;
        const notional = input.price * input.size;
        let pos = this.positions.get(key);
        if (!pos) {
            pos = {
                size: 0, avgEntry: 0, realizedPnl: 0, costBasis: 0,
                totalBought: 0, totalSold: 0, tradeCount: 0,
                marketId: input.marketId, question: input.question, side: input.side,
            };
            this.positions.set(key, pos);
        }
        let realizedPnl = 0;
        if (input.action === 'BUY') {
            this.cashBalance -= notional + input.fee;
            if (pos.size < 0) {
                // covering an existing short
                const cover = Math.min(input.size, -pos.size);
                realizedPnl += (pos.avgEntry - input.price) * cover;
                pos.size += cover;
                const remaining = input.size - cover;
                if (remaining > 0) {
                    pos.avgEntry = input.price;
                    pos.size = remaining;
                }
                else if (pos.size === 0) {
                    pos.avgEntry = 0;
                }
            }
            else {
                const newSize = pos.size + input.size;
                pos.avgEntry = newSize > 0 ? (pos.avgEntry * pos.size + input.price * input.size) / newSize : input.price;
                pos.size = newSize;
            }
            pos.costBasis += notional + input.fee;
            pos.totalBought += input.size;
        }
        else {
            this.cashBalance += notional - input.fee;
            if (pos.size > 0) {
                // reducing a long
                const reduce = Math.min(input.size, pos.size);
                realizedPnl += (input.price - pos.avgEntry) * reduce;
                pos.size -= reduce;
                const remaining = input.size - reduce;
                if (remaining > 0) {
                    // flips into a short at fill price
                    pos.avgEntry = input.price;
                    pos.size = -remaining;
                }
            }
            else {
                // increasing an existing short
                const newSize = pos.size - input.size;
                pos.avgEntry = newSize < 0
                    ? (pos.avgEntry * (-pos.size) + input.price * input.size) / (-newSize)
                    : input.price;
                pos.size = newSize;
            }
            pos.totalSold += input.size;
        }
        if (pos.size === 0)
            pos.avgEntry = 0;
        pos.realizedPnl += realizedPnl;
        pos.costBasis = Math.abs(pos.size) * pos.avgEntry;
        pos.tradeCount++;
        this.feesPaid += input.fee;
        const record = {
            ts: new Date().toISOString(),
            marketId: input.marketId,
            question: input.question,
            side: input.side,
            action: input.action,
            price: (0, utils_1.round4)(input.price),
            size: (0, utils_1.round4)(input.size),
            notional: (0, utils_1.round4)(notional),
            fee: (0, utils_1.round4)(input.fee),
            realizedPnl: (0, utils_1.round4)(realizedPnl),
            strategy: input.strategy,
            dryRun: input.dryRun,
        };
        this.trades.push(record);
        if (this.trades.length > 500)
            this.trades = this.trades.slice(-500);
        this.save();
        return { realizedPnl };
    }
    updatePrices(marketId, yesPrice, noPrice) {
        this.currentPrices.set(marketId, { YES: yesPrice, NO: noPrice });
    }
    currentPriceFor(marketId, side) {
        const p = this.currentPrices.get(marketId);
        return p ? p[side] : 0;
    }
    getPositions() {
        const out = [];
        for (const [key, pos] of this.positions) {
            const mark = this.currentPriceFor(pos.marketId, pos.side);
            const unrealized = pos.size !== 0 && mark > 0 ? pos.size * (mark - pos.avgEntry) : 0;
            if (pos.size === 0 && Math.abs(pos.realizedPnl) < 1e-9)
                continue;
            out.push({
                key,
                marketId: pos.marketId,
                question: pos.question,
                side: pos.side,
                size: pos.size,
                avgEntry: pos.avgEntry,
                currentPrice: mark,
                unrealizedPnl: unrealized,
                realizedPnl: pos.realizedPnl,
            });
        }
        return out;
    }
    getRealizedPnl() {
        let total = 0;
        for (const pos of this.positions.values())
            total += pos.realizedPnl;
        return total;
    }
    getUnrealizedPnl() {
        let total = 0;
        for (const pos of this.positions.values()) {
            const mark = this.currentPriceFor(pos.marketId, pos.side);
            if (pos.size > 0 && mark > 0)
                total += pos.size * (mark - pos.avgEntry);
        }
        return total;
    }
    getExposureUsd() {
        let total = 0;
        for (const pos of this.positions.values()) {
            total += Math.abs(pos.size) * pos.avgEntry;
        }
        return total;
    }
    getMarketExposure(marketId) {
        let total = 0;
        for (const pos of this.positions.values()) {
            if (pos.marketId !== marketId)
                continue;
            total += Math.abs(pos.size) * pos.avgEntry;
        }
        return total;
    }
    totalTrades() {
        return this.trades.length;
    }
    getWinRate() {
        let wins = 0, losses = 0;
        for (const t of this.trades) {
            if (t.realizedPnl > 0)
                wins++;
            else if (t.realizedPnl < 0)
                losses++;
        }
        return { wins, losses, rate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0 };
    }
    getCashBalance() {
        return this.cashBalance;
    }
    getInitialBalance() {
        return this.initialBalance;
    }
    getFeesPaid() {
        return this.feesPaid;
    }
    getRecentTrades(limit = 50) {
        return this.trades.slice(-limit).reverse();
    }
    getSafe() {
        return (0, utils_1.jsonSafe)({
            initialBalance: this.initialBalance,
            cashBalance: this.cashBalance,
            realizedPnl: this.getRealizedPnl(),
            unrealizedPnl: this.getUnrealizedPnl(),
            totalPnl: this.getRealizedPnl() + this.getUnrealizedPnl(),
            feesPaid: this.feesPaid,
            exposureUsd: this.getExposureUsd(),
            totalTrades: this.trades.length,
            ...this.getWinRate(),
            positions: this.getPositions(),
            trades: this.getRecentTrades(50),
        });
    }
    reset() {
        this.positions.clear();
        this.trades = [];
        this.currentPrices.clear();
        this.feesPaid = 0;
        this.cashBalance = this.initialBalance;
        this.save();
        logger_1.logger.info(`Portfolio reset to $${this.initialBalance}`);
    }
}
exports.Portfolio = Portfolio;
