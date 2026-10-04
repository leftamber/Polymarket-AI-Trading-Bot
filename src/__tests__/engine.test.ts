import { SettingsStore } from '../settings/SettingsStore';
import { ArbEngine } from '../trading/ArbEngine';
import { RiskManager } from '../risk/RiskManager';
import { Portfolio } from '../portfolio/Portfolio';
import { MarketBook } from '../polymarket/types';
import fs from 'fs';
import path from 'path';
import os from 'os';

function tempStore(overrides: Record<string, any> = {}): SettingsStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pmb-test-'));
  const store = new SettingsStore(path.join(dir, 'settings.json'));
  if (Object.keys(overrides).length > 0) {
    store.update(overrides);
  }
  return store;
}

function book(partial: Partial<{
  yesBid: number; yesAsk: number; noBid: number; noAsk: number;
  yesBidSize: number; yesAskSize: number; noBidSize: number; noAskSize: number;
}>): MarketBook {
  return {
    marketId: 'm1',
    conditionId: 'c1',
    question: 'Test market?',
    volume24h: 100000,
    liquidity: 10000,
    yesTokenId: 'y1',
    noTokenId: 'n1',
    yes: {
      bestBid: partial.yesBid ?? null, bestAsk: partial.yesAsk ?? null,
      bestBidSize: partial.yesBidSize ?? 100, bestAskSize: partial.yesAskSize ?? 100,
      bids: partial.yesBid ? [{ price: partial.yesBid, size: 100 }] : [],
      asks: partial.yesAsk ? [{ price: partial.yesAsk, size: 100 }] : [],
    },
    no: {
      bestBid: partial.noBid ?? null, bestAsk: partial.noAsk ?? null,
      bestBidSize: partial.noBidSize ?? 100, bestAskSize: partial.noAskSize ?? 100,
      bids: partial.noBid ? [{ price: partial.noBid, size: 100 }] : [],
      asks: partial.noAsk ? [{ price: partial.noAsk, size: 100 }] : [],
    },
    updatedAt: Date.now(),
  };
}

describe('ArbEngine bundle math', () => {
  it('detects bundle long when ask sum < 1 minus fees', () => {
    const store = tempStore();
    const engine = new ArbEngine(store);
    const opp = engine.analyzeBundle(book({ yesBid: 0.40, yesAsk: 0.44, noBid: 0.44, noAsk: 0.48 }));
    expect(opp).not.toBeNull();
    expect(opp!.type).toBe('bundle-long');
    // 1 - 0.92 = 0.08 gross; fees 150bps*0.92 + gas 0.04 -> ~2.6% net
    expect(opp!.edgePct).toBeGreaterThan(2);
    expect(opp!.profitUsd).toBeGreaterThan(0);
  });

  it('detects bundle short when bid sum > 1', () => {
    const store = tempStore();
    const engine = new ArbEngine(store);
    const opp = engine.analyzeBundle(book({ yesBid: 0.58, yesAsk: 0.62, noBid: 0.52, noAsk: 0.58 }));
    expect(opp).not.toBeNull();
    expect(opp!.type).toBe('bundle-short');
  });

  it('ignores efficient books', () => {
    const store = tempStore();
    const engine = new ArbEngine(store);
    expect(engine.analyzeBundle(book({ yesAsk: 0.55, noAsk: 0.50, yesBid: 0.50, noBid: 0.45 }))).toBeNull();
  });

  it('respects cooldown after firing', () => {
    const store = tempStore();
    const engine = new ArbEngine(store);
    const b = book({ yesBid: 0.40, yesAsk: 0.44, noBid: 0.44, noAsk: 0.48 });
    expect(engine.analyzeBundle(b)).not.toBeNull();
    expect(engine.analyzeBundle(b)).toBeNull(); // cooldown 2s
  });

  it('market making fires on wide spreads', () => {
    const store = tempStore({ trading: {} });
    store.update({ features: { enableMarketMaking: true } });
    const engine = new ArbEngine(store);
    const opp = engine.analyzeMarketMaking(book({ yesBid: 0.40, yesAsk: 0.50 }));
    expect(opp).not.toBeNull();
    expect(opp!.type).toBe('market-making');
    expect(opp!.side).toBe('YES');
  });
});

