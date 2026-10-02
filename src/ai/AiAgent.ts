import { SettingsStore } from '../settings/SettingsStore';
import { PriceOracle, PriceSnapshot } from './PriceOracle';
import { logger } from '../logger';
import { jsonSafe } from '../utils';

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: string;
  meta?: any;
}

export interface AiRecommendation {
  section: string;
  field: string;
  current: any;
  proposed: any;
  reason: string;
}

export interface AiAnalysis {
  analysis: string;
  recommendations: AiRecommendation[];
  settingsPatch?: Record<string, any>;
  applied: boolean;
  provider: string;
  ts: string;
}

interface BotContext {
  getStats: () => any;
  getRecentOpportunities: () => any[];
}

const ALLOWED_PATCH_SECTIONS = ['trading', 'features', 'flashloan', 'risk', 'wallets'];

export class AiAgent {
  private store: SettingsStore;
  private oracle: PriceOracle;
  private ctx: BotContext;
  private history: AiMessage[] = [];
  private lastAnalysis: AiAnalysis | null = null;

  constructor(store: SettingsStore, oracle: PriceOracle, ctx: BotContext) {
    this.store = store;
    this.oracle = oracle;
    this.ctx = ctx;
  }

  getProvider(): string {
    return this.store.get().ai.provider;
  }

  isConfigured(): boolean {
    const ai = this.store.get().ai;
    if (ai.provider === 'demo') return true;
    if (ai.provider === 'anthropic') return !!ai.apiKey;
    return !!ai.apiKey || !!ai.apiBaseUrl; // custom endpoints may be keyless (local LLM)
  }

  getHistory(limit: number = 50): AiMessage[] {
    return this.history.slice(-limit);
  }

  clearHistory(): void {
    this.history = [];
    logger.info('AI chat history cleared');
  }

  getLastAnalysis(): AiAnalysis | null {
    return this.lastAnalysis;
  }

