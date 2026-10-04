import React, { useEffect, useRef, useState } from 'react';
import { api, AiAnalysis, AiMessage, AiRecommendation, AiStatus } from './api';

function RecommendationCard({ rec, onApply, applied }: { rec: AiRecommendation; onApply: (patch: any) => void; applied: boolean }) {
  const patch = { [rec.section]: { [rec.field]: rec.proposed } };
  return (
    <div className="rec-card">
      <div className="rec-head">
        <span className="rec-field mono">{rec.section}.{rec.field}</span>
        {applied
          ? <span className="rec-applied">applied</span>
          : <button className="btn btn-sm btn-primary" onClick={() => onApply(patch)}>Apply</button>}
      </div>
      <div className="rec-values mono">
        <span className="neg-text">{JSON.stringify(rec.current)}</span>
        <span className="rec-arrow">→</span>
        <span className="pos-text">{JSON.stringify(rec.proposed)}</span>
      </div>
      <div className="rec-reason">{rec.reason}</div>
    </div>
  );
}

function AiChat() {
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [appliedFields, setAppliedFields] = useState<Set<string>>(new Set());
  const chatEndRef = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    try {
      const [m, s] = await Promise.all([
        api<AiMessage[]>('/api/ai/messages?limit=50'),
        api<AiStatus>('/api/ai/status'),
      ]);
      setMessages(m);
      setStatus(s);
      if (s.lastAnalysis) setAnalysis(s.lastAnalysis);
    } catch { /* offline */ }
  };

  useEffect(() => { refresh(); }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || sending) return;
    setInput('');
    setSending(true);
    try {
      await api('/api/ai/chat', { method: 'POST', body: JSON.stringify({ message: msg }) });
      await refresh();
    } finally {
      setSending(false);
    }
  };

  const analyze = async () => {
    setAnalyzing(true);
    try {
      const r = await api<{ success: boolean; analysis: AiAnalysis }>('/api/ai/analyze', { method: 'POST' });
      setAnalysis(r.analysis);
      await refresh();
    } finally {
      setAnalyzing(false);
    }
  };

  const applyRec = async (patch: any) => {
    try {
      await api('/api/ai/apply', { method: 'POST', body: JSON.stringify(patch) });
      const keys = Object.keys(patch).flatMap(sec => Object.keys(patch[sec]).map(f => `${sec}.${f}`));
      setAppliedFields(prev => new Set([...prev, ...keys]));
      await refresh();
    } catch { /* ignore */ }
  };

  const clearChat = async () => {
    await api('/api/ai/messages', { method: 'DELETE' }).catch(() => {});
    setAnalysis(null);
    await refresh();
  };

  return (
    <div className="ai-layout">
      <div className="card ai-chat-card">
        <div className="ai-toolbar">
          <div>
            <span className="ai-title">AI Assistant</span>
            <span className={`chip ${status?.configured ? 'chip-profit' : ''}`}>
              {status ? `${status.provider}${status.model ? ' · ' + status.model : ''}${status.configured ? '' : ' · demo (no key)'}` : '…'}
            </span>
          </div>
          <div className="toolbar-btns">
            <button className="btn btn-ghost btn-sm" onClick={clearChat}>Clear</button>
          </div>
        </div>

        <div className="ai-messages">
          {messages.length === 0 && (
            <div className="empty-note">
              Ask the assistant anything about the bot or the market — e.g. "lower the min edge or tune the BTC signal weights".
              Without an API key it runs in local demo mode; connect OpenAI / OpenRouter / Anthropic in Settings → AI Agent.
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`ai-msg ${m.role}`}>
              <div className="ai-bubble">
                <div className="ai-role">{m.role === 'user' ? 'You' : 'AI'}</div>
                <div className="ai-text">{m.content}</div>
                {m.meta?.recommendations?.length ? (
                  <div className="ai-recs">
                    {m.meta.recommendations.map((r, j) => (
                      <RecommendationCard key={j} rec={r} onApply={applyRec} applied={appliedFields.has(`${r.section}.${r.field}`)} />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {sending && <div className="ai-msg assistant"><div className="ai-bubble"><div className="ai-text muted">thinking…</div></div></div>}
          <div ref={chatEndRef} />
        </div>

        <div className="ai-input-row">
          <input
            className="input"
            placeholder="Ask the AI about the market or settings…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send(); }}
            disabled={sending}
          />
          <button className="btn btn-primary" onClick={send} disabled={sending || !input.trim()}>Send</button>
        </div>
      </div>

      <div className="card ai-analysis-card">
        <div className="ai-toolbar">
          <span className="ai-title">Market analysis</span>
          <button className="btn btn-primary btn-sm" onClick={analyze} disabled={analyzing}>
            {analyzing ? 'Analyzing…' : '📊 Analyze & recommend'}
          </button>
        </div>
        {!analysis && <div className="empty-note">Run the analysis: the agent gets a market + bot snapshot and proposes concrete parameter changes.</div>}
        {analysis && (
          <div>
            <div className="analysis-text">{analysis.analysis}</div>
            {analysis.recommendations.length > 0 && (
              <div className="ai-recs">
                {analysis.recommendations.map((r, j) => (
                  <RecommendationCard
                    key={j}
                    rec={r}
                    onApply={applyRec}
                    applied={analysis.applied || appliedFields.has(`${r.section}.${r.field}`)}
                  />
                ))}
              </div>
            )}
            {analysis.settingsPatch && !analysis.applied && (
              <div className="muted rec-patch-note">Patch ready but not auto-applied (toggle auto-apply in Settings → AI Agent).</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default AiChat;
