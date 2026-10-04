import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LogEntry } from './api';

const LEVELS = ['all', 'success', 'info', 'warn', 'error'];

function OpportunityData({ data }: { data: any }) {
  return (
    <div className="log-detail">
      <span className="chip">{data.type}</span>
      {data.side && <span className="chip">{data.side}</span>}
      <span className="chip">size: {Number(data.sizeShares || 0).toFixed(1)} shares</span>
      <span className="chip">order: ${Number(data.orderUsd || 0).toFixed(2)}</span>
      <span className="chip chip-profit">edge: {Number(data.edgePct || 0).toFixed(2)}%</span>
      {data.score !== undefined && <span className="chip">score: {Number(data.score).toFixed(2)}</span>}
    </div>
  );
}

function TradeData({ data }: { data: any }) {
  return (
    <div className="log-detail">
      <span className="chip">{data.strategy}</span>
      <span className="chip">{data.action} {Number(data.size).toFixed(1)} × {Number(data.price).toFixed(3)}</span>
      <span className="chip">{data.side}</span>
      <span className={`chip ${Number(data.realizedPnl) >= 0 ? 'chip-profit' : 'chip-loss'}`}>
        {Number(data.realizedPnl) >= 0 ? 'realized' : 'realized'}: ${Math.abs(Number(data.realizedPnl)).toFixed(2)}
      </span>
      {data.dryRun && <span className="chip">dry-run</span>}
    </div>
  );
}

function Logs({ logs, apiOnline }: { logs: LogEntry[]; apiOnline: boolean }) {
  const [level, setLevel] = useState('all');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    return logs.filter(l => {
      if (level !== 'all' && l.level !== level) return false;
      if (search && !l.message.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [logs, level, search]);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filtered, autoScroll]);

  return (
    <div>
      <div className="card">
        <div className="logs-toolbar">
          <div className="level-chips">
            {LEVELS.map(l => (
              <button key={l} className={`chip-btn ${level === l ? 'active' : ''}`} onClick={() => setLevel(l)}>
                {l}{l !== 'all' && <span className="chip-count">{logs.filter(x => x.level === l).length}</span>}
              </button>
            ))}
          </div>
          <input className="input search" placeholder="Search messages…" value={search} onChange={e => setSearch(e.target.value)} />
          <label className="toggle-row compact">
            <span className="toggle sm" data-on={autoScroll}><span className="knob" /></span>
            <input type="checkbox" style={{ display: 'none' }} checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
            <span className="muted">auto-scroll</span>
          </label>
        </div>
      </div>

      <div className="card log-stream" ref={containerRef}>
        {!apiOnline && <div className="banner banner-error">API offline — logs unavailable.</div>}
        {filtered.length === 0 && <div className="empty-note">No log entries match the filter.</div>}
        {filtered.map((l, i) => (
          <div key={i} className={`log-line level-${l.level}`}>
            <span className="log-time mono">{new Date(l.timestamp).toLocaleTimeString()}</span>
            <span className={`log-level badge-${l.level}`}>{l.level}</span>
            <span className="log-msg">{l.message}</span>
            {l.data?.kind === 'opportunity' && <OpportunityData data={l.data} />}
            {l.data?.kind === 'trade' && <TradeData data={l.data} />}
          </div>
        ))}
      </div>
    </div>
  );
}

export default Logs;
