"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiAgent = void 0;
const logger_1 = require("../logger");
const utils_1 = require("../utils");
const ALLOWED_PATCH_SECTIONS = ['trading', 'features', 'risk', 'polymarket', 'ai'];
class AiAgent {
    constructor(store, ctx) {
        this.history = [];
        this.lastAnalysis = null;
        this.store = store;
        this.ctx = ctx;
    }
    getProvider() {
        return this.store.get().ai.provider;
    }
    isConfigured() {
        const ai = this.store.get().ai;
        if (ai.provider === 'demo')
            return true;
        if (ai.provider === 'anthropic')
            return !!ai.apiKey;
        return !!ai.apiKey || !!ai.apiBaseUrl;
    }
    getHistory(limit = 50) {
        return this.history.slice(-limit);
    }
    clearHistory() {
        this.history = [];
        logger_1.logger.info('AI chat history cleared');
    }
    getLastAnalysis() {
        return this.lastAnalysis;
    }
    async chat(userMessage) {
        const ai = this.store.get().ai;
        this.history.push({ role: 'user', content: userMessage, ts: new Date().toISOString() });
        if (this.history.length > 100)
            this.history = this.history.slice(-100);
        let reply;
        try {
            if (ai.provider === 'demo' || !this.isConfigured()) {
                reply = this.demoChatReply(userMessage);
            }
            else {
                const system = this.buildSystemPrompt();
                const messages = [...this.history.slice(-20).map(m => ({ role: m.role, content: m.content }))];
                reply = await this.callProvider(system, messages);
            }
        }
        catch (err) {
            reply = `AI request failed: ${err.message}. Check Settings → AI Agent (provider, API key, base URL, model).`;
            logger_1.logger.warn('AI chat error:', err);
        }
        const msg = { role: 'assistant', content: reply, ts: new Date().toISOString() };
        this.history.push(msg);
        if (this.history.length > 100)
            this.history = this.history.slice(-100);
        return msg;
    }
    async analyzeMarket() {
        const ai = this.store.get().ai;
        const snapshot = this.buildMarketSnapshot();
        let result;
        try {
            if (ai.provider === 'demo' || !this.isConfigured()) {
                result = this.demoAnalysis();
            }
            else {
                const autonomous = !!ai.autonomousTrading;
                const system = 'You are the autonomous trading brain of a Polymarket prediction-market bot. Analyze the snapshot and reply with STRICT JSON only ' +
                    '(no markdown, no code fences): {"analysis": string, "settingsPatch": object, "recommendations": [{"section": string, "field": string, "current": any, "proposed": any, "reason": string}]}. ' +
                    'settingsPatch may contain ONLY these sections with scalar values: trading, features, risk, polymarket, ai. ' +
                    'Key fields: trading.minEdgePct (min arb edge %), trading.minSpreadCents, trading.orderSizeUsd, trading.btcTradeAmountUsd, ' +
                    'trading.signalWeights (spike/divergence/momentum), features.dryRun, risk.maxDailyLossUsd, risk.maxGlobalExposureUsd. ' +
                    'Be concrete and conservative: prefer small parameter adjustments justified by the data.' +
                    (autonomous
                        ? ' AUTONOMOUS MODE IS ON: your settingsPatch will be applied automatically and the bot will execute opportunities. Tune thresholds/limits so the bot trades profitably; disable dryRun (features.dryRun=false) only when confidence is high.'
                        : ' AUTONOMOUS MODE IS OFF: propose changes, they will only be applied manually.');
                const messages = [{ role: 'user', content: snapshot }];
                const raw = await this.callProvider(system, messages);
                result = this.parseAnalysis(raw);
            }
        }
        catch (err) {
            logger_1.logger.warn('AI analysis error:', err);
            result = {
                analysis: `AI request failed: ${err.message}. Check Settings → AI Agent.`,
                recommendations: [],
            };
        }
        let patch;
        if (result.settingsPatch && typeof result.settingsPatch === 'object') {
            patch = {};
            for (const section of ALLOWED_PATCH_SECTIONS) {
                const val = result.settingsPatch[section];
                if (val && typeof val === 'object' && !Array.isArray(val)) {
                    const clean = {};
                    for (const [k, v] of Object.entries(val)) {
                        if (typeof v !== 'object')
                            clean[k] = v;
                    }
                    if (Object.keys(clean).length > 0)
                        patch[section] = clean;
                }
            }
            if (Object.keys(patch).length === 0)
                patch = undefined;
        }
        const applied = !!(patch && (ai.autoApplyRecommendations || ai.autonomousTrading));
        if (applied) {
            this.store.update(patch);
        }
        const analysis = {
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
        if (this.history.length > 100)
            this.history = this.history.slice(-100);
        return analysis;
    }
    applyPatch(patch) {
        const clean = {};
        for (const section of ALLOWED_PATCH_SECTIONS) {
            const val = patch[section];
            if (val && typeof val === 'object' && !Array.isArray(val))
                clean[section] = val;
        }
        if (Object.keys(clean).length === 0)
            return null;
        this.store.update(clean);
        if (this.lastAnalysis) {
            this.lastAnalysis = { ...this.lastAnalysis, applied: true };
        }
        return this.lastAnalysis;
    }
    // ---------- Providers ----------
    async callProvider(system, messages) {
        const ai = this.store.get().ai;
        if (ai.provider === 'anthropic') {
            return this.callAnthropic(system, messages);
        }
        return this.callOpenAiCompatible(system, messages);
    }
    async callOpenAiCompatible(system, messages) {
        const ai = this.store.get().ai;
        const base = (ai.provider === 'openai'
            ? 'https://api.openai.com/v1'
            : ai.provider === 'openrouter'
                ? 'https://openrouter.ai/api/v1'
                : (ai.apiBaseUrl || '').replace(/\/+$/, ''));
        if (!base)
            throw new Error('API base URL is not configured');
        const headers = { 'Content-Type': 'application/json' };
        if (ai.apiKey)
            headers['Authorization'] = `Bearer ${ai.apiKey}`;
        if (ai.provider === 'openrouter') {
            headers['HTTP-Referer'] = 'http://127.0.0.1:4449';
            headers['X-Title'] = 'PolymarketAiBot';
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
        const json = await res.json();
        const content = json?.choices?.[0]?.message?.content;
        if (!content)
            throw new Error('empty AI response');
        return String(content);
    }
    async callAnthropic(system, messages) {
        const ai = this.store.get().ai;
        const base = (ai.apiBaseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
        if (!ai.apiKey)
            throw new Error('Anthropic API key is not configured');
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
        const json = await res.json();
        const content = json?.content?.[0]?.text;
        if (!content)
            throw new Error('empty AI response');
        return String(content);
    }
    // ---------- Prompts / parsing ----------
    buildSystemPrompt() {
        const s = this.store.get();
        const stats = (0, utils_1.jsonSafe)(this.ctx.getStats());
        return [
            'You are the built-in AI assistant of PolymarketAiBot, a prediction-market trading bot (bundle arbitrage, market making, BTC 15m signal markets).',
            'You help the operator tune the bot: edges, spreads, order sizes, risk limits, signal weights.',
            'Current config (summary):',
            `- mode: ${s.trading.mode}, loop: ${s.trading.loopIntervalMs}ms`,
            `- arb: minEdgePct=${s.trading.minEdgePct}, orderSizeUsd=${s.trading.orderSizeUsd}, takerFeeBps=${s.trading.takerFeeBps}`,
            `- market making: minSpreadCents=${s.trading.minSpreadCents}, tickSizeCents=${s.trading.tickSizeCents}`,
            `- btc15: bet=$${s.trading.btcTradeAmountUsd}, spikeThresholdPct=${s.trading.spikeThresholdPct}, decisionThreshold=${s.trading.decisionThreshold}, weights=${JSON.stringify(s.trading.signalWeights)}`,
            `- features: dryRun=${s.features.dryRun}, bundleArb=${s.features.enableBundleArb}, marketMaking=${s.features.enableMarketMaking}, btcSignals=${s.features.enableBtcSignals}`,
            `- risk: maxDailyLossUsd=${s.risk.maxDailyLossUsd}, maxGlobalExposureUsd=${s.risk.maxGlobalExposureUsd}, maxDrawdownPct=${s.risk.maxDrawdownPct}, cooldown=${s.risk.cooldownAfterFailureSec}s`,
            `- live credentials: ${s.polymarket.privateKey ? 'configured' : 'not set (dry-run only)'}`,
            `- autonomous mode: ${s.ai.autonomousTrading ? 'ON (you may change settings and the bot trades automatically)' : 'OFF'}`,
            `- bot stats: trades=${stats.totalTrades}, profit=$${(stats.totalProfit || 0).toFixed(2)}, opportunities=${stats.opportunitiesFound}, successRate=${(stats.successRate || 0).toFixed(1)}%`,
            'Answer concisely and practically. When suggesting config changes, mention exact field names (e.g. trading.minEdgePct).',
        ].join('\n');
    }
    buildMarketSnapshot() {
        const stats = (0, utils_1.jsonSafe)(this.ctx.getStats());
        const opps = (0, utils_1.jsonSafe)(this.ctx.getRecentOpportunities().slice(-10));
        const s = this.store.get();
        return [
            'MARKET & BOT SNAPSHOT',
            `time: ${new Date().toISOString()}`,
            `stats: ${JSON.stringify({ status: stats.status, uptimeSec: stats.uptimeSec, totalProfit: stats.totalProfit, totalTrades: stats.totalTrades, successRate: stats.successRate, opportunitiesFound: stats.opportunitiesFound, dailyPnl: stats.dailyPnl, roiPct: stats.roiPct, dryRun: stats.dryRun, cashBalance: stats.cashBalance, exposureUsd: stats.exposureUsd, marketsMonitored: stats.marketsMonitored })}`,
            `recent opportunities (up to 10): ${JSON.stringify(opps)}`,
            `risk stats: ${JSON.stringify(stats.riskStats)}`,
            `autonomous mode: ${s.ai.autonomousTrading ? 'ON (apply your settingsPatch automatically; bot executes opportunities)' : 'OFF (manual approval)'}`,
        ].join('\n');
    }
    parseAnalysis(raw) {
        let text = raw.trim();
        const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fence)
            text = fence[1].trim();
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
        }
        catch {
            return { analysis: raw, recommendations: [] };
        }
    }
    // ---------- Demo (keyless) provider ----------
    demoChatReply(userMessage) {
        const stats = (0, utils_1.jsonSafe)(this.ctx.getStats());
        const s = this.store.get();
        return [
            `Demo AI mode (no API key configured — set a real provider in Settings → AI Agent).`,
            ``,
            `Quick read of the current state:`,
            `- ${stats.opportunitiesFound} opportunities found, ${stats.totalTrades} trades (dry-run: ${stats.dryRun}), PnL $${Number(stats.totalProfit || 0).toFixed(2)}.`,
            `- mode: ${s.trading.mode}, min edge: ${s.trading.minEdgePct}%, MM spread threshold: ¢${s.trading.minSpreadCents}.`,
            `- features: bundleArb=${s.features.enableBundleArb}, marketMaking=${s.features.enableMarketMaking}, btcSignals=${s.features.enableBtcSignals}.`,
            ``,
            `You asked: "${userMessage}".`,
            `Tip: run "Analyze market" for concrete parameter recommendations, or connect OpenAI/OpenRouter/Anthropic for full chat.`,
        ].join('\n');
    }
    demoAnalysis() {
        const s = this.store.get();
        const stats = (0, utils_1.jsonSafe)(this.ctx.getStats());
        const recs = [];
        const patch = {};
        if (stats.opportunitiesFound === 0 && s.trading.minEdgePct > 0.5) {
            const proposed = Math.max(0.2, Number(s.trading.minEdgePct) / 2);
            recs.push({ section: 'trading', field: 'minEdgePct', current: s.trading.minEdgePct, proposed, reason: 'No candidates passed the edge threshold; lower it to widen the funnel' });
            patch.trading = { ...(patch.trading || {}), minEdgePct: proposed };
        }
        if (stats.marketsMonitored < 50 && s.trading.maxMarketsScanned < 1000) {
            const proposed = Math.min(2000, Number(s.trading.maxMarketsScanned) * 2);
            recs.push({ section: 'trading', field: 'maxMarketsScanned', current: s.trading.maxMarketsScanned, proposed, reason: 'Few books loaded — widen the discovery scan (watch rate limits)' });
            patch.trading = { ...(patch.trading || {}), maxMarketsScanned: proposed };
        }
        if (!s.features.enableBundleArb) {
            recs.push({ section: 'features', field: 'enableBundleArb', current: false, proposed: true, reason: 'Bundle arb is the core edge detector; enable it' });
            patch.features = { ...(patch.features || {}), enableBundleArb: true };
        }
        if (Number(stats.failedTrades) > Number(stats.successfulTrades) && !s.features.dryRun) {
            recs.push({ section: 'features', field: 'dryRun', current: false, proposed: true, reason: 'Failed trade ratio is high — simulate first' });
            patch.features = { ...(patch.features || {}), dryRun: true };
        }
        if (s.risk.cooldownAfterFailureSec < 30) {
            recs.push({ section: 'risk', field: 'cooldownAfterFailureSec', current: s.risk.cooldownAfterFailureSec, proposed: 60, reason: 'Short cooldowns after failures can chase losses' });
            patch.risk = { ...(patch.risk || {}), cooldownAfterFailureSec: 60 };
        }
        if (!s.polymarket.privateKey) {
            recs.push({ section: 'polymarket', field: 'privateKey', current: '', proposed: '<set in Settings>', reason: 'No live credentials — the bot stays read-only/dry-run' });
        }
        const analysis = [
            `Demo AI heuristic analysis (${new Date().toISOString()}):`,
            `- Monitoring ${stats.marketsMonitored} markets; ${stats.opportunitiesFound} opportunities found so far.`,
            `- ${stats.totalTrades} trades (success rate ${(Number(stats.successRate) || 0).toFixed(1)}%), PnL $${Number(stats.totalProfit || 0).toFixed(2)}.`,
            `- Autonomous mode: ${s.ai.autonomousTrading ? 'ON — recommendations are applied automatically' : 'OFF (enable it in Settings → AI Agent)'}.`,
            recs.length ? `- ${recs.length} parameter adjustments proposed (see cards).` : '- Current configuration looks reasonable; no changes proposed.',
            'Connect a real AI provider (Settings → AI Agent) for model-based market analysis.',
        ].join('\n');
        return { analysis, recommendations: recs, settingsPatch: Object.keys(patch).length ? patch : undefined, applied: false, provider: 'demo', ts: new Date().toISOString() };
    }
}
exports.AiAgent = AiAgent;
