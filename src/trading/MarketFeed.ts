import { SettingsStore } from '../settings/SettingsStore';
import { logger } from '../logger';
import { GammaClient } from '../polymarket/GammaClient';
import { ClobPublic } from '../polymarket/ClobPublic';
import { GammaMarket, MarketBook } from '../polymarket/types';
import { sleep } from '../utils';

export interface SignalMarketCandidate {
  market: GammaMarket;
  startTs: number;
  endTs: number;
  cycleLenSec: number;
}

export interface MarketRowDto {
  id: string;
  question: string;
  volume24h: number;
  liquidity: number;
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  bundleAsk: number | null;
  bundleBid: number | null;
  edgeLongPct: number | null;
  edgeShortPct: number | null;
  spreadYes: number | null;
  updatedAt: string;
}

/**
 * Market discovery (Gamma) + order book cache (CLOB /book) with paced
 * polling, mirroring the reference bot's rotation strategy.
 */
export class MarketFeed {
  private store: SettingsStore;
  private gamma: GammaClient;
  private clob: ClobPublic;
  private markets: Map<string, GammaMarket> = new Map();
  private books: Map<string, MarketBook> = new Map();
  private lastDiscovery: number = 0;
  private lastBookRefresh: number = 0;
  private discoveryPromise: Promise<void> | null = null;
  private bookRotationOffset: number = 0;

  constructor(store: SettingsStore) {
    this.store = store;
    const pm = store.get().polymarket;
    this.gamma = new GammaClient(pm.gammaApiUrl);
    this.clob = new ClobPublic(pm.clobApiUrl);
  }

  public get marketsMonitored(): number {
    return this.books.size;
  }

  public getMarkets(): GammaMarket[] {
    return [...this.markets.values()];
  }

  public getBook(marketId: string): MarketBook | undefined {
    return this.books.get(marketId);
  }

  public getBooks(): Map<string, MarketBook> {
    return this.books;
  }

  public async ensureMarkets(force: boolean = false): Promise<void> {
    const refreshMs = this.store.get().trading.marketsRefreshMs;
    if (!force && Date.now() - this.lastDiscovery < refreshMs) return;
    if (this.discoveryPromise) return this.discoveryPromise;
    this.discoveryPromise = (async () => {
      try {
        const max = this.store.get().trading.maxMarketsScanned;
        const found = await this.gamma.discoverMarkets(max);
        const next = new Map<string, GammaMarket>();
        for (const m of found) {
          const key = m.conditionId || m.id;
          if (key) next.set(key, m);
        }
        this.markets = next;
        this.lastDiscovery = Date.now();
      } catch (err) {
        logger.warn(`Market discovery failed: ${(err as Error).message}`);
      } finally {
        this.discoveryPromise = null;
      }
    })();
    return this.discoveryPromise;
  }

  /** refresh books for the next rotation batch */
  public async refreshBooks(batchLimit: number = 100): Promise<void> {
    const refreshMs = this.store.get().trading.bookRefreshMs;
    if (Date.now() - this.lastBookRefresh < refreshMs && this.books.size > 0) return;
    const all = this.getMarkets();
    if (all.length === 0) return;

    const sorted = [...all].sort((a, b) => b.volume24h - a.volume24h);
    const batch: GammaMarket[] = [];
    for (let i = 0; i < Math.min(batchLimit, sorted.length); i++) {
      batch.push(sorted[(this.bookRotationOffset + i) % sorted.length]);
    }
    this.bookRotationOffset = (this.bookRotationOffset + batchLimit) % Math.max(1, sorted.length);

    const fetched = await this.clob.fetchMarketBooks(batch);
    for (const [id, book] of fetched) {
      const hasData = book.yes.bestAsk !== null || book.no.bestAsk !== null || book.yes.bestBid !== null || book.no.bestBid !== null;
      if (hasData) this.books.set(id, book);
    }
    this.lastBookRefresh = Date.now();
  }

  /** markets suitable for the BTC-15m style signal strategy */
  public getSignalMarketCandidates(asset: string): SignalMarketCandidate[] {
    const out: SignalMarketCandidate[] = [];
    const now = Date.now();
    const slugPrefix = `${asset.toLowerCase()}-updown-15m-`;

    for (const m of this.getMarkets()) {
      let endTs: number | null = null;
      let cycleLen = 900;

      if (m.slug.startsWith(slugPrefix)) {
        const ts = Number(m.slug.split('-').pop());
        if (Number.isFinite(ts) && ts > 1_500_000_000) {
          endTs = (ts + 900) * 1000;
        }
      }
      if (endTs === null) {
        const assetWords: Record<string, RegExp> = {
          BTC: /\b(btc|bitcoin)\b/i,
          ETH: /\b(eth|ethereum)\b/i,
          SOL: /\b(sol|solana)\b/i,
          XRP: /\bxrp\b/i,
        };
        const isUpDown = /\bup or down\b|\bupdown\b/i.test(m.question);
        const isAsset = (assetWords[asset] || /./).test(m.question);
        if (isUpDown && isAsset) {
          if (/15 ?min|15m/i.test(m.question)) cycleLen = 900;
          else if (/hour/i.test(m.question)) cycleLen = 3600;
          if (m.endDate) {
            const parsed = Date.parse(m.endDate);
            if (Number.isFinite(parsed) && parsed > now - cycleLen * 1000) endTs = parsed;
          }
        }
      }

      if (endTs === null) continue;
      if (endTs < now) continue;
      const book = this.books.get(m.conditionId || m.id);
      if (!book) continue;
      out.push({ market: m, startTs: endTs - cycleLen * 1000, endTs, cycleLenSec: cycleLen });
    }
    out.sort((a, b) => a.endTs - b.endTs);
    return out.slice(0, 10);
  }

  /** dashboard market snapshot with edge calculations */
  public getMarketRows(): MarketRowDto[] {
    const t = this.store.get().trading;
    const feeRate = t.takerFeeBps / 10000;
    const gas = t.gasCostPerOrderUsd * 2;
    const rows: MarketRowDto[] = [];
    for (const book of this.books.values()) {
      const { yes, no } = book;
      let edgeLong: number | null = null;
      let edgeShort: number | null = null;
      let bundleAsk: number | null = null;
      let bundleBid: number | null = null;
      if (yes.bestAsk !== null && no.bestAsk !== null) {
        bundleAsk = yes.bestAsk + no.bestAsk;
        if (bundleAsk < 1) edgeLong = (1 - bundleAsk - feeRate * bundleAsk - gas) * 100;
      }
      if (yes.bestBid !== null && no.bestBid !== null) {
        bundleBid = yes.bestBid + no.bestBid;
        if (bundleBid > 1) edgeShort = (bundleBid - 1 - feeRate * bundleBid - gas) * 100;
      }
      rows.push({
        id: book.marketId,
        question: book.question,
        volume24h: book.volume24h,
        liquidity: book.liquidity,
        yesBid: yes.bestBid,
        yesAsk: yes.bestAsk,
        noBid: no.bestBid,
        noAsk: no.bestAsk,
        bundleAsk,
        bundleBid,
        edgeLongPct: edgeLong,
        edgeShortPct: edgeShort,
        spreadYes: yes.bestBid !== null && yes.bestAsk !== null ? yes.bestAsk - yes.bestBid : null,
        updatedAt: new Date(book.updatedAt).toISOString(),
      });
    }
    return rows;
  }

  public async warmup(): Promise<void> {
    await this.ensureMarkets(true);
    await this.refreshBooks();
  }
}

export { sleep };
