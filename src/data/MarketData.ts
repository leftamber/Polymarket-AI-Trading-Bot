import { logger } from '../logger';

/**
 * External market data for the BTC 15-minute signal pipeline:
 * spot price (Coinbase -> Binance fallback), Fear & Greed index,
 * Deribit BTC options Put/Call ratio.
 */
export class MarketData {
  private spotCache: { price: number; source: string; ts: number } | null = null;
  private fngCache: { value: number; ts: number } | null = null;
  private pcrCache: { value: number; ts: number } | null = null;

  private readonly spotTtlMs = 10_000;
  private readonly fngTtlMs = 300_000;
  private readonly pcrTtlMs = 300_000;

  public async fetchSpotPrice(asset: string = 'BTC'): Promise<{ price: number; source: string } | null> {
    if (this.spotCache && Date.now() - this.spotCache.ts < this.spotTtlMs) {
      return { price: this.spotCache.price, source: this.spotCache.source };
    }
    const symbols: Record<string, string> = { BTC: 'BTC-USD', ETH: 'ETH-USD', SOL: 'SOL-USD', XRP: 'XRP-USD' };
    const cbSymbol = symbols[asset] || 'BTC-USD';

    try {
      const res = await fetch(`https://api.exchange.coinbase.com/products/${cbSymbol}/ticker`, {
        headers: { 'User-Agent': 'PolymarketBot/1.0' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const json: any = await res.json();
        const price = Number(json?.price);
        if (Number.isFinite(price) && price > 0) {
          this.spotCache = { price, source: 'coinbase', ts: Date.now() };
          return { price, source: 'coinbase' };
        }
      }
    } catch { /* fall through */ }

    try {
      const binSymbol = `${asset}USDT`;
      const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${binSymbol}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const json: any = await res.json();
        const price = Number(json?.price);
        if (Number.isFinite(price) && price > 0) {
          this.spotCache = { price, source: 'binance', ts: Date.now() };
          return { price, source: 'binance' };
        }
      }
    } catch { /* fall through */ }

    logger.debug('Spot price fetch failed (coinbase + binance)');
    return null;
  }

  public async fetchFearGreed(): Promise<number | null> {
    if (this.fngCache && Date.now() - this.fngCache.ts < this.fngTtlMs) return this.fngCache.value;
    try {
      const res = await fetch('https://api.alternative.me/fng/', { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const json: any = await res.json();
        const value = Number(json?.data?.[0]?.value);
        if (Number.isFinite(value)) {
          this.fngCache = { value, ts: Date.now() };
          return value;
        }
      }
    } catch { /* ignore */ }
    return this.fngCache?.value ?? null;
  }

  public async fetchDeribitPcr(asset: string = 'BTC'): Promise<number | null> {
    if (asset !== 'BTC') return null; // Deribit options pipeline is BTC-specific
    if (this.pcrCache && Date.now() - this.pcrCache.ts < this.pcrTtlMs) return this.pcrCache.value;
    try {
      const res = await fetch(
        'https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option',
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const json: any = await res.json();
        const rows: any[] = json?.result || [];
        let putOi = 0, callOi = 0;
        for (const row of rows) {
          const name: string = String(row?.instrument_name || '');
          const openInterest = Number(row?.open_interest || 0);
          if (openInterest < 100) continue;
          const isPut = /-P$/.test(name);
          const isCall = /-C$/.test(name);
          if (isPut) putOi += openInterest;
          else if (isCall) callOi += openInterest;
        }
        if (callOi > 0) {
          const pcr = putOi / callOi;
          this.pcrCache = { value: pcr, ts: Date.now() };
          return pcr;
        }
      }
    } catch { /* ignore */ }
    return this.pcrCache?.value ?? null;
  }

  public getBtcSnapshot(asset: string = 'BTC'): Promise<{ price: number; source: string } | null> {
    return this.fetchSpotPrice(asset);
  }
}
