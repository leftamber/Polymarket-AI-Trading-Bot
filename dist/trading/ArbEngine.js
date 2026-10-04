"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArbEngine = void 0;
const utils_1 = require("../utils");
/**
 * Arbitrage engine ported from the reference implementation:
 *
 * Bundle LONG  — buy YES@ask + NO@ask when ask_sum < 1:
 *   net_edge = 1 - (askYes + askNo) - taker_fee * ask_sum - gas * 2
 * Bundle SHORT — sell YES@bid + NO@bid when bid_sum > 1:
 *   net_edge = (bidYes + bidNo) - 1 - taker_fee * bid_sum - gas * 2
 * Market making — rest bid/ask one tick inside a wide spread:
 *   edge = spread / 2
 */
class ArbEngine {
    constructor(store) {
        this.cooldowns = new Map();
        this.store = store;
    }
    cooldownOk(key, seconds) {
        const last = this.cooldowns.get(key) || 0;
        if (Date.now() - last < seconds * 1000)
            return false;
        return true;
    }
    markCooldown(key) {
        this.cooldowns.set(key, Date.now());
        if (this.cooldowns.size > 5000) {
            const cutoff = Date.now() - 5 * 60 * 1000;
            for (const [k, t] of this.cooldowns) {
                if (t < cutoff)
                    this.cooldowns.delete(k);
            }
        }
    }
    pricing(takerFeeBps, notionalPerShare, legs) {
        const fee = (takerFeeBps / 10000) * notionalPerShare;
        const gas = this.store.get().trading.gasCostPerOrderUsd * legs;
        return fee + gas;
    }
    sizeShares(legPriceSum, maxLegShares) {
        const t = this.store.get().trading;
        if (legPriceSum <= 0 || legPriceSum >= 2)
            return null;
        const suggested = t.orderSizeUsd / legPriceSum;
        const maxBySize = t.maxOrderSizeUsd / legPriceSum;
        const minBySize = t.minOrderSizeUsd / legPriceSum;
        let shares = Math.min(suggested, maxLegShares, maxBySize);
        if (shares < minBySize)
            return null;
        shares = Math.floor(shares * 100) / 100;
        if (shares <= 0)
            return null;
        return { shares, orderUsd: shares * legPriceSum };
    }
    /** bundle arbitrage on a two-sided book */
    analyzeBundle(book) {
        const t = this.store.get().trading;
        const minEdge = t.minEdgePct / 100;
        const { yes, no } = book;
        if (yes.bestAsk === null || no.bestAsk === null || yes.bestBid === null || no.bestBid === null) {
            return null;
        }
        // LONG: buy both sides
        const askSum = yes.bestAsk + no.bestAsk;
        if (askSum < 1) {
            const costs = this.pricing(t.takerFeeBps, askSum, 2);
            const netEdgePerShare = 1 - askSum - costs;
            const netEdgePct = netEdgePerShare * 100;
            const key = `bundle-long_${book.marketId}`;
            if (netEdgePerShare >= minEdge && this.cooldownOk(key, 2)) {
                const maxLegShares = Math.min(yes.bestAskSize, no.bestAskSize);
                const sized = this.sizeShares(askSum, maxLegShares);
                if (sized) {
                    this.markCooldown(key);
                    const orders = [
                        { tokenId: '', side: 'BUY', sideLabel: 'YES', price: yes.bestAsk, sizeShares: sized.shares, strategy: 'bundle-long', marketId: book.marketId, question: book.question },
                        { tokenId: '', side: 'BUY', sideLabel: 'NO', price: no.bestAsk, sizeShares: sized.shares, strategy: 'bundle-long', marketId: book.marketId, question: book.question },
                    ];
                    return {
                        id: (0, utils_1.generateId)(),
                        type: 'bundle-long',
                        marketId: book.marketId,
                        question: book.question,
                        edgePct: netEdgePct,
                        profitUsd: netEdgePerShare * sized.shares,
                        sizeShares: sized.shares,
                        orderUsd: sized.orderUsd,
                        yesAsk: yes.bestAsk, yesBid: yes.bestBid, noAsk: no.bestAsk, noBid: no.bestBid,
                        timestamp: Date.now(),
                        expiresAt: Date.now() + t.signalExpirySec * 1000,
                        orders,
                        reason: `ask(YES)+ask(NO)=${askSum.toFixed(3)} < 1 — guaranteed $1 payout`,
                    };
                }
            }
        }
        // SHORT: sell both sides
        const bidSum = yes.bestBid + no.bestBid;
        if (bidSum > 1) {
            const costs = this.pricing(t.takerFeeBps, bidSum, 2);
            const netEdgePerShare = bidSum - 1 - costs;
            const netEdgePct = netEdgePerShare * 100;
            const key = `bundle-short_${book.marketId}`;
            if (netEdgePerShare >= minEdge && this.cooldownOk(key, 2)) {
                const maxLegShares = Math.min(yes.bestBidSize, no.bestBidSize);
                const sized = this.sizeShares(bidSum, maxLegShares);
                if (sized) {
                    this.markCooldown(key);
                    const orders = [
                        { tokenId: '', side: 'SELL', sideLabel: 'YES', price: yes.bestBid, sizeShares: sized.shares, strategy: 'bundle-short', marketId: book.marketId, question: book.question },
                        { tokenId: '', side: 'SELL', sideLabel: 'NO', price: no.bestBid, sizeShares: sized.shares, strategy: 'bundle-short', marketId: book.marketId, question: book.question },
                    ];
                    return {
                        id: (0, utils_1.generateId)(),
                        type: 'bundle-short',
                        marketId: book.marketId,
                        question: book.question,
                        edgePct: netEdgePct,
                        profitUsd: netEdgePerShare * sized.shares,
                        sizeShares: sized.shares,
                        orderUsd: sized.orderUsd,
                        yesAsk: yes.bestAsk, yesBid: yes.bestBid, noAsk: no.bestAsk, noBid: no.bestBid,
                        timestamp: Date.now(),
                        expiresAt: Date.now() + t.signalExpirySec * 1000,
                        orders,
                        reason: `bid(YES)+bid(NO)=${bidSum.toFixed(3)} > 1 — sell both, collect premium`,
                    };
                }
            }
        }
        return null;
    }
    /** market making: rest bid/ask one tick inside a wide spread (per token) */
    analyzeMarketMaking(book) {
        const t = this.store.get().trading;
        const minSpread = t.minSpreadCents / 100;
        const tick = t.tickSizeCents / 100;
        const tokens = [
            { side: 'YES', book: book.yes },
            { side: 'NO', book: book.no },
        ];
        for (const tok of tokens) {
            const { bestBid, bestAsk } = tok.book;
            if (bestBid === null || bestAsk === null)
                continue;
            const spread = bestAsk - bestBid;
            if (spread < minSpread)
                continue;
            const ourBid = bestBid + tick;
            const ourAsk = bestAsk - tick;
            if (ourAsk <= ourBid || ourAsk - ourBid < tick * 2)
                continue;
            const key = `mm_${book.marketId}_${tok.side}`;
            if (!this.cooldownOk(key, 5))
                continue;
            const mid = (ourBid + ourAsk) / 2;
            if (mid <= 0)
                continue;
            let shares = t.orderSizeUsd / mid;
            shares = Math.min(t.maxOrderSizeUsd / mid, Math.max(t.minOrderSizeUsd / mid, shares));
            shares = Math.floor(shares * 100) / 100;
            if (shares <= 0)
                continue;
            this.markCooldown(key);
            const notionalPerShare = mid;
            const edgePerShare = (ourAsk - ourBid) / 2;
            const fee = (t.makerFeeBps / 10000) * notionalPerShare * 2;
            const netEdgePerShare = Math.max(0, edgePerShare - fee);
            const orders = [
                { tokenId: '', side: 'BUY', sideLabel: tok.side, price: Math.round(ourBid * 1000) / 1000, sizeShares: shares, strategy: 'market-making', marketId: book.marketId, question: book.question },
                { tokenId: '', side: 'SELL', sideLabel: tok.side, price: Math.round(ourAsk * 1000) / 1000, sizeShares: shares, strategy: 'market-making', marketId: book.marketId, question: book.question },
            ];
            return {
                id: (0, utils_1.generateId)(),
                type: 'market-making',
                marketId: book.marketId,
                question: book.question,
                edgePct: netEdgePerShare * 100,
                profitUsd: netEdgePerShare * shares,
                sizeShares: shares,
                orderUsd: shares * notionalPerShare,
                side: tok.side,
                yesAsk: book.yes.bestAsk, yesBid: book.yes.bestBid, noAsk: book.no.bestAsk, noBid: book.no.bestBid,
                timestamp: Date.now(),
                expiresAt: Date.now() + t.signalExpirySec * 1000,
                orders,
                reason: `spread ¢${(spread * 100).toFixed(1)} ≥ ¢${t.minSpreadCents} — rest bid ${ourBid.toFixed(3)} / ask ${ourAsk.toFixed(3)}`,
            };
        }
        return null;
    }
    /** one analysis pass over a market book, respecting enabled features */
    analyze(book) {
        const f = this.store.get().features;
        if (f.enableBundleArb) {
            const opp = this.analyzeBundle(book);
            if (opp)
                return opp;
        }
        if (f.enableMarketMaking) {
            const opp = this.analyzeMarketMaking(book);
            if (opp)
                return opp;
        }
        return null;
    }
}
exports.ArbEngine = ArbEngine;
