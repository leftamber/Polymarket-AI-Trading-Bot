import React, { useEffect, useMemo, useState } from 'react';
import { api, BotSettings, NetworkConfig, WalletEntry, WalletsConfig } from './api';

const DEX_TYPES = ['uniswapv2', 'uniswapv3', 'pancakeswap', 'quickswap', 'sushiswap', 'aerodrome', 'velodrome', 'traderjoe'];
const AGG_TYPES = ['openocean', 'oneinch', 'paraswap', 'custom'];

const WALLET_TYPES: Array<{ id: WalletEntry['type']; label: string; icon: string }> = [
  { id: 'generated', label: 'Generate new', icon: '⚡' },
  { id: 'imported', label: 'Import', icon: '📥' },
  { id: 'metamask', label: 'MetaMask', icon: '🦊' },
];

const WALLET_NUM_FIELDS = ['tradeAmountNative', 'tradeAmountUsd', 'stableTokenAmount', 'minProfitUsd', 'maxSlippagePct', 'gasPriceGwei', 'gasLimit', 'deadlineSec'];

function copyText(text: string) {
  try { navigator.clipboard?.writeText(text); } catch { /* clipboard unavailable */ }
}

const NUM_FIELDS: Record<string, string[]> = {
  trading: ['tradeAmountNative', 'tradeAmountUsd', 'stableTokenAmount', 'stableDecimals', 'minProfitUsd', 'maxSlippagePct', 'maxPathLength', 'gasPriceGwei', 'gasLimit', 'deadlineSec', 'loopIntervalMs', 'maxPairsPerScan', 'maxPendingTxPerNetwork'],
  flashloan: ['maxAmountUsd', 'feeBps'],
  risk: ['minLiquidityUsd', 'maxDailyLossUsd', 'maxConsecutiveFailures', 'maxOpenPositions', 'maxGasPriceGwei', 'maxTradeAmountUsd', 'takeProfitUsd', 'stopLossUsd', 'killSwitchDrawdownPct', 'cooldownAfterFailureSec'],
  oracle: ['cacheTtlSec'],
  ai: ['temperature', 'maxTokens', 'analysisIntervalMin'],
};

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

