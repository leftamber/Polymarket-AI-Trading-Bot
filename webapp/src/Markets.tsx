import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, MarketRow } from './api';

function pct(v: number | null): string {
  if (v === null || v === undefined) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function price(v: number | null): string {
  if (v === null || v === undefined) return '—';
  return v.toFixed(3);
}

function Markets() {
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'edge' | 'volume' | 'spread'>('edge');
  const [updatedAt, setUpdatedAt] = useState<string>('');

  const refresh = useCallback(async () => {
    try {
      const res = await api<{ markets: MarketRow[]; updatedAt: string }>('/api/markets');
      setMarkets(res.markets || []);
      setUpdatedAt(res.updatedAt || '');
    } catch { /* offline */ }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const filtered = useMemo(() => {
    let rows = markets;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(m => m.question.toLowerCase().includes(q));
    }
    rows = [...rows].sort((a, b) => {
      if (sortBy === 'edge') {
        const ea = Math.max(a.edgeLongPct ?? -999, a.edgeShortPct ?? -999);
        const eb = Math.max(b.edgeLongPct ?? -999, b.edgeShortPct ?? -999);
        return eb - ea;
      }
      if (sortBy === 'spread') {
        const sa = a.spreadYes ?? 999;
        const sb = b.spreadYes ?? 999;
        return sb - sa;
      }
      return b.volume24h - a.volume24h;
    });
    return rows.slice(0, 200);
  }, [markets, search, sortBy]);

  const withBooks = markets.filter(m => m.yesAsk !== null).length;

  return (
    <div>
      <div className="card">
        <div className="markets-toolbar">
          <input className="input search" placeholder="Search markets…" value={search} onChange={e => setSearch(e.target.value)} />
          <label className="field">
            <span className="field-label">Sort</span>
            <select className="input input-sm" value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
              <option value="edge">Edge (arb)</option>
              <option value="volume">Volume 24h</option>
              <option value="spread">Spread</option>
            </select>
          </label>
          <div className="spacer" />
          <span className="fresh-note">
            {markets.length} markets · {withBooks} with live books{updatedAt ? ` · updated ${new Date(updatedAt).toLocaleTimeString()}` : ''}
          </span>
        </div>
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <div className="empty-note">No markets loaded yet. Start the bot — market discovery via Gamma API takes a few seconds.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>YES bid/ask</th>
                  <th>NO bid/ask</th>
                  <th>YES spread</th>
                  <th>Ask sum (Y+N)</th>
                  <th>Bid sum</th>
                  <th>Edge L / S</th>
                  <th>Vol 24h</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m, i) => (
                  <tr key={m.id}>
                    <td className="q-cell" title={m.question}>{m.question}</td>
                    <td className="mono price-cell">{price(m.yesBid)} / {price(m.yesAsk)}</td>
                    <td className="mono price-cell">{price(m.noBid)} / {price(m.noAsk)}</td>
                    <td className="mono price-cell">{m.spreadYes !== null ? `¢${(m.spreadYes * 100).toFixed(1)}` : '—'}</td>
                    <td className="mono price-cell">{m.bundleAsk !== null ? m.bundleAsk.toFixed(3) : '—'}</td>
                    <td className="mono price-cell">{m.bundleBid !== null ? m.bundleBid.toFixed(3) : '—'}</td>
                    <td className="mono">
                      <span className={m.edgeLongPct !== null && m.edgeLongPct > 0 ? 'edge-pos' : 'edge-neg'}>{pct(m.edgeLongPct)}</span>
                      {' / '}
                      <span className={m.edgeShortPct !== null && m.edgeShortPct > 0 ? 'edge-pos' : 'edge-neg'}>{pct(m.edgeShortPct)}</span>
                    </td>
                    <td className="mono">${Math.round(m.volume24h).toLocaleString()}</td>
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

export default Markets;
