import { GAMMA_API_URL, GAMMA_PAGE_SIZE, GAMMA_PAGE_DELAY_MS } from '../config';
import { logger } from '../logger';
import { parseJsonish, sleep } from '../utils';
import { GammaMarket } from './types';

interface RawGammaMarket {
  id?: string | number;
  conditionId?: string;
  slug?: string;
  question?: string;
  description?: string;
  clobTokenIds?: unknown;
  outcomes?: unknown;
  active?: boolean;
  closed?: boolean;
  umaResolutionStatus?: string;
  volume24hr?: number;
  volume24hrClob?: number;
  liquidityNum?: number;
  liquidityClob?: number;
  category?: string;
  negRisk?: boolean;
  endDate?: string;
}

export class GammaClient {
  private baseUrl: string;

  constructor(baseUrl: string = GAMMA_API_URL) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  public async fetchRawMarkets(params: Record<string, string | number>): Promise<RawGammaMarket[]> {
    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const res = await fetch(`${this.baseUrl}/markets?${qs}`, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`gamma /markets ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    }
    const json: any = await res.json();
    return Array.isArray(json) ? json : (json?.data || []);
  }

  /**
   * Discover active markets ordered by 24h volume (paginated, max ~5000 like the reference bot)
   */
  public async discoverMarkets(maxMarkets: number = 500): Promise<GammaMarket[]> {
    const out: GammaMarket[] = [];
    let offset = 0;
    while (out.length < maxMarkets) {
      let raw: RawGammaMarket[];
      try {
        raw = await this.fetchRawMarkets({
          closed: 'false',
          active: 'true',
          order: 'volume24hr',
          ascending: 'false',
          limit: GAMMA_PAGE_SIZE,
          offset,
        });
      } catch (err) {
        logger.warn(`Gamma discovery page offset=${offset} failed: ${(err as Error).message}`);
        break;
      }
      if (!raw.length) break;
      for (const item of raw) {
        const market = this.parseMarket(item);
        if (market) out.push(market);
        if (out.length >= maxMarkets) break;
      }
      if (raw.length < GAMMA_PAGE_SIZE) break;
      offset += GAMMA_PAGE_SIZE;
      await sleep(GAMMA_PAGE_DELAY_MS);
    }
    logger.info(`Gamma discovery: ${out.length} tradable markets`);
    return out;
  }

  public parseMarket(item: RawGammaMarket): GammaMarket | null {
    const tokenIds = parseJsonish<string>(item.clobTokenIds).filter(v => v && v.length > 10);
    if (tokenIds.length < 2) return null;
    const outcomes = parseJsonish<string>(item.outcomes);
    const closed = item.closed === true || item.umaResolutionStatus === 'resolved';
    if (item.active === false || closed) return null;
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