  /**
   * Chat with the assistant about the bot / market
   */
  async chat(userMessage: string): Promise<AiMessage> {
    const ai = this.store.get().ai;
    this.history.push({ role: 'user', content: userMessage, ts: new Date().toISOString() });
    if (this.history.length > 100) this.history = this.history.slice(-100);

    let reply: string;
    try {
      if (ai.provider === 'demo' || !this.isConfigured()) {
        reply = this.demoChatReply(userMessage);
      } else {
        const system = this.buildSystemPrompt();
        const messages = [...this.history.slice(-20).map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))];
        reply = await this.callProvider(system, messages);
      }
    } catch (err) {
      reply = `AI request failed: ${(err as Error).message}. Check Settings → AI Agent (provider, API key, base URL, model).`;
      logger.warn('AI chat error:', err);
    }

    const msg: AiMessage = { role: 'assistant', content: reply, ts: new Date().toISOString() };
    this.history.push(msg);
    if (this.history.length > 100) this.history = this.history.slice(-100);
    return msg;
  }

  /**
   * Deep market analysis: snapshot + current settings -> recommendations (optionally auto-applied)
   */
  async analyzeMarket(): Promise<AiAnalysis> {
    const ai = this.store.get().ai;
    const snapshot = this.buildMarketSnapshot();

    let result: { analysis: string; settingsPatch?: any; recommendations: AiRecommendation[] };
    try {
      if (ai.provider === 'demo' || !this.isConfigured()) {
        result = this.demoAnalysis();
      } else {
        const autonomous = !!ai.autonomousTrading;
        const system =
          'You are the autonomous trading brain of a DeFi arbitrage bot. Analyze the market snapshot and reply with STRICT JSON only ' +
          '(no markdown, no code fences): {"analysis": string, "settingsPatch": object, "recommendations": [{"section": string, "field": string, "current": any, "proposed": any, "reason": string}]}. ' +
          'settingsPatch may contain ONLY these sections with scalar values: trading, features, flashloan, risk, wallets. ' +
          'In the wallets section you may only set activeId (id of the trading wallet to switch to). ' +
          'Be concrete and conservative: prefer small parameter adjustments justified by the data.' +
          (autonomous
            ? ' AUTONOMOUS MODE IS ON: your settingsPatch will be applied automatically, and the bot will execute the best profitable opportunity it finds. Tune thresholds/limits so the bot trades profitably, and disable dryRun (features.dryRun=false) only when confidence is high.'
            : ' AUTONOMOUS MODE IS OFF: propose changes, but they will only be applied manually.');
        const messages = [{ role: 'user' as const, content: snapshot }];
        const raw = await this.callProvider(system, messages);
        result = this.parseAnalysis(raw);
      }
    } catch (err) {
      logger.warn('AI analysis error:', err);
      result = {
        analysis: `AI request failed: ${(err as Error).message}. Check Settings → AI Agent.`,
        recommendations: [],
      };
    }

    // Sanitize patch: only allowed sections, scalars
    let patch: Record<string, any> | undefined;
    if (result.settingsPatch && typeof result.settingsPatch === 'object') {
      patch = {};
      for (const section of ALLOWED_PATCH_SECTIONS) {
        const val = (result.settingsPatch as any)[section];
        if (val && typeof val === 'object' && !Array.isArray(val)) {
          const clean: Record<string, any> = {};
          for (const [k, v] of Object.entries(val)) {
            if (typeof v !== 'object') clean[k] = v;
          }
          if (Object.keys(clean).length > 0) patch[section] = clean;
        }
      }
      if (Object.keys(patch).length === 0) patch = undefined;
    }

    // Autonomous mode grants the right to change settings without manual approval
    const applied = !!(patch && (ai.autoApplyRecommendations || ai.autonomousTrading));
    if (applied) {
      this.store.update(patch!);
    }

    const analysis: AiAnalysis = {
      analysis: result.analysis,
      recommendations: Array.isArray(result.recommendations) ? result.recommendations.slice(0, 10) : [],
      settingsPatch: patch,
      applied,
      provider: ai.provider,
      ts: new Date().toISOString(),
    };
    this.lastAnalysis = analysis;

    this.history.push({
      role: 'assistant',
      content: `📊 Market analysis (${analysis.ts}):\n${analysis.analysis}` +
        (analysis.recommendations.length ? `\n\nRecommendations:\n${analysis.recommendations.map(r => `• ${r.section}.${r.field}: ${JSON.stringify(r.current)} → ${JSON.stringify(r.proposed)} — ${r.reason}`).join('\n')}` : '') +
        (applied ? '\n\n✅ Auto-applied.' : ''),
      ts: analysis.ts,
      meta: { kind: 'analysis', recommendations: analysis.recommendations, patch: analysis.settingsPatch },
    });
    if (this.history.length > 100) this.history = this.history.slice(-100);

    return analysis;
  }

  /**
   * Manually apply a recommendation patch from the dashboard
   */
  applyPatch(patch: Record<string, any>): AiAnalysis | null {
    const clean: Record<string, any> = {};
    for (const section of ALLOWED_PATCH_SECTIONS) {
      const val = patch[section];
      if (val && typeof val === 'object' && !Array.isArray(val)) clean[section] = val;
    }
    if (Object.keys(clean).length === 0) return null;
    this.store.update(clean);
    if (this.lastAnalysis) {
      this.lastAnalysis = { ...this.lastAnalysis, applied: true };
    }
    return this.lastAnalysis;
  }

  // ---------- Providers ----------

  private async callProvider(system: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<string> {
    const ai = this.store.get().ai;
    if (ai.provider === 'anthropic') {
      return this.callAnthropic(system, messages);
    }
    return this.callOpenAiCompatible(system, messages);
  }

  private async callOpenAiCompatible(system: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<string> {
    const ai = this.store.get().ai;
    const base = (ai.provider === 'openai'
      ? 'https://api.openai.com/v1'
      : ai.provider === 'openrouter'
        ? 'https://openrouter.ai/api/v1'
        : (ai.apiBaseUrl || '').replace(/\/+$/, ''));
    if (!base) throw new Error('API base URL is not configured');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (ai.apiKey) headers['Authorization'] = `Bearer ${ai.apiKey}`;
    if (ai.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'http://127.0.0.1:4449';
      headers['X-Title'] = 'ArbAiBot';
    }

    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: ai.model || 'gpt-4o-mini',
        messages: [{ role: 'system', content: system }, ...messages],
        temperature: ai.temperature ?? 0.3,
        max_tokens: ai.maxTokens ?? 1200,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`provider ${res.status}: ${text.slice(0, 300)}`);
    }
    const json: any = await res.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content) throw new Error('empty AI response');
    return String(content);
  }

  private async callAnthropic(system: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<string> {
    const ai = this.store.get().ai;
    const base = (ai.apiBaseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
    if (!ai.apiKey) throw new Error('Anthropic API key is not configured');

    const res = await fetch(`${base}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ai.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: ai.model || 'claude-3-5-haiku-20241022',
        max_tokens: ai.maxTokens ?? 1200,
        temperature: ai.temperature ?? 0.3,
        system,
        messages,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`anthropic ${res.status}: ${text.slice(0, 300)}`);
    }
    const json: any = await res.json();
    const content = json?.content?.[0]?.text;
    if (!content) throw new Error('empty AI response');
    return String(content);
  }

  // ---------- Prompts / parsing ----------

  private buildSystemPrompt(): string {
    const s = this.store.get();
    const stats: any = jsonSafe(this.ctx.getStats());
    return [
      'You are the built-in AI assistant of ArbAiBot, a DeFi arbitrage bot (EVM DEX arbitrage).',
      'You help the operator tune the bot: trading amounts, profit thresholds, risk limits, scan modes, protocols.',
      'Current config (summary):',
      `- scan mode: ${s.trading.scanMode}, loop: ${s.trading.loopIntervalMs}ms`,
      `- trade amounts: native=${s.trading.tradeAmountNative}, stable=${s.trading.stableTokenAmount}, minProfitUsd=${s.trading.minProfitUsd}, maxSlippagePct=${s.trading.maxSlippagePct}`,
      `- features: mempool=${s.features.enableMempoolMonitor}, crosschain=${s.features.enableCrosschain}, flashLoans=${s.features.enableFlashLoans}, perp=${s.features.enablePerpArb}, dryRun=${s.features.dryRun}`,
      `- risk: maxDailyLossUsd=${s.risk.maxDailyLossUsd}, stopLossUsd=${s.risk.stopLossUsd}, takeProfitUsd=${s.risk.takeProfitUsd}, cooldown=${s.risk.cooldownAfterFailureSec}s`,
      '- networks enabled: ' + Object.keys(s.networks).filter(k => s.networks[k].enabled).join(', '),
      `- autonomous mode: ${s.ai.autonomousTrading ? 'ON (you may change settings and the bot trades automatically)' : 'OFF'}`,
      this.walletSummaryLine(),
      `- bot stats: trades=${stats.totalTrades}, profit=$${(stats.totalProfit || 0).toFixed(2)}, opportunities=${stats.opportunitiesFound}, successRate=${(stats.successRate || 0).toFixed(1)}%`,
      'Answer concisely and practically. When suggesting config changes, mention exact field names (e.g. trading.minProfitUsd).',
    ].join('\n');
  }

  // Short human-readable line describing the wallet fleet for prompts
  private walletSummaryLine(): string {
    const wallets = this.store.get().wallets;
    if (!wallets || !wallets.list.length) return '- wallets: none configured (add wallets in Settings → Wallet Settings)';
    const active = wallets.list.find(w => w.id === wallets.activeId);
    const list = wallets.list.map(w => `${w.label}${w.id === wallets.activeId ? '*' : ''}${w.enabled ? '' : ' (paused)'}`).join(', ');
    return `- wallets (${wallets.list.length}): ${list}; active: ${active ? `${active.label} (${active.address || 'no address'})` : 'none'}`;
  }

  private buildMarketSnapshot(): string {
    const stats: any = jsonSafe(this.ctx.getStats());
    const opps = jsonSafe(this.ctx.getRecentOpportunities().slice(-10));
    const s = this.store.get();
    const networks: string[] = Object.keys(s.networks)
      .filter(k => s.networks[k].enabled)
      .map(k => {
        const n = s.networks[k];
        return `${k}: ${n.dexes.filter(d => d.enabled).length} protocols, ${n.aggregators.filter(a => a.enabled).length} aggregators, ${n.tokens.length} watched tokens`;
      });
    return [
      'MARKET & BOT SNAPSHOT',
      `time: ${new Date().toISOString()}`,
      `stats: ${JSON.stringify({ status: stats.status, uptimeSec: stats.uptimeSec, totalProfit: stats.totalProfit, totalTrades: stats.totalTrades, successRate: stats.successRate, opportunitiesFound: stats.opportunitiesFound, dailyPnl: stats.dailyPnl, roiPct: stats.roiPct, dryRun: stats.dryRun })}`,
      `recent opportunities (up to 10): ${JSON.stringify(opps)}`,
      `networks: ${networks.join(' | ')}`,
      `risk stats: ${JSON.stringify(stats.riskStats)}`,
      `autonomous mode: ${this.store.get().ai.autonomousTrading ? 'ON (apply your settingsPatch automatically; bot executes best opportunity)' : 'OFF (manual approval)'}`,
      this.walletSummaryLine(),
    ].join('\n');
  }

  private parseAnalysis(raw: string): { analysis: string; settingsPatch?: any; recommendations: AiRecommendation[] } {
    let text = raw.trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) text = fence[1].trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      return { analysis: raw, recommendations: [] };
    }
    try {
      const json = JSON.parse(text.slice(start, end + 1));
      return {
        analysis: String(json.analysis || ''),
        settingsPatch: json.settingsPatch,
        recommendations: Array.isArray(json.recommendations) ? json.recommendations : [],
      };
    } catch {
      return { analysis: raw, recommendations: [] };
    }
  }

  // ---------- Demo (keyless) provider ----------

  private demoChatReply(userMessage: string): string {
    const stats: any = jsonSafe(this.ctx.getStats());
    const s = this.store.get();
    return [
      `Demo AI mode (no API key configured — set a real provider in Settings → AI Agent).`,
      ``,
      `Quick read of the current state:`,
      `- ${stats.opportunitiesFound} opportunities found, ${stats.totalTrades} trades (dry-run: ${stats.dryRun}), profit $${Number(stats.totalProfit || 0).toFixed(2)}.`,
      `- scan mode: ${s.trading.scanMode}, min profit: $${s.trading.minProfitUsd}, slippage cap: ${s.trading.maxSlippagePct}%.`,
      `- enabled networks: ${Object.keys(s.networks).filter(k => s.networks[k].enabled).join(', ')}.`,
      ``,
      `You asked: "${userMessage}".`,
      `Tip: run "Analyze market" for concrete parameter recommendations, or connect OpenAI/OpenRouter/Anthropic for full chat.`,
    ].join('\n');
  }

  private demoAnalysis(): AiAnalysis {
    const s = this.store.get();
    const stats: any = jsonSafe(this.ctx.getStats());
    const recs: AiRecommendation[] = [];
    const patch: Record<string, any> = {};

    if (stats.opportunitiesFound === 0 && s.trading.minProfitUsd > 0.2) {
      const proposed = Math.max(0.05, Number(s.trading.minProfitUsd) / 2);
      recs.push({ section: 'trading', field: 'minProfitUsd', current: s.trading.minProfitUsd, proposed, reason: 'No candidates passed the profit threshold; lower it to widen the funnel' });
      patch.trading = { ...(patch.trading || {}), minProfitUsd: proposed };
    }
    if (s.trading.scanMode !== 'both') {
      recs.push({ section: 'trading', field: 'scanMode', current: s.trading.scanMode, proposed: 'both', reason: 'Use both mempool and pool scanning for maximum coverage' });
      patch.trading = { ...(patch.trading || {}), scanMode: 'both' };
    }
    if (!s.features.enableMempoolMonitor) {
      recs.push({ section: 'features', field: 'enableMempoolMonitor', current: false, proposed: true, reason: 'Mempool stream adds early signals for pairs seen in pending swaps' });
      patch.features = { ...(patch.features || {}), enableMempoolMonitor: true };
    }
    if (s.trading.maxPairsPerScan < 10) {
      recs.push({ section: 'trading', field: 'maxPairsPerScan', current: s.trading.maxPairsPerScan, proposed: Math.min(16, Number(s.trading.maxPairsPerScan) * 2), reason: 'More watched token pairs per scan increases discovery (watch RPC budget)' });
      patch.trading = { ...(patch.trading || {}), maxPairsPerScan: Math.min(16, Number(s.trading.maxPairsPerScan) * 2) };
    }
    const aggregatorNetworks = Object.entries(s.networks).filter(([, n]) => n.enabled && n.aggregators.some(a => a.enabled)).length;
    if (aggregatorNetworks === 0) {
      recs.push({ section: 'networks', field: 'aggregators', current: 0, proposed: 'add OpenOcean/1inch per network', reason: 'Aggregator quotes add competing liquidity sources; enable in Settings → Networks & Protocols' });
    }
    if (Number(stats.failedTrades) > Number(stats.successfulTrades) && !s.features.dryRun) {
      recs.push({ section: 'features', field: 'dryRun', current: false, proposed: true, reason: 'Failed trade ratio is high — simulate first' });
      patch.features = { ...(patch.features || {}), dryRun: true };
    }
    if (s.risk.cooldownAfterFailureSec < 30) {
      recs.push({ section: 'risk', field: 'cooldownAfterFailureSec', current: s.risk.cooldownAfterFailureSec, proposed: 60, reason: 'Short cooldowns after failures can chase losses' });
      patch.risk = { ...(patch.risk || {}), cooldownAfterFailureSec: 60 };
    }

    const analysis = [
      `Demo AI heuristic analysis (${new Date().toISOString()}):`,
      `- Scanning ${Object.keys(s.networks).filter(k => s.networks[k].enabled).length} networks; ${stats.opportunitiesFound} opportunities found so far.`,
      `- ${stats.totalTrades} trades (success rate ${(Number(stats.successRate) || 0).toFixed(1)}%), profit $${Number(stats.totalProfit || 0).toFixed(2)}.`,
      `- Autonomous mode: ${s.ai.autonomousTrading ? 'ON — recommendations are applied automatically' : 'OFF (enable it in Settings → AI Agent)'}; ${this.walletSummaryLine()}`,
      recs.length ? `- ${recs.length} parameter adjustments proposed (see cards).` : '- Current configuration looks reasonable; no changes proposed.',
      'Connect a real AI provider (Settings → AI Agent) for model-based market analysis.',
    ].join('\n');

    return { analysis, recommendations: recs, settingsPatch: Object.keys(patch).length ? patch : undefined, applied: false, provider: 'demo', ts: new Date().toISOString() };
  }
}