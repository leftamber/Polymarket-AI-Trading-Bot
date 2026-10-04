import React, { useEffect, useState } from 'react';
import { api, Opportunity, PortfolioData, Stats } from './api';

function fmtUptime(sec: number): string {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function money(v: number): string {
  const sign = v < 0 ? '-' : '';
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="card stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={accent ? { color: accent } : undefined}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function ProfitChart({ history }: { history: Array<{ t: number; profit: number; balance: number }> }) {
  const data = history.slice(-60);
  if (data.length === 0) {
    return <div className="empty-note">No trades yet — profit chart will appear here.</div>;
  }
  const max = Math.max(...data.map(d => Math.abs(d.profit)), 0.01);
  return (
    <div className="chart">
      {data.map((d, i) => {
        const h = Math.max(4, (Math.abs(d.profit) / max) * 100);
        const positive = d.profit >= 0;
        return (
          <div key={i} className="chart-col" title={`${new Date(d.t).toLocaleTimeString()} | ${money(d.profit)}`}>
            <div
              className={`chart-bar ${positive ? 'pos' : 'neg'}`}
              style={{ height: `${h}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

function OpportunitiesTable({ opportunities }: { opportunities: Opportunity[] }) {
  const rows = opportunities.slice(-15).reverse();
  if (rows.length === 0) {
    return <div className="empty-note">No opportunities detected yet. Lower trading.minEdgePct or enable more strategies in Settings.</div>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Type</th>
            <th>Market</th>
            <th>Side</th>
            <th>Order</th>
            <th>Edge</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o, i) => (
            <tr key={i}>
              <td className="mono">{new Date(o.timestamp).toLocaleTimeString()}</td>
              <td><span className="src-chip">{o.type}</span></td>
              <td className="q-cell" title={o.question}>{o.question}</td>
              <td className="mono">{o.side || '—'}</td>
              <td className="mono">${o.orderUsd.toFixed(2)} · {o.sizeShares.toFixed(1)} sh</td>
              <td className={`mono ${(o.edgePct || 0) >= 0 ? 'pos-text' : 'neg-text'}`}>
                {o.edgePct.toFixed(2)}% ({money(o.profitUsd)})
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PositionsTable({ portfolio }: { portfolio: PortfolioData | null }) {
  if (!portfolio || portfolio.positions.length === 0) {
    return <div className="empty-note">No open positions. Trades appear here after the first fill (real or paper).</div>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Market</th>
            <th>Side</th>
            <th>Size</th>
            <th>Entry</th>
            <th>Mark</th>
            <th>Unrealized</th>
            <th>Realized</th>
          </tr>
        </thead>
        <tbody>
          {portfolio.positions.map((p, i) => (
            <tr key={i}>
              <td className="q-cell" title={p.question}>{p.question}</td>
              <td><span className="net-chip">{p.side}</span></td>
              <td className="mono">{p.size.toFixed(1)}</td>
              <td className="mono price-cell">{p.avgEntry.toFixed(3)}</td>
              <td className="mono price-cell">{p.currentPrice > 0 ? p.currentPrice.toFixed(3) : '—'}</td>
              <td className={`mono ${p.unrealizedPnl >= 0 ? 'pos-text' : 'neg-text'}`}>{money(p.unrealizedPnl)}</td>
              <td className={`mono ${p.realizedPnl >= 0 ? 'pos-text' : 'neg-text'}`}>{money(p.realizedPnl)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Overview({ stats, opportunities, apiOnline }: { stats: Stats; opportunities: Opportunity[]; apiOnline: boolean }) {
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const p = await api<PortfolioData>('/api/portfolio');
        if (alive) setPortfolio(p);
      } catch { /* offline */ }
    };
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return (
    <div>
      {!apiOnline && <div className="banner banner-error">API offline — bot process may be down.</div>}
      {stats.riskStats.killSwitchTriggered && (
        <div className="banner banner-error">⛔ Kill switch: {stats.riskStats.killSwitchReason} — disable it in Settings → Risk</div>
      )}
      {stats.riskStats.emergencyPaused && !stats.riskStats.killSwitchTriggered && (
        <div className="banner banner-warn">⚠ Risk manager: emergency pause is ACTIVE</div>
      )}
      {!stats.dryRun && (
        <div className="banner banner-info">LIVE MODE: orders are signed and sent to Polymarket with real USDC</div>
      )}

      <div className="stat-grid">
        <StatCard label="Status" value={stats.status === 'running' ? 'Running' : 'Stopped'} accent={stats.status === 'running' ? '#10b981' : '#6b7280'} sub={`${stats.mode}${stats.dryRun ? ' · dry-run' : ' · LIVE'}`} />
        <StatCard label="Total PnL" value={money(stats.totalProfit)} accent={stats.totalProfit >= 0 ? '#10b981' : '#ef4444'} sub={`daily: ${money(stats.dailyPnl)}`} />
        <StatCard label="ROI" value={`${stats.roiPct.toFixed(2)}%`} accent={stats.roiPct >= 0 ? '#22d3ee' : '#ef4444'} sub="profit / deployed capital" />
        <StatCard label="Cash" value={money(stats.cashBalance)} sub={`exposure: ${money(stats.exposureUsd)}`} />
        <StatCard label="Trades" value={String(stats.totalTrades)} sub={`${stats.successfulTrades} ok / ${stats.failedTrades} failed`} />
        <StatCard label="Success Rate" value={`${stats.successRate.toFixed(1)}%`} sub={`${stats.opportunitiesFound} opportunities found`} />
        <StatCard label="Markets" value={String(stats.marketsMonitored)} sub="monitored with books" />
        <StatCard label="Risk" value={stats.riskStats.killSwitchTriggered ? 'KILLED' : stats.riskStats.emergencyPaused ? 'PAUSED' : `${stats.riskStats.consecutiveFailures} fails`} accent={stats.riskStats.killSwitchTriggered || stats.riskStats.emergencyPaused ? '#ef4444' : '#6b7280'} sub={`tracked: ${stats.riskStats.tradesTracked} trades`} />
      </div>

      <div className="card">
        <div className="card-title">Profit per trade <span className="card-hint">last 60 trades</span></div>
        <ProfitChart history={stats.profitHistory} />
      </div>

      <div className="card">
        <div className="card-title">Recent opportunities</div>
        <OpportunitiesTable opportunities={opportunities} />
      </div>

      <div className="card">
        <div className="card-title">Open positions</div>
        <PositionsTable portfolio={portfolio} />
      </div>
    </div>
  );
}

export default Overview;
