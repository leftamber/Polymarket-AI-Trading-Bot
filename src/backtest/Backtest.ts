import { SettingsStore } from '../settings/SettingsStore';
import { logger } from '../logger';
import { ArbEngine } from '../trading/ArbEngine';
import { MarketBook, TokenBook } from '../polymarket/types';

/**
 * Backtest engine (port of utils/backtest.py): random-walk simulated order
 * books with occasional mispricing events, streamed through the real
 * ArbEngine. Fill probability models execution uncertainty.
 */

export interface BacktestResult {
  durationSec: number;
  markets: number;
  initialBalance: number;
  finalBalance: number;
  realizedPnl: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  bundleOpportunities: number;
  mmOpportunities: number;
  actedOn: number;
  maxDrawdownPct: number;
  maxExposureUsd: number;
  steps: number;
}

class SimulatedOrderBook {
  private yesMid: number;
  private ineff: number = 0; // persistent YES+NO sum deviation (bundle-arb source)
  private rng: () => number;

  constructor(private marketId: string, private question: string, rng: () => number) {
    this.yesMid = 0.5;
    this.rng = rng;
  }

  private uniform(min: number, max: number): number {
    return min + this.rng() * (max - min);
  }

  public step(): MarketBook {
    // random walk on the YES price
    this.yesMid += this.gauss() * 0.01;
    // mispricing event (5%): jump the YES+NO sum away from $1
    if (this.rng() < 0.05) {
      this.ineff += this.uniform(0.02, 0.06) * (this.rng() < 0.5 ? -1 : 1);
    }
    // slow mean reversion of the inefficiency
    this.ineff = this.ineff * 0.97 + this.gauss() * 0.004;
    this.ineff = Math.min(0.12, Math.max(-0.12, this.ineff));
    this.yesMid = Math.min(0.95, Math.max(0.05, this.yesMid));
    const noMid = Math.min(0.95, Math.max(0.05, 1 - this.yesMid + this.ineff));

    const makeBook = (mid: number): TokenBook => {
      const spread = this.uniform(0.02, 0.06);
      const bid = Math.max(0.01, mid - spread / 2);
      const ask = Math.min(0.99, mid + spread / 2);
      const bids = [], asks = [];
      for (let i = 0; i < 5; i++) {
        const liq = 1000 / (1 + 0.3 * i) * this.uniform(0.5, 1.5);
        bids.push({ price: Math.max(0.01, bid - i * 0.01), size: liq });
        asks.push({ price: Math.min(0.99, ask + i * 0.01), size: liq });
      }
      return {
        bestBid: bids[0].price, bestAsk: asks[0].price,
        bestBidSize: bids[0].size, bestAskSize: asks[0].size,
        bids, asks,
      };
    };

    return {
      marketId: this.marketId,
      conditionId: this.marketId,
      question: this.question,
      volume24h: 100000,
      liquidity: 10000,
      yesTokenId: `${this.marketId}-yes`,
      noTokenId: `${this.marketId}-no`,
      yes: makeBook(this.yesMid),
      no: makeBook(noMid),
      updatedAt: Date.now(),
    };
  }

  private gauss(): number {
    let u = 0, v = 0;
    while (u === 0) u = this.rng();
    while (v === 0) v = this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}

export class BacktestEngine {
  private store: SettingsStore;

  constructor(store: SettingsStore) {
    this.store = store;
  }

  /**
   * Run a simulated backtest for durationSec with N markets, feeding
   * synthetic books through the real ArbEngine at 1s steps.
   */
  public async run(durationSec: number = 300, marketCount: number = 3): Promise<BacktestResult> {
    const t = this.store.get().trading;
    const initialBalance = this.store.get().polymarket.dryRunInitialBalanceUsd;
    const fillProbability = this.store.get().polymarket.fillProbability;

    const rng = this.seededRng(42);
    const engine = new ArbEngine(this.store);
    const books: SimulatedOrderBook[] = [];
    for (let i = 0; i < marketCount; i++) {
      books.push(new SimulatedOrderBook(`bt_market_${i}`, `Backtest market #${i + 1}`, rng));
    }

    let balance = initialBalance;
    let peakBalance = initialBalance;
    let maxDrawdownPct = 0;
    let maxExposure = 0;
    let trades = 0, wins = 0, losses = 0;
    let bundleOpps = 0, mmOpps = 0, actedOn = 0;
    const cooldowns = new Map<string, number>();

    const steps = Math.max(1, Math.floor(durationSec));
    for (let step = 0; step < steps; step++) {
      for (const sim of books) {
        const book = sim.step();
        const opp = engine.analyze(book);
        if (!opp) continue;
        if (opp.type === 'bundle-long' || opp.type === 'bundle-short') bundleOpps++;
        else mmOpps++;

        // dedupe with cooldowns like the live engine
        const key = `${opp.type}_${opp.marketId}_${opp.side || ''}`;
        const last = cooldowns.get(key) || 0;
        if (step - last < (opp.type === 'market-making' ? 5 : 2)) continue;
        cooldowns.set(key, step);

        if (rng() >= fillProbability) continue;
        actedOn++;
        trades++;

        const exposure = opp.orderUsd;
        maxExposure = Math.max(maxExposure, exposure);
        if (exposure > t.maxOrderSizeUsd) continue; // risk cap in the backtest too

        // opp.profitUsd is already NET of taker fees and gas (see ArbEngine)
        const profit = opp.profitUsd;
        balance += profit;
        if (profit > 0) wins++; else losses++;
        peakBalance = Math.max(peakBalance, balance);
        if (peakBalance > 0) {
          maxDrawdownPct = Math.max(maxDrawdownPct, ((peakBalance - balance) / peakBalance) * 100);
        }
      }
      await new Promise(resolve => setTimeout(resolve, 1)); // 1ms per step (1s of sim time)
    }

    const result: BacktestResult = {
      durationSec: steps,
      markets: marketCount,
      initialBalance,
      finalBalance: balance,
      realizedPnl: balance - initialBalance,
      totalTrades: trades,
      wins,
      losses,
      winRate: trades > 0 ? (wins / trades) * 100 : 0,
      bundleOpportunities: bundleOpps,
      mmOpportunities: mmOpps,
      actedOn,
      maxDrawdownPct,
      maxExposureUsd: maxExposure,
      steps,
    };
    logger.info(`Backtest finished: pnl $${result.realizedPnl.toFixed(2)}, ${trades} trades, win rate ${result.winRate.toFixed(1)}%, max drawdown ${maxDrawdownPct.toFixed(1)}%`);
    return result;
  }

  private seededRng(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }
}

