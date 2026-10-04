import { SettingsStore } from '../settings/SettingsStore';
import { RiskManager } from '../risk/RiskManager';
import { Portfolio } from '../portfolio/Portfolio';
import { ClobTrading } from '../polymarket/ClobTrading';
import { MarketBook, Opportunity, OrderSpec } from '../polymarket/types';

export interface ExecutionTradeInfo {
  marketId: string;
  question: string;
  side: 'YES' | 'NO';
  action: 'BUY' | 'SELL';
  price: number;
  size: number;
  notional: number;
  fee: number;
  realizedPnl: number;
  profit: number;
  success: boolean;
  strategy: string;
  dryRun: boolean;
  orderId?: string;
  sources?: string[];
}

export interface ExecutionDeps {
  addLog: (level: string, message: string, data?: any) => void;
  onTrade: (info: ExecutionTradeInfo) => void;
  getBook: (marketId: string) => MarketBook | undefined;
}

interface OpenOrder {
  id: string;
  spec: OrderSpec;
  price: number;
  sizeShares: number;
  placedAt: number;
  dryRun: boolean;
  status: 'open' | 'filled' | 'cancelled';
}

/**
 * Execution engine: immediate taker execution for bundle arbitrage and
 * BTC-signal bets, resting GTC orders (with paper fill simulation in
 * dry-run) for market making. Risk checks and edge re-validation before
 * every order, mirroring the reference bots.
 */
export class ExecutionEngine {
  private store: SettingsStore;
  private portfolio: Portfolio;
  private risk: RiskManager;
  private clob: ClobTrading;
  private deps: ExecutionDeps;
  private openOrders: OpenOrder[] = [];
  private stats = { placed: 0, filled: 0, cancelled: 0, rejected: 0 };
  private lastLivePoll: number = 0;

  constructor(store: SettingsStore, portfolio: Portfolio, risk: RiskManager, clob: ClobTrading, deps: ExecutionDeps) {
    this.store = store;
    this.portfolio = portfolio;
    this.risk = risk;
    this.clob = clob;
    this.deps = deps;
  }

  public getStats() {
    return { ...this.stats, openOrders: this.openOrders.filter(o => o.status === 'open').length };
  }

  // ---------- public ----------

  public async execute(opp: Opportunity): Promise<boolean> {
    if (Date.now() > opp.expiresAt) {
      this.stats.rejected++;
      return false;
    }
    switch (opp.type) {
      case 'bundle-long':
      case 'bundle-short':
        return this.executeBundle(opp);
      case 'market-making':
        return this.executeMarketMaking(opp);
      case 'btc-signal':
        return this.executeBtcSignal(opp);
      default:
        return false;
    }
  }

  /** called every bot loop tick: paper fill simulation, timeouts, live trade polling */
  public async tick(): Promise<void> {
    const dryRun = this.store.get().features.dryRun;
    if (dryRun && this.store.get().features.enableFillSimulation) {
      this.simulatePaperFills();
    } else if (!dryRun && this.clob.isReady()) {
      await this.pollLiveFills();
    }
    await this.cancelTimedOut();
  }

  public async cancelAllOpenOrders(): Promise<void> {
    const dryRun = this.store.get().features.dryRun;
    for (const o of this.openOrders) {
      if (o.status !== 'open') continue;
      o.status = 'cancelled';
      this.stats.cancelled++;
      if (!dryRun && o.id) await this.clob.cancelOrder(o.id);
    }
    if (!dryRun) await this.clob.cancelAllOrders();
    this.deps.addLog('info', `Cancelled all open orders`);
  }

  // ---------- strategies ----------

