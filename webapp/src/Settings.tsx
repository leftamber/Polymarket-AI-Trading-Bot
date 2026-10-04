import React, { useEffect, useState } from 'react';
import { api, BotSettings } from './api';

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="card-title">{title}{hint && <span className="card-hint">{hint}</span>}</div>
      {children}
    </div>
  );
}

function NumField({ label, value, onChange, step = 'any', hint, placeholder }: { label: string; value: any; onChange: (v: string) => void; step?: string; hint?: string; placeholder?: string }) {
  return (
    <label className="field">
      <span className="field-label" title={hint}>{label}</span>
      <input className="input" type="number" step={step} value={value ?? ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </label>
  );
}

function TextField({ label, value, onChange, placeholder, mono, password }: { label: string; value: any; onChange: (v: string) => void; placeholder?: string; mono?: boolean; password?: boolean }) {
  return (
    <label className="field field-wide">
      <span className="field-label">{label}</span>
      <input className={`input ${mono ? 'mono' : ''}`} type={password ? 'password' : 'text'} value={value ?? ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </label>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span className="toggle" data-on={value}>
        <span className="knob" />
      </span>
      <input type="checkbox" style={{ display: 'none' }} checked={value} onChange={e => onChange(e.target.checked)} />
      <span className="field-label">{label}</span>
    </label>
  );
}

function Select({ label, value, options, onChange, display }: { label: string; value: string; options: string[]; onChange: (v: string) => void; display?: Record<string, string> }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select className="input" value={value} onChange={e => onChange(e.target.value)}>
        {options.map(o => <option key={o} value={o}>{display?.[o] || o}</option>)}
      </select>
    </label>
  );
}

function ChipsEditor({ label, values, onChange }: { label: string; values: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className="field field-wide">
      <span className="field-label">{label}</span>
      <div className="chips-editor">
        {values.length === 0 && <span className="muted">none</span>}
        {values.map((v, i) => (
          <span key={i} className="chip chip-x" onClick={() => onChange(values.filter((_, j) => j !== i))}>{v} ✕</span>
        ))}
      </div>
      <div className="chips-input-row">
        <input className="input input-sm" value={draft} placeholder="add entry…" onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <button className="btn btn-sm" onClick={add}>Add</button>
      </div>
    </div>
  );
}

const NUM_FIELDS: Record<string, string[]> = {
  trading: ['loopIntervalMs', 'marketsRefreshMs', 'bookRefreshMs', 'maxMarketsScanned', 'minEdgePct', 'orderSizeUsd', 'minOrderSizeUsd', 'maxOrderSizeUsd', 'slippageTolerancePct', 'orderTimeoutSec', 'takerFeeBps', 'makerFeeBps', 'gasCostPerOrderUsd', 'signalExpirySec', 'minSpreadCents', 'tickSizeCents', 'btcTradeAmountUsd', 'spikeThresholdPct', 'divergenceThresholdPct', 'spikeWindowSec', 'decisionThreshold'],
  risk: ['maxPositionPerMarketUsd', 'maxGlobalExposureUsd', 'maxDailyLossUsd', 'maxDrawdownPct', 'min24hVolumeUsd', 'maxConsecutiveFailures', 'cooldownAfterFailureSec'],
  polymarket: ['chainId', 'signatureType', 'dryRunInitialBalanceUsd', 'fillProbability', 'paperFillFeeBps'],
  ai: ['temperature', 'maxTokens', 'analysisIntervalMin'],
};

const AI_PROVIDERS = ['demo', 'openai', 'openrouter', 'anthropic', 'custom'];

function Settings({ onSaved }: { onSaved: () => void }) {
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [draft, setDraft] = useState<BotSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState('');

  useEffect(() => {
    api<BotSettings>('/api/settings').then(s => {
      setSettings(s);
      setDraft(JSON.parse(JSON.stringify(s)));
    }).catch(() => {});
  }, []);

  const patchDraft = (fn: (d: BotSettings) => void) => {
    setDraft(prev => {
      if (!prev) return prev;
      const next = JSON.parse(JSON.stringify(prev));
      fn(next);
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify(draft) });
      setDirty(false);
      setFlash('Saved');
      setTimeout(() => setFlash(''), 2000);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    await api('/api/settings/reset', { method: 'POST' }).catch(() => {});
    const s = await api<BotSettings>('/api/settings');
    setSettings(s);
    setDraft(JSON.parse(JSON.stringify(s)));
    setDirty(false);
    onSaved();
  };

  if (!draft) {
    return <div className="empty-note">Loading settings…</div>;
  }

  const trading = draft.trading;
  const risk = draft.risk;
  const pm = draft.polymarket;
  const ai = draft.ai;
  const num = (sec: keyof typeof NUM_FIELDS) => (field: string) => ({
    value: (draft as any)[sec]?.[field],
    onChange: (v: string) => patchDraft(d => { (d as any)[sec][field] = v === '' ? null : Number(v); }),
  });

  return (
    <div>
      <div className="settings-toolbar">
        <div>
          <strong>Settings</strong>
          {dirty && <span className="muted"><span className="dirty-dot" />unsaved changes</span>}
          {flash && <span className="pos-text" style={{ marginLeft: 10 }}>{flash}</span>}
        </div>
        <div className="toolbar-btns">
          <button className="btn btn-ghost" onClick={reset}>Reset defaults</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : '💾 Save'}</button>
        </div>
      </div>

      <Section title="Strategy" hint="what the bot trades">
        <div className="grid-3">
          <Select
            label="Trading mode"
            value={trading.mode}
            options={['arb', 'btc15', 'both']}
            display={{ arb: 'Arbitrage (bundle + market making)', btc15: 'BTC 15m signal strategy', both: 'Both (recommended)' }}
            onChange={v => patchDraft(d => { d.trading.mode = v as any; })}
          />
          <Select
            label="Signal asset"
            value={trading.btcAsset}
            options={['BTC', 'ETH', 'SOL', 'XRP']}
            onChange={v => patchDraft(d => { d.trading.btcAsset = v as any; })}
          />
          {NUM_FIELDS.trading.slice(0, 3).map(f => <NumField key={f} label={f} {...num('trading')(f)} />)}
        </div>
      </Section>

      <Section title="Features">
        <div className="grid-3 toggles">
          <Toggle label="Dry run (simulate, do not send real orders)" value={draft.features.dryRun} onChange={v => patchDraft(d => { d.features.dryRun = v; })} />
          <Toggle label="Bundle arbitrage (YES+NO ≠ $1)" value={draft.features.enableBundleArb} onChange={v => patchDraft(d => { d.features.enableBundleArb = v; })} />
          <Toggle label="Market making (spread capture)" value={draft.features.enableMarketMaking} onChange={v => patchDraft(d => { d.features.enableMarketMaking = v; })} />
          <Toggle label="BTC 15m signals" value={draft.features.enableBtcSignals} onChange={v => patchDraft(d => { d.features.enableBtcSignals = v; })} />
          <Toggle label="Simulate fills in dry-run" value={draft.features.enableFillSimulation} onChange={v => patchDraft(d => { d.features.enableFillSimulation = v; })} />
        </div>
      </Section>

      <Section title="Trading parameters">
        <div className="grid-3">
          {NUM_FIELDS.trading.slice(3).map(f => <NumField key={f} label={f} {...num('trading')(f)} />)}
          <NumField label="signalWeights.spike" value={trading.signalWeights?.spike} onChange={v => patchDraft(d => { d.trading.signalWeights.spike = Number(v); })} />
          <NumField label="signalWeights.divergence" value={trading.signalWeights?.divergence} onChange={v => patchDraft(d => { d.trading.signalWeights.divergence = Number(v); })} />
          <NumField label="signalWeights.momentum" value={trading.signalWeights?.momentum} onChange={v => patchDraft(d => { d.trading.signalWeights.momentum = Number(v); })} />
        </div>
      </Section>

      <Section title="Risk management">
        <div className="grid-3">
          {NUM_FIELDS.risk.map(f => <NumField key={f} label={f} {...num('risk')(f)} />)}
          <Toggle label="Emergency pause (stop opening orders)" value={risk.emergencyPause} onChange={v => patchDraft(d => { d.risk.emergencyPause = v; })} />
          <Toggle label="Kill switch on limit breach" value={risk.killSwitchEnabled} onChange={v => patchDraft(d => { d.risk.killSwitchEnabled = v; })} />
          <Toggle label="Trade only high-volume markets" value={risk.tradeOnlyHighVolume} onChange={v => patchDraft(d => { d.risk.tradeOnlyHighVolume = v; })} />
        </div>
        <div className="grid-3" style={{ marginTop: 10 }}>
          <ChipsEditor label="Blacklist (conditionIds / keywords)" values={risk.blacklist} onChange={v => patchDraft(d => { d.risk.blacklist = v; })} />
          <ChipsEditor label="Whitelist (empty = all markets)" values={risk.whitelist} onChange={v => patchDraft(d => { d.risk.whitelist = v; })} />
        </div>
      </Section>

      <Section title="Polymarket API & credentials" hint="live trading needs a Polygon wallet private key with USDC">
        <div className="grid-3">
          <TextField label="Gamma API URL" mono value={pm.gammaApiUrl} onChange={v => patchDraft(d => { d.polymarket.gammaApiUrl = v; })} />
          <TextField label="CLOB API URL" mono value={pm.clobApiUrl} onChange={v => patchDraft(d => { d.polymarket.clobApiUrl = v; })} />
          <TextField label="Data API URL" mono value={pm.dataApiUrl} onChange={v => patchDraft(d => { d.polymarket.dataApiUrl = v; })} />
        </div>
        <div className="grid-3" style={{ marginTop: 10 }}>
          <TextField label="Private key (live signing)" mono password value={pm.privateKey} placeholder="0x… — leave empty for dry-run only" onChange={v => patchDraft(d => { d.polymarket.privateKey = v; })} />
          <TextField label="Funder address (proxy wallets)" mono value={pm.funderAddress} placeholder="optional 0x…" onChange={v => patchDraft(d => { d.polymarket.funderAddress = v; })} />
          <NumField label="Signature type (0 EOA / 1 proxy / 2 safe)" value={pm.signatureType} onChange={v => patchDraft(d => { d.polymarket.signatureType = Number(v) || 0; })} />
        </div>
        <div className="grid-3" style={{ marginTop: 10 }}>
          <TextField label="API key (optional, derived from key)" mono password value={pm.apiKey} onChange={v => patchDraft(d => { d.polymarket.apiKey = v; })} />
          <TextField label="API secret (optional)" mono password value={pm.apiSecret} onChange={v => patchDraft(d => { d.polymarket.apiSecret = v; })} />
          <TextField label="API passphrase (optional)" mono password value={pm.apiPassphrase} onChange={v => patchDraft(d => { d.polymarket.apiPassphrase = v; })} />
        </div>
        <div className="grid-3" style={{ marginTop: 10 }}>
          <NumField label="dryRunInitialBalanceUsd" {...num('polymarket')('dryRunInitialBalanceUsd')} />
          <NumField label="fillProbability (paper fills)" step="0.05" {...num('polymarket')('fillProbability')} />
          <NumField label="paperFillFeeBps" {...num('polymarket')('paperFillFeeBps')} />
        </div>
      </Section>

      <Section title="AI Agent">
        <div className="ai-auto-banner on">
          <div className="ai-auto-text">
            <div className="ai-auto-title">AI autonomous mode</div>
            <div className="ai-auto-sub">
              When enabled, the agent analyzes the market on a schedule, applies its settings patch automatically and may trade without approval.
              When disabled, recommendations wait for manual approval.
            </div>
          </div>
          <Toggle label="Enable" value={ai.autonomousTrading} onChange={v => patchDraft(d => { d.ai.autonomousTrading = v; })} />
        </div>
        <div className="grid-3">
          <Select label="Provider" value={ai.provider} options={AI_PROVIDERS} display={{ demo: 'Demo (no key)', openai: 'OpenAI', openrouter: 'OpenRouter', anthropic: 'Anthropic', custom: 'Custom (OpenAI-compatible)' }} onChange={v => patchDraft(d => { d.ai.provider = v as any; })} />
          <TextField label="API key" mono password value={ai.apiKey} placeholder="paste API key" onChange={v => patchDraft(d => { d.ai.apiKey = v; })} />
          <TextField label="API base URL (custom provider)" mono value={ai.apiBaseUrl} placeholder="https://…/v1" onChange={v => patchDraft(d => { d.ai.apiBaseUrl = v; })} />
          <TextField label="Model" value={ai.model} placeholder="gpt-4o-mini" onChange={v => patchDraft(d => { d.ai.model = v; })} />
          {NUM_FIELDS.ai.map(f => <NumField key={f} label={f} {...num('ai')(f)} />)}
          <Toggle label="Auto-apply recommendations" value={ai.autoApplyRecommendations} onChange={v => patchDraft(d => { d.ai.autoApplyRecommendations = v; })} />
        </div>
      </Section>
    </div>
  );
}

export default Settings;
