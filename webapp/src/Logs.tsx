import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LogEntry, tokenSymbol } from './api';

const LEVELS = ['all', 'success', 'info', 'warn', 'error'];

function OpportunityData({ data }: { data: any }) {
  return (
    <div className="log-detail">
      <span className="chip">{data.network}</span>
      <span className="chip">route: {data.dexIn} → {data.dexOut}</span>
      <span className="chip">{tokenSymbol(data.tokenIn)} → {tokenSymbol(data.tokenOut)}</span>
      {data.inputAmount && <span className="chip">amount: {data.inputAmount} {tokenSymbol(data.tokenIn)} (~${Number(data.inputUsd || 0).toFixed(0)})</span>}
      {data.profitEstimate !== undefined && <span className="chip chip-profit">profit: ${Number(data.profitEstimate).toFixed(2)} ({Number(data.profitPct || 0).toFixed(2)}%)</span>}
      {data.confidence !== undefined && <span className="chip">conf: {Math.round(Number(data.confidence) * 100)}%</span>}
    </div>
  );
}

function TradeData({ data }: { data: any }) {
  return (
    <div className="log-detail">
      <span className="chip">{data.network}</span>
      <span className="chip">{data.dexIn} → {data.dexOut}</span>
      <span className="chip">{tokenSymbol(data.tokenIn)} → {tokenSymbol(data.tokenOut)}</span>
      <span className={`chip ${data.profit >= 0 ? 'chip-profit' : 'chip-loss'}`}>
        {data.profit >= 0 ? 'profit' : 'loss'}: ${Math.abs(Number(data.profit)).toFixed(2)}
      </span>
      <span className="chip">total: ${Number(data.totalProfit).toFixed(2)}</span>
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