describe('RiskManager', () => {
  it('blocks orders above per-market exposure', () => {
    const store = tempStore({ risk: { maxPositionPerMarketUsd: 15, maxGlobalExposureUsd: 50 } });
    const risk = new RiskManager(store);
    risk.applyFill('m1', 10, 'BUY');
    const check = risk.checkOrder({ marketId: 'm1', notionalUsd: 10, volume24h: 1000 });
    expect(check.allowed).toBe(false);
    const checkOther = risk.checkOrder({ marketId: 'm2', notionalUsd: 10, volume24h: 1000 });
    expect(checkOther.allowed).toBe(true);
  });

  it('triggers kill switch after daily loss limit', () => {
    const store = tempStore({ risk: { maxDailyLossUsd: 10, killSwitchEnabled: true } });
    const risk = new RiskManager(store);
    risk.recordTrade(-11, false);
    const summary = risk.getSummary();
    expect(summary.killSwitchTriggered).toBe(true);
    const check = risk.isTradeAllowedNow();
    expect(check.allowed).toBe(false);
  });
});

describe('Portfolio long/short accounting', () => {
  // empty filePath = in-memory portfolio (no persistence between tests)
  const fill = (p: Portfolio, over: Partial<{ action: 'BUY' | 'SELL'; price: number; size: number; side: 'YES' | 'NO' }>) =>
    p.applyFill({
      marketId: 'm', question: 'q', side: over.side ?? 'YES',
      action: over.action ?? 'BUY', price: over.price ?? 0.5, size: over.size ?? 10,
      fee: 0, strategy: 'test', dryRun: true,
    });

  it('long: buy low, sell high realizes profit', () => {
    const p = new Portfolio(100, '');
    fill(p, { action: 'BUY', price: 0.4, size: 10 });
    const sell = fill(p, { action: 'SELL', price: 0.6, size: 10 });
    expect(sell.realizedPnl).toBeCloseTo(2, 6);
    expect(p.getCashBalance()).toBeCloseTo(102, 6);
  });

  it('short: sell high first, cover low realizes profit', () => {
    const p = new Portfolio(100, '');
    const open = fill(p, { action: 'SELL', price: 0.6, size: 10 });
    expect(open.realizedPnl).toBe(0); // opening a short realizes nothing
    const cover = fill(p, { action: 'BUY', price: 0.4, size: 10 });
    expect(cover.realizedPnl).toBeCloseTo(2, 6);
    expect(p.getCashBalance()).toBeCloseTo(102, 6);
  });

  it('bundle-short settlement: one side $1, other $0 -> realized = bidSum-1', () => {
    const p = new Portfolio(1000, '');
    const shares = 10;
    fill(p, { action: 'SELL', price: 0.58, size: shares, side: 'YES' }); // short YES
    fill(p, { action: 'SELL', price: 0.52, size: shares, side: 'NO' });  // short NO
    const winner: 'YES' | 'NO' = Math.random() < 0.5 ? 'YES' : 'NO';
    fill(p, { action: 'BUY', price: 1, size: shares, side: winner });    // cover winner at $1
    fill(p, { action: 'BUY', price: 0, size: shares, side: winner === 'YES' ? 'NO' : 'YES' }); // loser at $0
    const realized = p.getRealizedPnl();
    // (0.58 + 0.52 - 1) * 10 = 1.0 regardless of the winner
    expect(realized).toBeCloseTo(1.0, 6);
  });

  it('bundle-long settlement: sell winner at $1, loser at $0 -> realized = 1-askSum', () => {
    const p = new Portfolio(1000, '');
    const shares = 10;
    fill(p, { action: 'BUY', price: 0.46, size: shares, side: 'YES' });
    fill(p, { action: 'BUY', price: 0.47, size: shares, side: 'NO' });
    const winner: 'YES' | 'NO' = Math.random() < 0.5 ? 'YES' : 'NO';
    fill(p, { action: 'SELL', price: 1, size: shares, side: winner });
    fill(p, { action: 'SELL', price: 0, size: shares, side: winner === 'YES' ? 'NO' : 'YES' });
    expect(p.getRealizedPnl()).toBeCloseTo((1 - 0.46 - 0.47) * shares, 6);
  });
});
