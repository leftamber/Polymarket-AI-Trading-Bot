import React, { useCallback, useEffect, useState } from 'react';
import { api, LogEntry, Opportunity, Stats } from './api';
import Overview from './Overview';
import Settings from './Settings';
import Logs from './Logs';
import AiChat from './AiChat';

type Tab = 'overview' | 'ai' | 'settings' | 'logs';

const emptyStats: Stats = {
  status: 'stopped',
  uptimeSec: 0,
  totalProfit: 0,
  totalTrades: 0,
  successfulTrades: 0,
  failedTrades: 0,
  successRate: 0,
  opportunitiesFound: 0,
  roiPct: 0,
  dailyPnl: 0,
  dryRun: true,
  walletBalances: {},
  profitHistory: [],
  networksEnabled: [],
  riskStats: { consecutiveFailures: 0, emergencyPaused: false, tradesTracked: 0 },
};

function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [stats, setStats] = useState<Stats>(emptyStats);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [apiOnline, setApiOnline] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, l, o] = await Promise.all([
        api<Stats>('/api/stats'),
        api<LogEntry[]>('/api/logs?limit=300'),
        api<Opportunity[]>('/api/opportunities'),
      ]);
      setStats(s);
      setLogs(l);
      setOpportunities(o);
      setApiOnline(true);
    } catch {
      setApiOnline(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const toggleBot = async () => {
    setBusy(true);
    try {
      await api(stats.status === 'running' ? '/api/bot/stop' : '/api/bot/start', { method: 'POST' });
      await refresh();
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  };

  const running = stats.status === 'running';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <div className="logo-mark">A</div>
          <div>
            <div className="logo-name">ArbAiBot</div>
            <div className="logo-sub">DeFi Arbitrage</div>
          </div>
        </div>

        <div className={`status-pill ${running ? 'running' : 'stopped'}`}>
          <span className="dot" />
          {apiOnline ? (running ? 'Running' : 'Stopped') : 'API Offline'}
          {stats.dryRun && <span className="dry-badge">DRY RUN</span>}
        </div>

        <button className={`btn ${running ? 'btn-danger' : 'btn-success'} btn-block`} onClick={toggleBot} disabled={busy || !apiOnline}>
          {busy ? '...' : running ? '■ Stop Bot' : '▶ Start Bot'}
        </button>

        <nav className="nav">
          <a href="#" className={tab === 'overview' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setTab('overview'); }}>
            <span className="nav-icon">◈</span> Overview
          </a>
          <a href="#" className={tab === 'ai' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setTab('ai'); }}>
            <span className="nav-icon">✦</span> AI Agent
          </a>
          <a href="#" className={tab === 'settings' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setTab('settings'); }}>
            <span className="nav-icon">⚙</span> Settings
          </a>
          <a href="#" className={tab === 'logs' ? 'active' : ''} onClick={(e) => { e.preventDefault(); setTab('logs'); }}>
            <span className="nav-icon">▤</span> Logs
            {logs.length > 0 && <span className="nav-badge">{logs.length}</span>}
          </a>
        </nav>

        <div className="sidebar-footer">
          <div className="net-list">
            {stats.networksEnabled.map(n => <span key={n} className="net-chip">{n}</span>)}
          </div>
          <div className="port-note">127.0.0.1:4449</div>
        </div>
      </aside>

      <main className="content">
        {tab === 'overview' && <Overview stats={stats} opportunities={opportunities} apiOnline={apiOnline} />}
        {tab === 'ai' && <AiChat />}
        {tab === 'settings' && <Settings onSaved={refresh} />}
        {tab === 'logs' && <Logs logs={logs} apiOnline={apiOnline} />}
      </main>
    </div>
  );
}

export default App;