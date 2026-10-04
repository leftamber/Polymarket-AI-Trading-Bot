"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClobPublic = void 0;
const config_1 = require("../config");
const logger_1 = require("../logger");
const utils_1 = require("../utils");
const EMPTY_BOOK = {
    bestBid: null, bestAsk: null, bestBidSize: 0, bestAskSize: 0, bids: [], asks: [],
};
function parseTokenBook(raw, levels = 10) {
    if (!raw)
        return { ...EMPTY_BOOK, bids: [], asks: [] };
    const toLevels = (arr) => (arr || []).slice(0, levels).map(l => ({ price: Number(l.price), size: Number(l.size) }));
    const bids = toLevels(raw.bids);
    const asks = toLevels(raw.asks);
    return {
        bestBid: bids.length ? bids[0].price : null,
        bestAsk: asks.length ? asks[0].price : null,
        bestBidSize: bids.length ? bids[0].size : 0,
        bestAskSize: asks.length ? asks[0].size : 0,
        bids,
        asks,
    };
}
class ClobPublic {
    constructor(baseUrl, maxRequestsPerSecond = 12) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.limiter = new utils_1.RateLimiter(maxRequestsPerSecond);
    }
    async fetchTokenBook(tokenId) {
        await this.limiter.acquire();
        const res = await fetch(`${this.baseUrl}/book?token_id=${encodeURIComponent(tokenId)}`, {
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        });
        if (!res.ok) {
            throw new Error(`clob /book ${res.status}`);
        }
        const raw = await res.json();
        return parseTokenBook(raw);
    }
    async fetchTokenBookSafe(tokenId) {
        try {
            return await this.fetchTokenBook(tokenId);
        }
        catch (err) {
            logger_1.logger.debug(`book fetch failed for token ${tokenId.slice(0, 10)}…: ${err.message}`);
            return { ...EMPTY_BOOK, bids: [], asks: [] };
        }
    }
    /**
     * Fetch books for a batch of markets (both YES and NO tokens), paced like the reference bot:
     * one call per token, small delay between calls, larger delay between batches.
     */
    async fetchMarketBooks(markets) {
        const result = new Map();
        const batches = (0, utils_1.chunk)(markets, config_1.BOOK_FETCH_BATCH);
        for (const batch of batches) {
            const results = await Promise.all(batch.map(async (m) => {
                const [yes, no] = await Promise.all([
                    this.fetchTokenBookSafe(m.yesTokenId),
                    this.fetchTokenBookSafe(m.noTokenId),
                ]);
                const book = {
                    marketId: m.conditionId || m.id,
                    conditionId: m.conditionId,
                    question: m.question,
                    volume24h: m.volume24h,
                    liquidity: m.liquidity,
                    yesTokenId: m.yesTokenId,
                    noTokenId: m.noTokenId,
                    yes,
                    no,
                    updatedAt: Date.now(),
                };
                return [book.marketId, book];
            }));
            for (const [id, book] of results) {
                result.set(id, book);
            }
            await (0, utils_1.sleep)(config_1.BOOK_BATCH_DELAY_MS);
        }
        await (0, utils_1.sleep)(config_1.BOOK_FETCH_DELAY_MS);
        return result;
    }
}
exports.ClobPublic = ClobPublic;