function TextField({ label, value, onChange, placeholder, mono }: { label: string; value: any; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <label className="field field-wide">
      <span className="field-label">{label}</span>
      <input className={`input ${mono ? 'mono' : ''}`} value={value ?? ''} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
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

function SecretField({ label, value, onChange, hint, placeholder }: { label: string; value: any; onChange: (v: string) => void; hint?: string; placeholder?: string }) {
  return (
    <label className="field field-wide">
      <span className="field-label" title={hint}>{label}</span>
      <input className="input mono" type="password" value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={placeholder || 'paste API key'} />
    </label>
  );
}

function WalletEditor({ wallet, networks, isActive, busy, onChange, onSave, onActivate, onDelete }: {
  wallet: WalletEntry;
  networks: string[];
  isActive: boolean;
  busy: boolean;
  onChange: (fn: (w: WalletEntry) => void) => void;
  onSave: () => void;
  onActivate: () => void;
  onDelete: () => void;
}) {
  const s = wallet.settings;
  const allowed = s.allowedNetworks || [];
  const toggleNetwork = (n: string) => onChange(w => {
    const cur = w.settings.allowedNetworks || [];
    w.settings.allowedNetworks = cur.includes(n) ? cur.filter(x => x !== n) : [...cur, n];
  });

  return (
    <div className="card inset wallet-editor">
      <div className="grid-3">
        <TextField label="Wallet name (tab title)" value={wallet.label} onChange={v => onChange(w => { w.label = v; })} />
        <Select
          label="Wallet type"
          value={wallet.type}
          options={WALLET_TYPES.map(t => t.id)}
          display={Object.fromEntries(WALLET_TYPES.map(t => [t.id, `${t.icon} ${t.label}`]))}
          onChange={v => onChange(w => { w.type = v as WalletEntry['type']; })}
        />
        <TextField label="Address" mono value={wallet.address} placeholder="0x… (account address)" onChange={v => onChange(w => { w.address = v; })} />
      </div>

      <div className="grid-3 toggles">
        <Toggle label="Enabled (available for trading)" value={wallet.enabled} onChange={v => onChange(w => { w.enabled = v; })} />
        <Toggle label="Dry-run only (never send real tx)" value={s.dryRunOnly} onChange={v => onChange(w => { w.settings.dryRunOnly = v; })} />
        <div className="active-wallet-cell">
          {isActive
            ? <span className="chip chip-active-wallet">★ Active trading wallet</span>
            : <button className="btn btn-ghost btn-sm" onClick={onActivate} disabled={busy}>☆ Set as active wallet</button>}
        </div>
      </div>

      <div className="grid-3">
        <SecretField label="Private key (stored locally in data/settings.json)" value={wallet.privateKey} placeholder="0x… or paste exported MetaMask key" onChange={v => onChange(w => { w.privateKey = v; })} />
        <SecretField label="Seed phrase (12/24 words, stored locally)" value={wallet.seedPhrase} placeholder="word1 word2 … (BIP-39 mnemonic)" onChange={v => onChange(w => { w.seedPhrase = v; })} />
      </div>
      {wallet.type === 'metamask' && (
        <div className="muted ai-hint">
          MetaMask: the address above is bound to your MetaMask account — switch accounts in MetaMask and paste the new address here, settings stay attached to the account.
          For automatic trading the bot signs with the private key: export it from MetaMask (Account details → Export private key) and paste it above.
        </div>
      )}

      <div className="agg-subtitle">Per-wallet settings <span className="muted">(empty = inherit from global Trading settings)</span></div>
      <div className="grid-3">
        <NumField label="Trade amount (native)" placeholder="(global)" value={s.tradeAmountNative ?? ''} onChange={v => onChange(w => { w.settings.tradeAmountNative = v === '' ? null : v; })} />
        <NumField label="Trade amount (USD, est.)" placeholder="(global)" value={s.tradeAmountUsd ?? ''} onChange={v => onChange(w => { w.settings.tradeAmountUsd = v === '' ? null : v; })} />
        <NumField label="Stable token amount" placeholder="(global)" value={s.stableTokenAmount ?? ''} onChange={v => onChange(w => { w.settings.stableTokenAmount = v === '' ? null : v; })} />
        <NumField label="Min profit (USD)" placeholder="(global)" value={s.minProfitUsd ?? ''} onChange={v => onChange(w => { w.settings.minProfitUsd = v === '' ? null : v; })} />
        <NumField label="Max slippage (%)" step="0.01" placeholder="(global)" value={s.maxSlippagePct ?? ''} onChange={v => onChange(w => { w.settings.maxSlippagePct = v === '' ? null : v; })} />
        <NumField label="Gas price (Gwei)" placeholder="(global)" value={s.gasPriceGwei ?? ''} onChange={v => onChange(w => { w.settings.gasPriceGwei = v === '' ? null : v; })} />
        <NumField label="Gas limit" placeholder="(global)" value={s.gasLimit ?? ''} onChange={v => onChange(w => { w.settings.gasLimit = v === '' ? null : v; })} />
        <NumField label="Tx deadline (sec)" placeholder="(global)" value={s.deadlineSec ?? ''} onChange={v => onChange(w => { w.settings.deadlineSec = v === '' ? null : v; })} />
      </div>

      <div className="field field-wide">
        <span className="field-label">Allowed networks for this wallet (empty = all enabled networks)</span>
        <div className="net-chips">
          {networks.map(n => (
            <button key={n} type="button" className={`chip chip-toggle ${allowed.includes(n) ? 'on' : ''}`} onClick={() => toggleNetwork(n)}>{n}</button>
          ))}
        </div>
      </div>

      <div className="toolbar-btns wallet-actions">
        <button className="btn btn-ghost danger" onClick={onDelete} disabled={busy}>🗑 Delete wallet</button>
        <button className="btn btn-primary" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : '💾 Save wallet'}</button>
      </div>
    </div>
  );
}

function CreateWalletModal({ networks, defaultLabel, onClose, onCreate }: {
  networks: string[];
  defaultLabel: string;
  onClose: () => void;
  onCreate: (payload: Partial<WalletEntry>) => Promise<void>;
}) {
  const [type, setType] = useState<WalletEntry['type']>('generated');
  const [label, setLabel] = useState(defaultLabel);
  const [address, setAddress] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [seedPhrase, setSeedPhrase] = useState('');
  const [generated, setGenerated] = useState<{ address: string; privateKey: string; mnemonic: string } | null>(null);
  const [mmNote, setMmNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true); setLocalError(null);
    try {
      const g = await api<{ address: string; privateKey: string; mnemonic: string }>('/api/wallets/generate', { method: 'POST' });
      setGenerated(g);
      setAddress(g.address);
      setPrivateKey(g.privateKey);
      setSeedPhrase(g.mnemonic);
      if (label === defaultLabel) setLabel(`Wallet ${Date.now().toString(36).slice(-3)}`);
    } catch (e) {
      setLocalError((e as Error).message);
    } finally { setBusy(false); }
  };

  const connectMetaMask = async () => {
    setLocalError(null);
    const eth = (window as any).ethereum;
    if (!eth) {
      setMmNote('MetaMask not detected in this browser. Install the MetaMask extension, or use the "Import" tab and paste the account address / private key.');
      return;
    }
    try {
      const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' });
      if (accounts?.length) {
        setAddress(accounts[0]);
        const chainId: string = await eth.request({ method: 'eth_chainId' });
        setMmNote(`Connected MetaMask account: ${accounts[0]} (chain id ${parseInt(String(chainId), 16)}). For automatic trading paste the exported private key below — settings are now attached to this account.`);
      }
    } catch (e) {
      setLocalError((e as Error).message);
    }
  };

  const submit = async () => {
    if (busy) return;
    if (type === 'generated' && !generated) {
      setLocalError('Generate a wallet first, then press Create.');
      return;
    }
    if (!address.trim() && !privateKey.trim() && !seedPhrase.trim()) {
      setLocalError('Fill the address / private key / seed phrase (or generate a wallet).');
      return;
    }
    setBusy(true);
    try {
      await onCreate({ label: label.trim(), type, address: address.trim(), privateKey: privateKey.trim(), seedPhrase: seedPhrase.trim(), enabled: true });
    } catch (e) {
      setLocalError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-title">Create New Wallet</div>
        <div className="type-pills">
          {WALLET_TYPES.map(t => (
            <button key={t.id} className={`pill ${type === t.id ? 'active' : ''}`} onClick={() => setType(t.id)}>{t.icon} {t.label}</button>
          ))}
        </div>

        <div className="grid-3">
          <TextField label="Wallet name (tab title)" value={label} onChange={setLabel} placeholder={defaultLabel} />
        </div>

        {type === 'generated' && (
          <div className="gen-actions">
            <button className="btn btn-primary" onClick={generate} disabled={busy}>⚡ Generate new wallet</button>
            {generated && (
              <div className="gen-box">
                <div className="gen-row"><span className="gen-label">Address</span><span className="mono">{generated.address}</span><button className="btn btn-ghost btn-sm" onClick={() => copyText(generated.address)}>copy</button></div>
                <div className="gen-row"><span className="gen-label">Private key</span><span className="mono">{generated.privateKey.slice(0, 10)}…{generated.privateKey.slice(-6)}</span><button className="btn btn-ghost btn-sm" onClick={() => copyText(generated.privateKey)}>copy</button></div>
                <div className="gen-row"><span className="gen-label">Seed phrase</span><span className="mono">{generated.mnemonic}</span><button className="btn btn-ghost btn-sm" onClick={() => copyText(generated.mnemonic)}>copy</button></div>
                <div className="muted">Address, private key and seed phrase are filled into the form below — they will be stored in data/settings.json. Save them in a safe place.</div>
              </div>
            )}
          </div>
        )}

        {type === 'metamask' && (
          <div className="gen-actions">
            <button className="btn btn-primary" onClick={connectMetaMask} disabled={busy}>🦊 Connect MetaMask</button>
            {mmNote && <div className="banner banner-warn" style={{ marginTop: 8 }}>{mmNote}</div>}
          </div>
        )}

        <div className="grid-3">
          <TextField label="Account address" mono value={address} onChange={setAddress} placeholder="0x…" />
          <SecretField label="Private key" value={privateKey} onChange={setPrivateKey} placeholder={type === 'generated' ? 'auto-filled after generation' : '0x…'} />
          <SecretField label="Seed phrase" value={seedPhrase} onChange={setSeedPhrase} placeholder={type === 'generated' ? 'auto-filled after generation' : 'word1 word2 …'} />
        </div>

        {localError && <div className="banner banner-error">{localError}</div>}

        <div className="toolbar-btns">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create wallet'}</button>
        </div>
      </div>
    </div>
  );
}

function WalletModule({ networks, onNotify }: { networks: string[]; onNotify: () => void }) {
  const [cfg, setCfg] = useState<WalletsConfig | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const w = await api<WalletsConfig>('/api/wallets');
      setCfg(w);
      setSelId(prev => {
        if (prev && w.list.some(x => x.id === prev)) return prev;
        if (w.activeId && w.list.some(x => x.id === w.activeId)) return w.activeId;
        return w.list[0]?.id ?? null;
      });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => { load(); }, []);

  const notifyFlash = (m: string) => {
    setFlash(m);
    window.setTimeout(() => setFlash(null), 2500);
  };

  const sel = cfg?.list.find(w => w.id === selId) || null;

  const patchSel = (fn: (w: WalletEntry) => void) => {
    setCfg(prev => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev)) as WalletsConfig;
      const w = copy.list.find(x => x.id === selId);
      if (w) fn(w);
      return copy;
    });
  };

  const saveWallet = async () => {
    if (!sel) return;
    setBusy(true); setError(null);
    try {
      const payload = JSON.parse(JSON.stringify(sel));
      for (const f of WALLET_NUM_FIELDS) {
        const v = payload.settings[f];
        payload.settings[f] = (v === '' || v === null || v === undefined) ? null : Number(v);
      }
      payload.settings.allowedNetworks = (payload.settings.allowedNetworks || []).filter(Boolean);
      const res = await api<{ wallets: WalletsConfig }>(`/api/wallets/${sel.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      setCfg(res.wallets);
      notifyFlash('Wallet settings saved');
      onNotify();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const activate = async (id: string) => {
    setBusy(true); setError(null);
    try {
      const res = await api<{ wallets: WalletsConfig }>(`/api/wallets/${id}/activate`, { method: 'POST' });
      setCfg(res.wallets);
      notifyFlash('Active trading wallet updated');
      onNotify();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeWallet = async (id: string, label: string) => {
    if (!window.confirm(`Delete wallet "${label}"? Its stored seed phrase / private key will be removed from data/settings.json.`)) return;
    setBusy(true); setError(null);
    try {
      const res = await api<{ wallets: WalletsConfig }>(`/api/wallets/${id}`, { method: 'DELETE' });
      setCfg(res.wallets);
      if (selId === id) setSelId(res.wallets.activeId || res.wallets.list[0]?.id || null);
      notifyFlash('Wallet deleted');
      onNotify();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createWallet = async (payload: Partial<WalletEntry>) => {
    const res = await api<{ wallet: WalletEntry; wallets: WalletsConfig }>('/api/wallets', { method: 'POST', body: JSON.stringify(payload) });
    setCfg(res.wallets);
    setSelId(res.wallet.id);
    setShowCreate(false);
    notifyFlash('Wallet created');
    onNotify();
  };

  return (
    <Section title="Wallet Settings" hint="multi-wallet management — every wallet tab keeps its own settings">
      {error && <div className="banner banner-error">{error}</div>}
      {!cfg ? (
        <div className="empty-note">Loading wallets…</div>
      ) : (
        <>
          <div className="wallet-tabs">
            {cfg.list.map(w => (
              <button
                key={w.id}
                className={`wallet-tab ${selId === w.id ? 'active' : ''} ${cfg.activeId === w.id ? 'is-active-wallet' : ''}`}
                onClick={() => setSelId(w.id)}
                title={`${w.address || 'no address'}${cfg.activeId === w.id ? ' (active trading wallet)' : ''}`}
              >
                {cfg.activeId === w.id ? '★ ' : ''}{w.label}{!w.enabled ? ' ⏸' : ''}
              </button>
            ))}
            <button className="wallet-tab add" onClick={() => setShowCreate(true)} title="Create New Wallet">+</button>
          </div>

          {sel ? (
            <WalletEditor
              wallet={sel}
              networks={networks}
              isActive={cfg.activeId === sel.id}
              busy={busy}
              onChange={patchSel}
              onSave={saveWallet}
              onActivate={() => activate(sel.id)}
              onDelete={() => removeWallet(sel.id, sel.label)}
            />
          ) : (
            <div className="empty-note">No wallets yet — press “+” to create one (generate a new wallet, import a seed/private key, or connect MetaMask). The active wallet ★ is used for trading and its settings override the global ones.</div>
          )}
        </>
      )}

      {showCreate && (
        <CreateWalletModal
          networks={networks}
          defaultLabel={`Wallet ${cfg.list.length + 1}`}
          onClose={() => setShowCreate(false)}
          onCreate={createWallet}
        />
      )}
    </Section>
  );
}

function Settings({ onSaved }: { onSaved: () => void }) {
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [draft, setDraft] = useState<BotSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newDex, setNewDex] = useState<{ network: string; id: string; name: string; type: string; factory: string; router: string } | null>(null);

  const load = async () => {
    try {
      const s = await api<BotSettings>('/api/settings');
      setSettings(s);
      setDraft(JSON.parse(JSON.stringify(s)));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => { load(); }, []);

  const dirty = useMemo(() => JSON.stringify(settings) !== JSON.stringify(draft), [settings, draft]);

  const patchDraft = (fn: (d: BotSettings) => void) => {
    setDraft(prev => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev));
      fn(copy);
      return copy;
    });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      // Coerce numeric fields
      const payload = JSON.parse(JSON.stringify(draft));
      for (const [section, fields] of Object.entries(NUM_FIELDS)) {
        if (!payload[section]) continue;
        for (const f of fields) {
          if (payload[section][f] !== undefined && payload[section][f] !== '') {
            payload[section][f] = Number(payload[section][f]);
          }
        }
      }
      for (const [net, cfg] of Object.entries(payload.networks)) {
        cfg.pollIntervalMs = Number(cfg.pollIntervalMs) || 2000;
        cfg.gasPriceGwei = Number(cfg.gasPriceGwei) || 0;
        if (typeof cfg.tokens === 'string') {
          cfg.tokens = cfg.tokens.split('\n').map((t: string) => t.trim()).filter((t: string) => /^0x[0-9a-fA-F]{40}$/.test(t));
        } else {
          cfg.tokens = (cfg.tokens || []).filter((t: string) => /^0x[0-9a-fA-F]{40}$/.test(t));
        }
        for (const d of cfg.dexes || []) {
          d.factory = String(d.factory || '').trim();
          d.router = String(d.router || '').trim();
          d.enabled = !!d.enabled;
        }
      }
      payload.risk.blacklistTokens = (payload.risk.blacklistTokens || []).map((t: string) => String(t).trim()).filter((t: string) => t.length > 0);

      // Wallets are managed by the Wallet Settings module (own API) — strip the
      // possibly stale copy so the merge on the server keeps the live wallet list
      delete payload.wallets;

      await api('/api/settings', { method: 'PUT', body: JSON.stringify(payload) });
      setSavedAt(new Date().toLocaleTimeString());
      await load();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      await api('/api/settings/reset', { method: 'POST' });
      await load();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const addProtocol = async () => {
    if (!newDex || !newDex.network) return;
    try {
      await api(`/api/networks/${newDex.network}/dexes`, { method: 'POST', body: JSON.stringify(newDex) });
      setNewDex(null);
      await load();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const removeProtocol = async (network: string, dexId: string) => {
    try {
      await api(`/api/networks/${network}/dexes/${dexId}`, { method: 'DELETE' });
      await load();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (error && !draft) return <div className="banner banner-error">Failed to load settings: {error}</div>;
  if (!draft) return <div className="empty-note">Loading settings…</div>;

  const t = draft.trading;
  const f = draft.features;
  const fl = draft.flashloan;
  const r = draft.risk;

  return (
    <div>
      <div className="settings-toolbar">
        <div>
          {dirty ? <span className="dirty-dot" /> : null}
          <span className="muted">{dirty ? 'Unsaved changes' : savedAt ? `Saved at ${savedAt}` : 'All changes saved'}</span>
        </div>
        <div className="toolbar-btns">
          <button className="btn btn-ghost" onClick={reset} disabled={saving}>Reset to defaults</button>
          <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>{saving ? 'Saving…' : '💾 Save Settings'}</button>
        </div>
      </div>
      {error && <div className="banner banner-error">{error}</div>}

      <WalletModule networks={Object.keys(draft.networks)} onNotify={onSaved} />

      <Section title="Trading" hint="amounts, profit thresholds, gas">
        <div className="grid-3">
          <NumField label="Trade amount (native, e.g. 0.5 ETH)" value={t.tradeAmountNative} onChange={v => patchDraft(d => { d.trading.tradeAmountNative = v; })} />
          <NumField label="Trade amount (USD, est.)" value={t.tradeAmountUsd} onChange={v => patchDraft(d => { d.trading.tradeAmountUsd = v; })} />
          <NumField label="Stable token amount (USDC/USDT)" value={t.stableTokenAmount} onChange={v => patchDraft(d => { d.trading.stableTokenAmount = v; })} />
          <NumField label="Stable decimals" value={t.stableDecimals} onChange={v => patchDraft(d => { d.trading.stableDecimals = v; })} />
          <NumField label="Min profit (USD)" value={t.minProfitUsd} onChange={v => patchDraft(d => { d.trading.minProfitUsd = v; })} />
          <NumField label="Max slippage (%)" value={t.maxSlippagePct} step="0.01" onChange={v => patchDraft(d => { d.trading.maxSlippagePct = v; })} />
          <NumField label="Max path length" value={t.maxPathLength} onChange={v => patchDraft(d => { d.trading.maxPathLength = v; })} />
          <NumField label="Gas price (Gwei)" value={t.gasPriceGwei} onChange={v => patchDraft(d => { d.trading.gasPriceGwei = v; })} />
          <NumField label="Gas limit" value={t.gasLimit} onChange={v => patchDraft(d => { d.trading.gasLimit = v; })} />
          <NumField label="Tx deadline (sec)" value={t.deadlineSec} onChange={v => patchDraft(d => { d.trading.deadlineSec = v; })} />
          <NumField label="Scan loop interval (ms)" value={t.loopIntervalMs} onChange={v => patchDraft(d => { d.trading.loopIntervalMs = v; })} />
          <NumField label="Max pairs per scan / network" value={t.maxPairsPerScan} onChange={v => patchDraft(d => { d.trading.maxPairsPerScan = v; })} />
          <NumField label="Max pending tx buffered / network" value={t.maxPendingTxPerNetwork} onChange={v => patchDraft(d => { d.trading.maxPendingTxPerNetwork = v; })} />
          <Select label="Scan mode (where to look for opportunities)" value={t.scanMode} options={['both', 'mempool', 'pools']} onChange={v => patchDraft(d => { d.trading.scanMode = v; })} />
        </div>
      </Section>

      <Section title="Features" hint="engine switches">
        <div className="grid-3 toggles">
          <Toggle label="Enable Mempool Monitor" value={f.enableMempoolMonitor} onChange={v => patchDraft(d => { d.features.enableMempoolMonitor = v; })} />
          <Toggle label="Enable Crosschain" value={f.enableCrosschain} onChange={v => patchDraft(d => { d.features.enableCrosschain = v; })} />
          <Toggle label="Enable Flash Loans" value={f.enableFlashLoans} onChange={v => patchDraft(d => { d.features.enableFlashLoans = v; })} />
          <Toggle label="Enable Perp Arb" value={f.enablePerpArb} onChange={v => patchDraft(d => { d.features.enablePerpArb = v; })} />
          <Toggle label="Concentrated liquidity (V3/V4)" value={f.enableConcentratedLiquidity} onChange={v => patchDraft(d => { d.features.enableConcentratedLiquidity = v; })} />
          <Toggle label="Dry run (simulate, do not send tx)" value={f.dryRun} onChange={v => patchDraft(d => { d.features.dryRun = v; })} />
        </div>
      </Section>

      <Section title="Flash Loans" hint={f.enableFlashLoans ? 'active' : 'disabled — enable in Features'}>
        <div className={`section-body ${f.enableFlashLoans ? '' : 'dimmed'}`}>
          <div className="grid-3">
            <Select label="Provider" value={fl.provider} options={['aave', 'balancer', 'dodo', 'none']} onChange={v => patchDraft(d => { d.flashloan.provider = v; })} />
            <NumField label="Max loan amount (USD)" value={fl.maxAmountUsd} onChange={v => patchDraft(d => { d.flashloan.maxAmountUsd = v; })} />
            <NumField label="Loan fee (bps)" value={fl.feeBps} onChange={v => patchDraft(d => { d.flashloan.feeBps = v; })} />
          </div>
          <Toggle label="Auto-repay loan from proceeds" value={fl.autoRepay} onChange={v => patchDraft(d => { d.flashloan.autoRepay = v; })} />
        </div>
      </Section>

      <Section title="AI Agent" hint="market analysis, chat, setting recommendations">
        <div className={`ai-auto-banner ${draft.ai.autonomousTrading ? 'on' : ''}`}>
          <div className="ai-auto-text">
            <div className="ai-auto-title">🤖 Enable Automatic — AI autonomous trading</div>
            <div className="ai-auto-sub">
              The agent gets the right to change bot settings on its own (amounts, profit thresholds, risk limits, active wallet)
              to find opportunities and execute profitable trades without manual approval. Works with the demo provider too;
              for real analysis set an AI provider below. Bot must be running (▶ Start Bot).
            </div>
          </div>
          <Toggle label="" value={draft.ai.autonomousTrading} onChange={v => patchDraft(d => { d.ai.autonomousTrading = v; })} />
        </div>
        <div className="grid-3">
          <Select label="Provider" value={draft.ai.provider} options={['demo', 'openai', 'openrouter', 'anthropic', 'custom']} onChange={v => patchDraft(d => { d.ai.provider = v; })} />
          <TextField label="Model" mono value={draft.ai.model} onChange={v => patchDraft(d => { d.ai.model = v; })} />
          <NumField label="Temperature" step="0.05" value={draft.ai.temperature} onChange={v => patchDraft(d => { d.ai.temperature = v; })} />
          <TextField label="API base URL (openai-compatible; empty = provider default)" mono value={draft.ai.apiBaseUrl} onChange={v => patchDraft(d => { d.ai.apiBaseUrl = v; })} />
          <NumField label="Max tokens" value={draft.ai.maxTokens} onChange={v => patchDraft(d => { d.ai.maxTokens = v; })} />
          <NumField label="Auto-analysis interval (min, 0 = manual only)" value={draft.ai.analysisIntervalMin} onChange={v => patchDraft(d => { d.ai.analysisIntervalMin = v; })} />
          <SecretField label="API key" value={draft.ai.apiKey} onChange={v => patchDraft(d => { d.ai.apiKey = v; })} />
        </div>
        <Toggle label="Auto-apply AI recommendations" value={draft.ai.autoApplyRecommendations} onChange={v => patchDraft(d => { d.ai.autoApplyRecommendations = v; })} />
        <div className="muted ai-hint">
          demo — local heuristic (no key needed) · openai — api.openai.com/v1 · openrouter — openrouter.ai/api/v1 · anthropic — api.anthropic.com · custom — any OpenAI-compatible endpoint (e.g. local LLM).
          The agent receives a market snapshot (stats, prices, recent opportunities, wallets) and proposes concrete changes (trading.minProfitUsd, features.*, risk.*, wallets.activeId).
          Enable Automatic grants auto-apply rights even without “Auto-apply AI recommendations”, and schedules analysis every 5 min if no interval is set.
        </div>
      </Section>

      <Section title="Price Oracle" hint="token prices for USD valuation of any pair + AI snapshots">
        <div className="grid-3">
          <Select label="Provider" value={draft.oracle.provider} options={['defillama', 'coingecko', 'custom']} onChange={v => patchDraft(d => { d.oracle.provider = v; })} />
          <NumField label="Price cache TTL (sec)" value={draft.oracle.cacheTtlSec} onChange={v => patchDraft(d => { d.oracle.cacheTtlSec = v; })} />
          <TextField label="Custom base URL (coingecko-compatible)" mono value={draft.oracle.apiBaseUrl} onChange={v => patchDraft(d => { d.oracle.apiBaseUrl = v; })} />
          <SecretField label="API key (coingecko pro / custom)" value={draft.oracle.apiKey} onChange={v => patchDraft(d => { d.oracle.apiKey = v; })} />
        </div>
        <div className="muted ai-hint">defillama — free, no key. coingecko — free tier / pro with key. custom — your own oracle endpoint with the same response format.</div>
      </Section>

      <Section title="Risk Management" hint="protective limits">
        <div className="grid-3">
          <Toggle label="Emergency pause" value={r.emergencyPause} onChange={v => patchDraft(d => { d.risk.emergencyPause = v; })} />
          <Toggle label="Honeypot check" value={r.honeypotCheck} onChange={v => patchDraft(d => { d.risk.honeypotCheck = v; })} />
          <div />
          <NumField label="Min liquidity (USD)" value={r.minLiquidityUsd} onChange={v => patchDraft(d => { d.risk.minLiquidityUsd = v; })} />
          <NumField label="Max daily loss (USD)" value={r.maxDailyLossUsd} onChange={v => patchDraft(d => { d.risk.maxDailyLossUsd = v; })} />
          <NumField label="Max consecutive failures" value={r.maxConsecutiveFailures} onChange={v => patchDraft(d => { d.risk.maxConsecutiveFailures = v; })} />
          <NumField label="Max open positions" value={r.maxOpenPositions} onChange={v => patchDraft(d => { d.risk.maxOpenPositions = v; })} />
          <NumField label="Max gas price (Gwei)" value={r.maxGasPriceGwei} onChange={v => patchDraft(d => { d.risk.maxGasPriceGwei = v; })} />
          <NumField label="Max trade amount (USD)" value={r.maxTradeAmountUsd} onChange={v => patchDraft(d => { d.risk.maxTradeAmountUsd = v; })} />
          <NumField label="Take profit (USD)" value={r.takeProfitUsd} onChange={v => patchDraft(d => { d.risk.takeProfitUsd = v; })} />
          <NumField label="Stop loss (USD)" value={r.stopLossUsd} onChange={v => patchDraft(d => { d.risk.stopLossUsd = v; })} />
          <NumField label="Kill switch drawdown (%)" value={r.killSwitchDrawdownPct} onChange={v => patchDraft(d => { d.risk.killSwitchDrawdownPct = v; })} />
          <NumField label="Cooldown after failure (sec)" value={r.cooldownAfterFailureSec} onChange={v => patchDraft(d => { d.risk.cooldownAfterFailureSec = v; })} />
          <TextField label="Blacklisted tokens (comma-separated addresses)" mono value={Array.isArray(r.blacklistTokens) ? r.blacklistTokens.join(', ') : ''} onChange={v => patchDraft(d => { d.risk.blacklistTokens = v.split(','); })} />
        </div>
      </Section>

      <Section title="Networks & Protocols" hint="RPC nodes, mempool nodes, watched tokens, DEX protocols">
        {Object.entries(draft.networks).map(([key, cfg]) => (
          <NetworkEditor
            key={key}
            networkKey={key}
            cfg={cfg}
            onChange={(fn) => patchDraft(d => { fn(d.networks[key]); })}
            onRemoveProtocol={(dexId) => removeProtocol(key, dexId)}
          />
        ))}
        <div className="add-protocol">
          {!newDex ? (
            <button className="btn btn-ghost" onClick={() => setNewDex({ network: Object.keys(draft.networks)[0], id: '', name: '', type: 'uniswapv2', factory: '', router: '' })}>
              + Add protocol
            </button>
          ) : (
            <div className="card inset">
              <div className="card-title">New protocol</div>
              <div className="grid-3">
                <Select label="Network" value={newDex.network} options={Object.keys(draft.networks)} onChange={v => setNewDex({ ...newDex, network: v })} />
                <TextField label="Protocol ID (e.g. mydex)" value={newDex.id} onChange={v => setNewDex({ ...newDex, id: v })} />
                <TextField label="Display name" value={newDex.name} onChange={v => setNewDex({ ...newDex, name: v })} />
                <Select label="Type (implementation)" value={newDex.type} options={DEX_TYPES} onChange={v => setNewDex({ ...newDex, type: v })} />
                <TextField label="Factory address" mono value={newDex.factory} onChange={v => setNewDex({ ...newDex, factory: v })} />
                <TextField label="Router address" mono value={newDex.router} onChange={v => setNewDex({ ...newDex, router: v })} />
              </div>
              <div className="toolbar-btns">
                <button className="btn btn-ghost" onClick={() => setNewDex(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={addProtocol} disabled={!newDex.id}>Add</button>
              </div>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

function NetworkEditor({ networkKey, cfg, onChange, onRemoveProtocol }: {
  networkKey: string;
  cfg: NetworkConfig;
  onChange: (fn: (n: NetworkConfig) => void) => void;
  onRemoveProtocol: (dexId: string) => void;
}) {
  const [showTokens, setShowTokens] = useState(false);
  const tokensText = Array.isArray(cfg.tokens) ? cfg.tokens.join('\n') : String(cfg.tokens || '');

  return (
    <div className={`card inset net-card ${cfg.enabled ? '' : 'disabled'}`}>
      <div className="net-head">
        <Toggle label={networkKey} value={cfg.enabled} onChange={v => onChange(n => { n.enabled = v; })} />
        <span className="muted">{cfg.dexes.filter(d => d.enabled).length}/{cfg.dexes.length} protocols</span>
      </div>
      <div className="grid-3">
        <TextField label="RPC node URL" mono value={cfg.rpcUrl} onChange={v => onChange(n => { n.rpcUrl = v; })} />
        <TextField label="Mempool RPC node URL (blank = same as RPC)" mono value={cfg.mempoolRpcUrl} onChange={v => onChange(n => { n.mempoolRpcUrl = v; })} />
        <NumField label="Poll interval (ms)" value={cfg.pollIntervalMs} onChange={v => onChange(n => { n.pollIntervalMs = Number(v) || 0; })} />
        <NumField label="Gas price override (Gwei, 0 = auto)" value={cfg.gasPriceGwei} onChange={v => onChange(n => { n.gasPriceGwei = Number(v) || 0; })} />
      </div>

      <div className="tokens-row">
        <button className="btn btn-ghost btn-sm" onClick={() => setShowTokens(s => !s)}>
          {showTokens ? '▾' : '▸'} Watched tokens ({Array.isArray(cfg.tokens) ? cfg.tokens.filter((t: string) => /^0x[0-9a-fA-F]{40}$/.test(t)).length : 0})
        </button>
        {showTokens && (
          <textarea
            className="input mono tokens-area"
            rows={4}
            value={tokensText}
            placeholder={'0x... one token address per line\n(first line = native wrapped token, second = stable)'}
            onChange={e => onChange(n => { (n as any).tokens = e.target.value; })}
          />
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Protocol</th><th>Type</th><th>Factory</th><th>Router</th><th>On</th><th></th></tr>
          </thead>
          <tbody>
            {cfg.dexes.map((d, i) => (
              <tr key={d.id}>
                <td>{d.name || d.id}</td>
                <td>
                  <select className="input input-sm" value={d.type} onChange={e => onChange(n => { n.dexes[i].type = e.target.value; })}>
                    {DEX_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td><input className="input input-sm mono" value={d.factory} onChange={e => onChange(n => { n.dexes[i].factory = e.target.value; })} /></td>
                <td><input className="input input-sm mono" value={d.router} onChange={e => onChange(n => { n.dexes[i].router = e.target.value; })} /></td>
                <td><Toggle label="" value={d.enabled} onChange={v => onChange(n => { n.dexes[i].enabled = v; })} /></td>
                <td><button className="btn btn-ghost btn-sm danger" onClick={() => onRemoveProtocol(d.id)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="agg-subtitle">Aggregators <span className="muted">(extra quote sources for token parsing & price comparison)</span></div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Aggregator</th><th>Type</th><th>API base URL</th><th>API key</th><th>On</th><th></th></tr>
          </thead>
          <tbody>
            {(cfg.aggregators || []).map((a, i) => (
              <tr key={a.id}>
                <td>{a.name || a.id}</td>
                <td>
                  <select className="input input-sm" value={a.type} onChange={e => onChange(n => { n.aggregators[i].type = e.target.value; })}>
                    {AGG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </td>
                <td><input className="input input-sm mono" value={a.apiBaseUrl} onChange={e => onChange(n => { n.aggregators[i].apiBaseUrl = e.target.value; })} /></td>
                <td><input className="input input-sm mono" type="password" value={a.apiKey} onChange={e => onChange(n => { n.aggregators[i].apiKey = e.target.value; })} /></td>
                <td><Toggle label="" value={a.enabled} onChange={v => onChange(n => { n.aggregators[i].enabled = v; })} /></td>
                <td><button className="btn btn-ghost btn-sm danger" onClick={() => onChange(n => { n.aggregators.splice(i, 1); })}>✕</button></td>
              </tr>
            ))}
            <tr>
              <td colSpan={6}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => onChange(n => {
                    n.aggregators.push({
                      id: 'agg' + Math.random().toString(36).slice(2, 6),
                      name: 'New aggregator',
                      type: 'openocean',
                      apiBaseUrl: 'https://open-api.openocean.finance/v3',
                      apiKey: '',
                      enabled: true,
                    });
                  })}
                >+ Add aggregator</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Settings;