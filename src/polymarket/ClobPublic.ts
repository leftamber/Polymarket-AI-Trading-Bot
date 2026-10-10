import { BOOK_BATCH_DELAY_MS, BOOK_FETCH_BATCH, BOOK_FETCH_DELAY_MS } from '../config';
import { logger } from '../logger';
import { chunk, RateLimiter, sleep } from '../utils';
import { GammaMarket, MarketBook, TokenBook } from './types';

interface RawBookResponse {
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
}

const EMPTY_BOOK: TokenBook = {
  bestBid: null, bestAsk: null, bestBidSize: 0, bestAskSize: 0, bids: [], asks: [],
};

function parseTokenBook(raw: RawBookResponse | null, levels: number = 10): TokenBook {
  if (!raw) return { ...EMPTY_BOOK, bids: [], asks: [] };
  const toLevels = (arr?: Array<{ price: string; size: string }>) =>
    (arr || []).slice(0, levels).map(l => ({ price: Number(l.price), size: Number(l.size) }));
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

export class ClobPublic {
  private baseUrl: string;
  private limiter: RateLimiter;

  constructor(baseUrl: string, maxRequestsPerSecond: number = 12) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.limiter = new RateLimiter(maxRequestsPerSecond);
  }

  public async fetchTokenBook(tokenId: string): Promise<TokenBook> {
    await this.limiter.acquire();
    const res = await fetch(`${this.baseUrl}/book?token_id=${encodeURIComponent(tokenId)}`, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`clob /book ${res.status}`);
    }
    const raw: RawBookResponse = await res.json() as unknown as RawBookResponse;
    return parseTokenBook(raw);
  }

  public async fetchTokenBookSafe(tokenId: string): Promise<TokenBook> {
    try {
      return await this.fetchTokenBook(tokenId);
    } catch (err) {
      logger.debug(`book fetch failed for token ${tokenId.slice(0, 10)}…: ${(err as Error).message}`);
      return { ...EMPTY_BOOK, bids: [], asks: [] };
    }
  }

  /**
   * Fetch books for a batch of markets (both YES and NO tokens), paced like the reference bot:
   * one call per token, small delay between calls, larger delay between batches.
   */
  public async fetchMarketBooks(markets: GammaMarket[]): Promise<Map<string, MarketBook>> {
    const result = new Map<string, MarketBook>();
    const batches = chunk(markets, BOOK_FETCH_BATCH);
    for (const batch of batches) {
      const results = await Promise.all(batch.map(async (m) => {
        const [yes, no] = await Promise.all([
          this.fetchTokenBookSafe(m.yesTokenId),
          this.fetchTokenBookSafe(m.noTokenId),
        ]);
        const book: MarketBook = {
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
        return [book.marketId, book] as const;
      }));
      for (const [id, book] of results) {
        result.set(id, book);
      }
      await sleep(BOOK_BATCH_DELAY_MS);
    }
    await sleep(BOOK_FETCH_DELAY_MS);
    return result;
  }
}
