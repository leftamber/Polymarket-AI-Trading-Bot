"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GammaClient = void 0;
const config_1 = require("../config");
const logger_1 = require("../logger");
const utils_1 = require("../utils");
class GammaClient {
    constructor(baseUrl = config_1.GAMMA_API_URL) {
        this.baseUrl = baseUrl.replace(/\/+$/, '');
    }
    async fetchRawMarkets(params) {
        const qs = Object.entries(params)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            .join('&');
        const res = await fetch(`${this.baseUrl}/markets?${qs}`, {
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        });
        if (!res.ok) {
            throw new Error(`gamma /markets ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
        }
        const json = await res.json();
        return Array.isArray(json) ? json : (json?.data || []);
    }
    /**
     * Discover active markets ordered by 24h volume (paginated, max ~5000 like the reference bot)
     */
    async discoverMarkets(maxMarkets = 500) {
        const out = [];
        let offset = 0;
        while (out.length < maxMarkets) {
            let raw;
            try {
                raw = await this.fetchRawMarkets({
                    closed: 'false',
                    active: 'true',
                    order: 'volume24hr',
                    ascending: 'false',
                    limit: config_1.GAMMA_PAGE_SIZE,
                    offset,
                });
            }
            catch (err) {
                logger_1.logger.warn(`Gamma discovery page offset=${offset} failed: ${err.message}`);
                break;
            }
            if (!raw.length)
                break;
            for (const item of raw) {
                const market = this.parseMarket(item);
                if (market)
                    out.push(market);
                if (out.length >= maxMarkets)
                    break;
            }
            if (raw.length < config_1.GAMMA_PAGE_SIZE)
                break;
            offset += config_1.GAMMA_PAGE_SIZE;
            await (0, utils_1.sleep)(config_1.GAMMA_PAGE_DELAY_MS);
        }
        logger_1.logger.info(`Gamma discovery: ${out.length} tradable markets`);
        return out;
    }
    parseMarket(item) {
        const tokenIds = (0, utils_1.parseJsonish)(item.clobTokenIds).filter(v => v && v.length > 10);
        if (tokenIds.length < 2)
            return null;
        const outcomes = (0, utils_1.parseJsonish)(item.outcomes);
        const closed = item.closed === true || item.umaResolutionStatus === 'resolved';
        if (item.active === false || closed)
            return null;
        return {
            id: String(item.id ?? ''),
            conditionId: String(item.conditionId ?? ''),
            slug: String(item.slug ?? ''),
            question: String(item.question ?? '').trim(),
            description: String(item.description ?? ''),
            yesTokenId: tokenIds[0],
            noTokenId: tokenIds[1],
            outcomes: outcomes.length >= 2 ? [outcomes[0], outcomes[1]] : ['YES', 'NO'],
            active: true,
            closed: false,
            resolved: item.umaResolutionStatus === 'resolved',
            volume24h: Number(item.volume24hr ?? item.volume24hrClob ?? 0) || 0,
            liquidity: Number(item.liquidityNum ?? item.liquidityClob ?? 0) || 0,
            category: String(item.category ?? ''),
            negRisk: item.negRisk === true,
            endDate: item.endDate,
        };
    }
}
exports.GammaClient = GammaClient;
