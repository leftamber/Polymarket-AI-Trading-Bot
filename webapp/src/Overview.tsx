import React from 'react';
import { Opportunity, Stats, tokenSymbol } from './api';

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
    return <div className="empty-note">No opportunities detected yet. Check Settings → scan mode and token watch list.</div>;
  }
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Network</th>
            <th>Route</th>
            <th>Tokens</th>
            <th>Amount</th>
            <th>Profit</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o, i) => (
            <tr key={i}>
              <td className="mono">{new Date(o.timestamp).toLocaleTimeString()}</td>
              <td><span className="net-chip">{o.network || '—'}</span></td>
              <td className="mono">{o.dexIn} → {o.dexOut}</td>
              <td className="mono">{tokenSymbol(o.tokenIn)} → {tokenSymbol(o.tokenOut)}</td>
              <td className="mono">{o.inputAmount || '—'}</td>
              <td className={`mono ${(o.profitEstimate || 0) >= 0 ? 'pos-text' : 'neg-text'}`}>
                {o.profitEstimate !== undefined ? `$${o.profitEstimate.toFixed(2)} (${(o.profitPct || 0).toFixed(2)}%)` : '—'}
              </td>
              <td><span className="src-chip">{o.source || o.type}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Overview({ stats, opportunities, apiOnline }: { stats: Stats; opportunities: Opportunity[]; apiOnline: boolean }) {
  const balances = Object.entries(stats.walletBalances);
  const lastBalance = stats.profitHistory.length > 0 ? stats.profitHistory[stats.profitHistory.length - 1].balance : stats.totalProfit;
  const change = lastBalance - 0;

  return (
    <div>
      {!apiOnline && <div className="banner banner-error">API offline — bot process may be down.</div>}
      {stats.riskStats.emergencyPaused && <div className="banner banner-warn">⚠ Risk manager: emergency pause is ACTIVE</div>}

      <div className="stat-grid">
        <StatCard label="Status" value={stats.status === 'running' ? 'Running' : 'Stopped'} accent={stats.status === 'running' ? '#10b981' : '#6b7280'} sub={stats.dryRun ? 'dry-run mode' : 'live execution'} />
        <StatCard label="Total Profit" value={money(stats.totalProfit)} accent={stats.totalProfit >= 0 ? '#10b981' : '#ef4444'} sub={`daily: ${money(stats.dailyPnl)}`} />
        <StatCard label="ROI" value={`${stats.roiPct.toFixed(2)}%`} accent={stats.roiPct >= 0 ? '#22d3ee' : '#ef4444'} sub="profit / deployed capital" />
        <StatCard label="Balance Change" value={money(change)} accent={change >= 0 ? '#10b981' : '#ef4444'} sub={`current: ${money(lastBalance)}`} />
        <StatCard label="Trades" value={String(stats.totalTrades)} sub={`${stats.successfulTrades} ok / ${stats.failedTrades} failed`} />
        <StatCard label="Success Rate" value={`${stats.successRate.toFixed(1)}%`} sub={`${stats.opportunitiesFound} opportunities found`} />
        <StatCard label="Uptime" value={fmtUptime(stats.uptimeSec)} sub={stats.networksEnabled.join(', ') || 'no networks'} />
        <StatCard label="Risk" value={stats.riskStats.emergencyPaused ? 'PAUSED' : `${stats.riskStats.consecutiveFailures} fails`} accent={stats.riskStats.emergencyPaused ? '#ef4444' : '#6b7280'} sub={`tracked: ${stats.riskStats.tradesTracked} trades`} />
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
        <div className="card-title">Wallet balances</div>
        {balances.length === 0 ? (
          <div className="empty-note">No wallet balances reported yet. Wallets are configured via .env (PRIVATE_KEY_*, *_ADDRESS).</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Network</th><th>Address</th><th>Balance</th></tr></thead>
              <tbody>
                {balances.map(([net, val]) => (
                  <tr key={net}>
                    <td><span className="net-chip">{net}</span></td>
                    <td className="mono">{val}</td>
                    <td className="mono">—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default Overview;