  private async executeBundle(opp: Opportunity): Promise<boolean> {
    const t = this.store.get().trading;
    const dryRun = this.store.get().features.dryRun;

    // re-validate against the live book (the edge may have vanished)
    const book = this.deps.getBook(opp.marketId);
    if (!book) { this.stats.rejected++; return false; }
    const isLong = opp.type === 'bundle-long';
    const sum = isLong
      ? (book.yes.bestAsk !== null && book.no.bestAsk !== null ? book.yes.bestAsk + book.no.bestAsk : null)
      : (book.yes.bestBid !== null && book.no.bestBid !== null ? book.yes.bestBid + book.no.bestBid : null);
    if (sum === null) { this.stats.rejected++; return false; }
    const edgePerShare = isLong
      ? 1 - sum - (t.takerFeeBps / 10000) * sum - t.gasCostPerOrderUsd * 2
      : sum - 1 - (t.takerFeeBps / 10000) * sum - t.gasCostPerOrderUsd * 2;
    if (edgePerShare < (t.minEdgePct / 100) * 0.5) {
      this.stats.rejected++;
      this.deps.addLog('info', `Opportunity vanished before execution: edge ${(edgePerShare * 100).toFixed(2)}%`, { kind: 'opportunity', type: opp.type, marketId: opp.marketId });
      return false;
    }

    // refresh legs from the live book
    const legs: OrderSpec[] = opp.orders.map((spec, i) => ({
      ...spec,
      tokenId: i === 0 ? book.yesTokenId : book.noTokenId,
      price: isLong ? (i === 0 ? book.yes.bestAsk! : book.no.bestAsk!) : (i === 0 ? book.yes.bestBid! : book.no.bestBid!),
      sizeShares: opp.sizeShares,
    }));

    let totalRealized = 0;
    let ok = true;
    for (const leg of legs) {
      const result = await this.fillOrder(leg, dryRun);
      if (!result.ok) {
        ok = false;
        this.deps.addLog('warn', `Bundle leg failed (${leg.sideLabel} ${leg.side} ${leg.price}): ${result.error}`);
        break;
      }
      totalRealized += result.realizedPnl;
    }

    if (!ok) {
      const loss = Math.min(0, totalRealized);
      this.deps.onTrade({
        marketId: opp.marketId, question: opp.question,
        side: legs[0]?.sideLabel || 'YES', action: isLong ? 'BUY' : 'SELL',
        price: legs[0]?.price || 0, size: 0, notional: 0,
        fee: 0, realizedPnl: loss, profit: loss, success: false,
        strategy: opp.type, dryRun,
      });
      return false;
    }

    // synthetic settlement for paper bundle positions: exactly ONE side of a
    // binary pair resolves to $1, the other to $0 — realized PnL equals the
    // captured edge either way (50/50 winner choice, same expected value)
    if (dryRun) {
      const winner: 'YES' | 'NO' = Math.random() < 0.5 ? 'YES' : 'NO';
      const settleAction: 'BUY' | 'SELL' = isLong ? 'SELL' : 'BUY';
      for (const sideLabel of ['YES', 'NO'] as const) {
        const settle: OrderSpec = {
          tokenId: sideLabel === 'YES' ? book.yesTokenId : book.noTokenId,
          side: settleAction, sideLabel,
          price: sideLabel === winner ? 1 : 0,
          sizeShares: opp.sizeShares,
          strategy: opp.type, marketId: opp.marketId, question: opp.question,
        };
        const settleResult = await this.fillOrder(settle, true, true);
        totalRealized += settleResult.realizedPnl;
      }
    }

    const profit = totalRealized;
    this.deps.onTrade({
      marketId: opp.marketId, question: opp.question,
      side: 'YES', action: isLong ? 'BUY' : 'SELL',
      price: legs[0].price, size: opp.sizeShares, notional: opp.orderUsd,
      fee: (t.takerFeeBps / 10000) * opp.orderUsd,
      realizedPnl: profit, profit, success: profit > 0,
      strategy: opp.type, dryRun, sources: opp.signalSources,
    });
    return true;
  }

