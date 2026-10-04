"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Btc15Strategy = void 0;
const logger_1 = require("../logger");
const utils_1 = require("../utils");
const TRADE_WINDOW_START_SEC = 780; // minute 13
const TRADE_WINDOW_END_SEC = 840; // minute 14
const MIN_PRICE = 0.001;
const MAX_PRICE = 0.999;
const MIN_LIQUIDITY = 0.02;
class Btc15Strategy {
    constructor(store, marketData) {
        this.priceHistory = [];
        this.tickBuffer = [];
        this.spotHistory = [];
        this.lastTradeKey = '';
        this.currentMarketId = '';
        this.store = store;
        this.marketData = marketData;
    }
    /**
     * Feed a market observation every tick. History resets when the observed
     * market changes (a new 15m cycle starts at ~0.50, so the old series is
     * meaningless for the new one).
     */
    observeMarket(marketId, mid) {
        if (this.currentMarketId !== marketId) {
            this.currentMarketId = marketId;
            this.priceHistory = [];
            this.tickBuffer = [];
        }
        this.observe(mid);
    }
    /** feed a market observation (poly mid + book) */
    observe(mid) {
        if (!Number.isFinite(mid) || mid < MIN_PRICE || mid > MAX_PRICE)
            return;
        this.priceHistory.push(mid);
        if (this.priceHistory.length > 100)
            this.priceHistory = this.priceHistory.slice(-100);
        this.tickBuffer.push({ ts: Date.now(), price: mid });
        if (this.tickBuffer.length > 500)
            this.tickBuffer = this.tickBuffer.slice(-500);
    }
    observeSpot(price) {
        if (!Number.isFinite(price) || price <= 0)
            return;
        const last = this.spotHistory[this.spotHistory.length - 1];
        if (last !== undefined && Math.abs(last - price) / price < 1e-9 && this.spotHistory.length % 5 !== 0) {
            // skip duplicate no-move readings most of the time to keep history diverse
        }
        this.spotHistory.push(price);
        if (this.spotHistory.length > 10)
            this.spotHistory = this.spotHistory.slice(-10);
    }
    historyLength() {
        return this.priceHistory.length;
    }
    static cycleWindow(startTs, now = Date.now(), cycleLenSec = 900) {
        const elapsed = Math.max(0, now - startTs);
        const secIntoCycle = Math.floor(elapsed / 1000) % cycleLenSec;
        const windowStart = Math.floor(cycleLenSec * (780 / 900));
        const windowEnd = Math.floor(cycleLenSec * (840 / 900));
        const inWindow = secIntoCycle >= windowStart && secIntoCycle < windowEnd;
        return { inWindow, secIntoCycle };
    }
    // ---------- processors ----------
    spikeSignals() {
        const t = this.store.get().trading;
        const out = [];
        const prices = this.priceHistory;
        if (prices.length < 20)
            return out;
        const lookback = prices.slice(-20);
        const ma = lookback.reduce((a, b) => a + b, 0) / lookback.length;
        const curr = prices[prices.length - 1];
        if (ma <= 0)
            return out;
        const dev = (curr - ma) / ma;
        const make = (direction, strength, confidence, reason) => {
            return {
                source: 'SpikeDetection',
                direction,
                strength,
                confidence,
                score: (strength / 4) * 0.5 * 100 + confidence * 0.5 * 100,
                reason,
                ts: Date.now(),
            };
        };
        if (Math.abs(dev) >= t.spikeThresholdPct) {
            const direction = dev > 0 ? 'BEARISH' : 'BULLISH'; // mean reversion
            const absDev = Math.abs(dev);
            const strength = absDev >= 0.12 ? 4 : absDev >= 0.08 ? 3 : 2;
            const confidence = Math.min(0.9, 0.5 + (absDev - t.spikeThresholdPct) * 3);
            if (confidence >= 0.55) {
                out.push(make(direction, strength, confidence, `MA20 deviation ${(dev * 100).toFixed(1)}% — mean reversion ${direction}`));
            }
        }
        else {
            const p3 = prices[prices.length - 4];
            if (p3 > 0) {
                const vel = (curr - p3) / p3;
                const velThr = 0.03;
                if (Math.abs(vel) >= velThr && Math.abs(dev) < 0.03) {
                    const direction = vel > 0 ? 'BULLISH' : 'BEARISH';
                    const ratio = Math.abs(vel) / velThr;
                    const confidence = ratio >= 3 ? 0.65 : ratio >= 2 ? 0.6 : 0.57;
                    const strength = Math.abs(vel) >= 0.04 ? 3 : 2;
                    out.push(make(direction, strength, confidence, `price velocity ${(vel * 100).toFixed(1)}%/3tick — momentum ${direction}`));
                }
            }
        }
        return out;
    }
    sentimentSignals(fng) {
        const out = [];
        if (fng === null)
            return out;
        const make = (direction, strength, confidence, reason) => ({
            source: 'SentimentAnalysis', direction, strength, confidence,
            score: (strength / 4) * 50 + confidence * 50, reason, ts: Date.now(),
        });
        if (fng <= 25) {
            const extremeness = (25 - fng) / 25;
            const [strength, confidence] = extremeness >= 0.8 ? [4, 0.85] : extremeness >= 0.5 ? [3, 0.75] : [2, 0.65];
            out.push(make('BULLISH', strength, confidence, `Fear&Greed ${fng} (extreme fear) — contrarian BULLISH`));
        }
        else if (fng >= 75) {
            const extremeness = (fng - 75) / 25;
            const [strength, confidence] = extremeness >= 0.8 ? [4, 0.85] : extremeness >= 0.5 ? [3, 0.75] : [2, 0.65];
            out.push(make('BEARISH', strength, confidence, `Fear&Greed ${fng} (extreme greed) — contrarian BEARISH`));
        }
        else if (fng < 45) {
            out.push(make('BULLISH', 1, 0.55, `Fear&Greed ${fng} — mild BULLISH`));
        }
        else if (fng > 55) {
            out.push(make('BEARISH', 1, 0.55, `Fear&Greed ${fng} — mild BEARISH`));
        }
        return out;
    }
    divergenceSignals(mid) {
        const t = this.store.get().trading;
        const out = [];
        const make = (direction, strength, confidence, reason) => ({
            source: 'PriceDivergence', direction, strength, confidence,
            score: (strength / 4) * 50 + confidence * 50, reason, ts: Date.now(),
        });
        let spotMomentum = null;
        if (this.spotHistory.length >= 4) {
            const curr = this.spotHistory[this.spotHistory.length - 1];
            const prev = this.spotHistory[this.spotHistory.length - 4];
            if (prev > 0)
                spotMomentum = (curr - prev) / prev;
        }
        if (mid >= 0.68 && (spotMomentum === null || spotMomentum <= 0.001)) {
            const extremeness = (mid - 0.68) / 0.32;
            const confidence = Math.min(0.8, 0.55 + extremeness * 0.25);
            out.push(make('BEARISH', extremeness > 0.5 ? 3 : 2, confidence, `poly prob ${mid.toFixed(2)} extreme high, spot momentum flat — fade`));
        }
        else if (mid <= 0.32 && (spotMomentum === null || spotMomentum >= -0.001)) {
            const extremeness = (0.32 - mid) / 0.32;
            const confidence = Math.min(0.8, 0.55 + extremeness * 0.25);
            out.push(make('BULLISH', extremeness > 0.5 ? 3 : 2, confidence, `poly prob ${mid.toFixed(2)} extreme low, spot momentum flat — fade`));
        }
        else if (mid >= 0.35 && mid <= 0.65 && spotMomentum !== null && Math.abs(spotMomentum) >= 0.003) {
            const direction = spotMomentum > 0 ? 'BULLISH' : 'BEARISH';
            const ratio = Math.abs(spotMomentum) / 0.003;
            const confidence = Math.min(0.78, 0.55 + Math.min(ratio - 1, 2) * 0.08);
            const strength = ratio >= 3 ? 3 : ratio >= 2 ? 2 : 1;
            out.push(make(direction, strength, confidence, `spot momentum ${(spotMomentum * 100).toFixed(2)}% — mispricing follow ${direction}`));
        }
        void t;
        return out;
    }
    imbalanceSignals(yesBook) {
        const out = [];
        let bidVol = 0, askVol = 0, maxBid = 0, maxAsk = 0;
        for (const l of yesBook.bids.slice(0, 10)) {
            const usd = l.price * l.size;
            bidVol += usd;
            maxBid = Math.max(maxBid, usd);
        }
        for (const l of yesBook.asks.slice(0, 10)) {
            const usd = l.price * l.size;
            askVol += usd;
            maxAsk = Math.max(maxAsk, usd);
        }
        const total = bidVol + askVol;
        if (total < 50)
            return out;
        const imbalance = (bidVol - askVol) / total;
        if (Math.abs(imbalance) < 0.3)
            return out;
        const direction = imbalance > 0 ? 'BULLISH' : 'BEARISH';
        const absImb = Math.abs(imbalance);
        const strength = absImb >= 0.7 ? 4 : absImb >= 0.5 ? 3 : absImb >= 0.35 ? 2 : 1;
        let confidence = Math.min(0.85, 0.55 + absImb * 0.4);
        const wall = direction === 'BULLISH' ? maxBid : maxAsk;
        if (wall / total >= 0.2)
            confidence = Math.min(0.9, confidence + 0.05);
        out.push({
            source: 'OrderBookImbalance', direction, strength, confidence,
            score: (strength / 4) * 50 + confidence * 50,
            reason: `book imbalance ${(imbalance * 100).toFixed(0)}% (bid $${bidVol.toFixed(0)} / ask $${askVol.toFixed(0)})`,
            ts: Date.now(),
        });
        return out;
    }
    tickVelocitySignals() {
        const out = [];
        const buf = this.tickBuffer;
        if (buf.length < 5)
            return out;
        const now = Date.now();
        const find = (agoMs, toleranceMs) => {
            let best = null;
            let bestDiff = Infinity;
            for (const tick of buf) {
                const diff = Math.abs(now - tick.ts - agoMs);
                if (diff <= toleranceMs && diff < bestDiff) {
                    bestDiff = diff;
                    best = tick.price;
                }
            }
            return best;
        };
        const p60 = find(60000, 15000);
        const p30 = find(30000, 15000);
        const curr = buf[buf.length - 1].price;
        if (curr <= 0)
            return out;
        let vel = 0, thr = 0.015, used60 = true;
        if (p30 !== null) {
            vel = (curr - p30) / p30;
            thr = 0.010;
            used60 = false;
        }
        else if (p60 !== null) {
            vel = (curr - p60) / p60;
            thr = 0.015;
            used60 = true;
        }
        else
            return out;
        if (Math.abs(vel) < thr)
            return out;
        const direction = vel > 0 ? 'BULLISH' : 'BEARISH';
        const strength = Math.abs(vel) >= 0.04 ? 4 : Math.abs(vel) >= 0.025 ? 3 : 2;
        let confidence = Math.min(0.82, 0.55 + (Math.abs(vel) / thr - 1) * 0.12);
        // acceleration: vel30 vs extrapolated vel60
        if (p30 !== null && p60 !== null) {
            const vel30 = (curr - p30) / p30;
            const vel60 = (curr - p60) / p60;
            const accel = vel30 - (vel60 - vel30);
            if (Math.sign(accel) === Math.sign(vel30) && Math.abs(accel) > 0.005) {
                confidence = Math.min(0.88, confidence + 0.06);
            }
            if (Math.sign(vel30) !== Math.sign(vel60))
                confidence *= 0.8;
        }
        out.push({
            source: 'TickVelocity', direction, strength, confidence,
            score: (strength / 4) * 50 + confidence * 50,
            reason: `tick velocity ${(vel * 100).toFixed(2)}% over ${used60 ? '60s' : '30s'} — ${direction}`,
            ts: Date.now(),
        });
        return out;
    }
    pcrSignals(pcr) {
        const out = [];
        if (pcr === null)
            return out;
        if (pcr >= 1.2) {
            const extremeness = (pcr - 1.2) / 1.2;
            const strength = pcr >= 1.6 ? 4 : pcr >= 1.4 ? 3 : 2;
            const confidence = Math.min(0.8, 0.57 + extremeness * 0.15);
            out.push({
                source: 'DeribitPCR', direction: 'BULLISH', strength, confidence,
                score: (strength / 4) * 50 + confidence * 50,
                reason: `Deribit PCR ${pcr.toFixed(2)} (put heavy) — contrarian BULLISH`,
                ts: Date.now(),
            });
        }
        else if (pcr <= 0.7) {
            const extremeness = (0.7 - pcr) / 0.7;
            const strength = pcr <= 0.45 ? 4 : pcr <= 0.55 ? 3 : 2;
            const confidence = Math.min(0.8, 0.57 + extremeness * 0.15);
            out.push({
                source: 'DeribitPCR', direction: 'BEARISH', strength, confidence,
                score: (strength / 4) * 50 + confidence * 50,
                reason: `Deribit PCR ${pcr.toFixed(2)} (call heavy) — contrarian BEARISH`,
                ts: Date.now(),
            });
        }
        return out;
    }
    // ---------- fusion ----------
    weightFor(source) {
        const w = this.store.get().trading.signalWeights;
        switch (source) {
            case 'SpikeDetection': return w.spike;
            case 'PriceDivergence': return w.divergence;
            case 'TickVelocity':
            case 'OrderBookImbalance': return w.momentum;
            case 'SentimentAnalysis':
            case 'DeribitPCR': return 0.05;
            default: return 0.05;
        }
    }
    fuseSignals(signals, minScore = 40) {
        const cutoff = Date.now() - 5 * 60 * 1000;
        const fresh = signals.filter(s => s.ts >= cutoff);
        if (fresh.length < 1)
            return null;
        let bullish = 0, bearish = 0;
        const contributions = [];
        for (const s of fresh) {
            const contribution = this.weightFor(s.source) * (0, utils_1.clamp)(s.confidence, 0, 1) * (s.strength / 4);
            contributions.push({ source: s.source, contribution });
            if (s.direction === 'BULLISH')
                bullish += contribution;
            else
                bearish += contribution;
        }
        const total = bullish + bearish;
        if (total < 0.0001)
            return null;
        const dominant = bullish >= bearish ? bullish : bearish;
        const direction = bullish >= bearish ? 'BULLISH' : 'BEARISH';
        const consensusScore = (dominant / total) * 100;
        if (consensusScore < minScore)
            return null;
        const confidence = fresh.reduce((a, s) => a + s.confidence, 0) / fresh.length;
        contributions.sort((a, b) => b.contribution - a.contribution);
        return {
            direction,
            consensusScore,
            confidence,
            contributions,
            sources: fresh.map(s => s.source),
        };
    }
    // ---------- evaluation ----------
    /**
     * Full pipeline for one signal market. Returns an opportunity when the
     * fused signal + trend filter + liquidity guard all pass.
     */
    async evaluate(sm) {
        const t = this.store.get().trading;
        const { inWindow, secIntoCycle } = Btc15Strategy.cycleWindow(sm.startTs, Date.now(), sm.cycleLenSec);
        if (!inWindow)
            return null;
        const tradeKey = `${sm.startTs}_${sm.market.id}`;
        if (this.lastTradeKey === tradeKey)
            return null; // one trade per cycle
        if (this.priceHistory.length < 20)
            return null; // warm-up (observed every tick via observeMarket)
        const [fng, pcr] = await Promise.all([
            this.marketData.fetchFearGreed(),
            t.btcAsset === 'BTC' ? this.marketData.fetchDeribitPcr('BTC') : Promise.resolve(null),
        ]);
        const signals = [
            ...this.spikeSignals(),
            ...this.sentimentSignals(fng),
            ...this.divergenceSignals(sm.mid),
            ...this.imbalanceSignals(sm.book.yes),
            ...this.tickVelocitySignals(),
            ...this.pcrSignals(pcr),
        ];
        const fused = this.fuseSignals(signals, 40);
        if (!fused)
            return null;
        // trend filter (the real gate in the reference bot)
        let side = null;
        let entryPrice = null;
        if (fused.direction === 'BULLISH' && sm.mid > 0.6) {
            side = 'YES';
            entryPrice = sm.book.yes.bestAsk;
        }
        else if (fused.direction === 'BEARISH' && sm.mid < 0.4) {
            side = 'NO';
            entryPrice = sm.book.no.bestAsk;
        }
        if (!side || entryPrice === null || entryPrice <= MIN_LIQUIDITY || entryPrice >= MAX_PRICE)
            return null;
        const tokenId = side === 'YES' ? sm.market.yesTokenId : sm.market.noTokenId;
        const orderUsd = t.btcTradeAmountUsd;
        const shares = Math.floor((orderUsd / entryPrice) * 100) / 100;
        if (shares <= 0)
            return null;
        this.lastTradeKey = tradeKey;
        const expectedPct = fused.direction === 'BULLISH' ? 3 : 3.1;
        const topReasons = signals
            .filter(s => s.direction === fused.direction)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
            .map(s => s.reason);
        const orders = [{
                tokenId,
                side: 'BUY',
                sideLabel: side,
                price: entryPrice,
                sizeShares: shares,
                strategy: 'btc-signal',
                marketId: sm.market.conditionId || sm.market.id,
                question: sm.market.question,
            }];
        return {
            id: (0, utils_1.generateId)(),
            type: 'btc-signal',
            marketId: sm.market.conditionId || sm.market.id,
            question: sm.market.question,
            edgePct: expectedPct,
            profitUsd: orderUsd * (expectedPct / 100),
            sizeShares: shares,
            orderUsd,
            yesAsk: sm.book.yes.bestAsk, yesBid: sm.book.yes.bestBid, noAsk: sm.book.no.bestAsk, noBid: sm.book.no.bestBid,
            side,
            score: fused.consensusScore,
            reason: `${fused.direction} (${fused.consensusScore.toFixed(0)}% consensus, ${Math.round(fused.confidence * 100)}% conf, cycle ${Math.floor(secIntoCycle / 60)}min): ${topReasons.join(' | ')}`,
            signalSources: fused.sources,
            timestamp: Date.now(),
            expiresAt: Date.now() + t.signalExpirySec * 1000,
            orders,
        };
    }
    resetCycleKey() {
        this.lastTradeKey = '';
    }
    /**
     * Self-learning weight optimization (port of feedback/learning_engine.py):
     * per source performance = win_rate*0.6 + clamp(pnl/100,0,1)*0.4;
     * new_weight = current + (target - current)*0.1, clamped to [0.05, 0.5];
     * weights are then normalized. Sources with < 10 trades keep their weight.
     */
    optimizeWeights(trades) {
        const statsBySource = new Map();
        for (const t of trades) {
            if (!t.sources || t.sources.length === 0)
                continue;
            for (const src of t.sources) {
                const rec = statsBySource.get(src) || { trades: 0, wins: 0, pnl: 0 };
                rec.trades++;
                if (t.profit > 0)
                    rec.wins++;
                rec.pnl += t.profit;
                statsBySource.set(src, rec);
            }
        }
        const perfOf = (rec) => (rec.wins / rec.trades) * 0.6 + (0, utils_1.clamp)(rec.pnl / 100, 0, 1) * 0.4;
        const t = this.store.get().trading;
        const w = { ...t.signalWeights };
        const lr = 0.1, minW = 0.05, maxW = 0.5;
        const details = [];
        const updateGroup = (group, key, sources) => {
            const relevant = sources
                .map(s => statsBySource.get(s))
                .filter((r) => !!r && r.trades >= 10);
            const old = w[key];
            if (relevant.length === 0) {
                details.push({ group, old, target: null, applied: old });
                return;
            }
            const totalTrades = relevant.reduce((a, r) => a + r.trades, 0);
            const target = relevant.reduce((a, r) => a + perfOf(r) * r.trades, 0) / totalTrades;
            const applied = (0, utils_1.clamp)(old + (target - old) * lr, minW, maxW);
            w[key] = applied;
            details.push({ group, old, target, applied });
        };
        updateGroup('spike', 'spike', ['SpikeDetection']);
        updateGroup('divergence', 'divergence', ['PriceDivergence']);
        updateGroup('momentum', 'momentum', ['TickVelocity', 'OrderBookImbalance']);
        const sum = w.spike + w.divergence + w.momentum;
        if (sum > 0) {
            w.spike = Math.round((w.spike / sum) * 1000) / 1000;
            w.divergence = Math.round((w.divergence / sum) * 1000) / 1000;
            w.momentum = Math.round((w.momentum / sum) * 1000) / 1000;
        }
        this.store.update({ trading: { signalWeights: w } });
        logger_1.logger.info(`Signal weights optimized: ${JSON.stringify(w)}`);
        return { weights: w, details };
    }
}
exports.Btc15Strategy = Btc15Strategy;