  private async executeMarketMaking(opp: Opportunity): Promise<boolean> {
    const dryRun = this.store.get().features.dryRun;
    const book = this.deps.getBook(opp.marketId);
    if (!book || opp.side === undefined) { this.stats.rejected++; return false; }

    const notional = opp.sizeShares * ((opp.orders[0].price + opp.orders[1].price) / 2);
    const check = this.risk.checkOrder({ marketId: opp.marketId, notionalUsd: notional, volume24h: book.volume24h });
    if (!check.allowed) {
      this.stats.rejected++;
      this.deps.addLog('info', `MM order rejected by risk manager: ${check.reason}`, { kind: 'opportunity', type: opp.type, marketId: opp.marketId });
      return false;
    }

    const [buySpec, sellSpec] = opp.orders.map(spec => ({
      ...spec,
      tokenId: spec.sideLabel === 'YES' ? book.yesTokenId : book.noTokenId,
    }));

    if (dryRun) {
      for (const spec of [buySpec, sellSpec]) {
        this.openOrders.push({
          id: `paper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          spec, price: spec.price, sizeShares: spec.sizeShares,
          placedAt: Date.now(), dryRun: true, status: 'open',
        });
      }
      this.stats.placed += 2;
      this.deps.addLog('info', `MM orders placed (paper): ${opp.side} bid ${buySpec.price.toFixed(3)} / ask ${sellSpec.price.toFixed(3)} × ${opp.sizeShares.toFixed(1)}`, { kind: 'opportunity', type: opp.type, marketId: opp.marketId, side: opp.side, edgePct: opp.edgePct, sizeShares: opp.sizeShares, orderUsd: opp.orderUsd });
      return true;
    }

    await this.clob.init();
    if (!this.clob.isReady()) {
      this.deps.addLog('error', 'Live MM order skipped: live credentials are not initialized');
      return false;
    }
    let ok = true;
    for (const spec of [buySpec, sellSpec]) {
      const res = await this.clob.placeLimitOrder(spec);
      if (!res.ok) {
        ok = false;
        this.deps.addLog('warn', `Live MM order failed (${spec.side} ${spec.price}): ${res.error}`);
        break;
      }
      this.openOrders.push({
        id: res.orderId || `live-${Date.now()}`, spec, price: spec.price,
        sizeShares: spec.sizeShares, placedAt: Date.now(), dryRun: false, status: 'open',
      });
      this.stats.placed++;
    }
    return ok;
  }

  private async executeBtcSignal(opp: Opportunity): Promise<boolean> {
    const dryRun = this.store.get().features.dryRun;
    const book = this.deps.getBook(opp.marketId);
    const side = opp.side || 'YES';
    if (!book) { this.stats.rejected++; return false; }
    const tokenBook = side === 'YES' ? book.yes : book.no;
    const price = tokenBook.bestAsk;
    if (price === null || price <= 0.02) { this.stats.rejected++; return false; }

    const riskCheck = this.risk.checkOrder({ marketId: opp.marketId, notionalUsd: opp.orderUsd, volume24h: book.volume24h });
    if (!riskCheck.allowed) {
      this.stats.rejected++;
      this.deps.addLog('info', `BTC signal order rejected by risk manager: ${riskCheck.reason}`, { kind: 'opportunity', type: opp.type, marketId: opp.marketId, score: opp.score });
      return false;
    }

    const spec: OrderSpec = {
      tokenId: side === 'YES' ? book.yesTokenId : book.noTokenId,
      side: 'BUY', sideLabel: side, price, sizeShares: opp.sizeShares,
      strategy: 'btc-signal', marketId: opp.marketId, question: opp.question,
    };

    if (dryRun) {
      const fill = this.fillPaper(spec, false);
      // reference paper model: movement uniform per direction
      const bullish = opp.reason?.startsWith('BULLISH');
      const movement = bullish ? -0.02 + Math.random() * 0.10 : -0.08 + Math.random() * 0.10;
      const exitPrice = Math.min(0.99, Math.max(0.01, price * (1 + movement)));
      const sellFee = (this.store.get().polymarket.paperFillFeeBps / 10000) * exitPrice * opp.sizeShares;
      const sell = this.portfolio.applyFill({
        marketId: opp.marketId, question: opp.question, side,
        action: 'SELL', price: exitPrice, size: opp.sizeShares, fee: sellFee,
        strategy: 'btc-signal', dryRun: true,
      });
      const profit = sell.realizedPnl - fill.fee - sellFee;
      this.deps.onTrade({
        marketId: opp.marketId, question: opp.question, side, action: 'BUY',
        price, size: opp.sizeShares, notional: opp.orderUsd,
        fee: fill.fee + sellFee, realizedPnl: sell.realizedPnl,
        profit, success: profit > 0, strategy: 'btc-signal', dryRun: true,
        sources: opp.signalSources,
      });
      return true;
    }

    await this.clob.init();
    if (!this.clob.isReady()) {
      this.deps.addLog('error', 'Live BTC signal skipped: live credentials are not initialized');
      return false;
    }
    const res = await this.clob.placeLimitOrder(spec);
    if (!res.ok) {
      this.deps.addLog('warn', `Live BTC signal order failed: ${res.error}`);
      return false;
    }
    this.stats.placed++;
    this.deps.addLog('success', `Live BTC order placed: BUY ${side} ${price.toFixed(3)} × ${opp.sizeShares.toFixed(1)} ($${opp.orderUsd.toFixed(2)})`, { kind: 'opportunity', type: opp.type, marketId: opp.marketId, score: opp.score });
    return true;
  }

  // ---------- fill machinery ----------

  private async fillOrder(spec: OrderSpec, dryRun: boolean, zeroFee: boolean = false): Promise<{ ok: boolean; realizedPnl: number; fee: number; error?: string }> {
    if (dryRun) {
      const fill = this.fillPaper(spec, zeroFee);
      return { ok: fill.ok, realizedPnl: fill.realizedPnl, fee: fill.fee, error: fill.error };
    }
    await this.clob.init();
    if (!this.clob.isReady()) return { ok: false, realizedPnl: 0, fee: 0, error: 'live client not ready' };
    const res = await this.clob.placeLimitOrder(spec);
    if (!res.ok) return { ok: false, realizedPnl: 0, fee: 0, error: res.error };
    this.stats.placed++;
    this.openOrders.push({
      id: res.orderId || `live-${Date.now()}`, spec, price: spec.price, sizeShares: spec.sizeShares,
      placedAt: Date.now(), dryRun: false, status: 'open',
    });
    return { ok: true, realizedPnl: 0, fee: 0 };
  }

  private fillPaper(spec: OrderSpec, zeroFee: boolean = false): { ok: boolean; realizedPnl: number; fee: number; error?: string } {
    const feeBps = zeroFee ? 0 : this.store.get().polymarket.paperFillFeeBps;
    const notional = spec.price * spec.sizeShares;
    const fee = (feeBps / 10000) * notional;
    const { realizedPnl } = this.portfolio.applyFill({
      marketId: spec.marketId, question: spec.question, side: spec.sideLabel,
      action: spec.side, price: spec.price, size: spec.sizeShares, fee,
      strategy: spec.strategy, dryRun: true,
    });
    this.stats.placed++;
    this.stats.filled++;
    return { ok: true, realizedPnl, fee };
  }

  private simulatePaperFills(): void {
    const probability = this.store.get().polymarket.fillProbability;
    for (const order of this.openOrders) {
      if (order.status !== 'open' || !order.dryRun) continue;
      if (Math.random() >= probability) continue;
      const fee = (this.store.get().polymarket.paperFillFeeBps / 10000) * order.price * order.sizeShares;
      const { realizedPnl } = this.portfolio.applyFill({
        marketId: order.spec.marketId, question: order.spec.question, side: order.spec.sideLabel,
        action: order.spec.side, price: order.price, size: order.sizeShares, fee,
        strategy: order.spec.strategy, dryRun: true,
      });
      order.status = 'filled';
      this.stats.filled++;
      const profit = order.spec.side === 'SELL' ? realizedPnl - fee : -fee;
      this.deps.onTrade({
        marketId: order.spec.marketId, question: order.spec.question, side: order.spec.sideLabel,
        action: order.spec.side, price: order.price, size: order.sizeShares,
        notional: order.price * order.sizeShares, fee,
        realizedPnl, profit, success: profit > 0,
        strategy: order.spec.strategy, dryRun: true, orderId: order.id,
      });
    }
    this.openOrders = this.openOrders.filter(o => o.status === 'open');
    if (this.openOrders.length > 500) this.openOrders = this.openOrders.slice(-500);
  }

  private async pollLiveFills(): Promise<void> {
    if (Date.now() - this.lastLivePoll < 10_000) return;
    this.lastLivePoll = Date.now();
    try {
      const trades = await this.clob.getTrades();
      if (!Array.isArray(trades)) return;
      const openCount = this.openOrders.filter(o => o.status === 'open' && !o.dryRun).length;
      if (openCount === 0) return;
      for (const tr of trades) {
        const status = String(tr?.status || '').toUpperCase();
        if (status !== 'MATCHED' && status !== 'FILLED') continue;
        const token = String(tr?.asset_id || tr?.token_id || '');
        const side = String(tr?.side || '').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
        const match = this.openOrders.find(o => o.status === 'open' && !o.dryRun && o.spec.tokenId === token && o.spec.side === side);
        if (!match) continue;
        match.status = 'filled';
        this.stats.filled++;
        const price = Number(tr.price) || match.price;
        const size = Number(tr.size) || match.sizeShares;
        const { realizedPnl } = this.portfolio.applyFill({
          marketId: match.spec.marketId, question: match.spec.question, side: match.spec.sideLabel,
          action: side as 'BUY' | 'SELL', price, size, fee: 0,
          strategy: match.spec.strategy, dryRun: false,
        });
        const profit = side === 'SELL' ? realizedPnl : 0;
        this.deps.onTrade({
          marketId: match.spec.marketId, question: match.spec.question, side: match.spec.sideLabel,
          action: side as 'BUY' | 'SELL', price, size, notional: price * size, fee: 0,
          realizedPnl, profit, success: true, strategy: match.spec.strategy, dryRun: false,
        });
      }
    } catch { /* polling is best-effort */ }
  }

  private async cancelTimedOut(): Promise<void> {
    const timeoutMs = this.store.get().trading.orderTimeoutSec * 1000;
    const now = Date.now();
    for (const order of this.openOrders) {
      if (order.status !== 'open') continue;
      if (now - order.placedAt < timeoutMs) continue;
      order.status = 'cancelled';
      this.stats.cancelled++;
      if (!order.dryRun && order.id) await this.clob.cancelOrder(order.id);
      this.deps.addLog('info', `Order timed out and cancelled: ${order.spec.side} ${order.spec.sideLabel} @ ${order.spec.price}`);
    }
  }
}
