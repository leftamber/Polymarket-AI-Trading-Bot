"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebServer = void 0;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const morgan_1 = __importDefault(require("morgan"));
const path_1 = __importDefault(require("path"));
const ethers_1 = require("ethers");
const logger_1 = require("../logger");
const SettingsStore_1 = require("../settings/SettingsStore");
const utils_1 = require("../utils");
class WebServer {
    constructor(bot, store, port = Number(process.env.DASHBOARD_PORT || 4449)) {
        this.bot = bot;
        this.store = store;
        this.port = port;
        this.app = (0, express_1.default)();
        this.publicDir = WebServer.resolvePublicDir();
        this.setupMiddleware();
        this.setupStaticFiles();
        this.setupRoutes();
    }
    // The React dashboard is built into dist/web/public by vite
    static resolvePublicDir() {
        const fs = require('fs');
        const candidates = [
            path_1.default.join(__dirname, 'public'),
            path_1.default.join(__dirname, '..', '..', 'webapp', 'dist'),
        ];
        return candidates.find((p) => fs.existsSync(p)) || candidates[0];
    }
    setupMiddleware() {
        this.app.use((0, helmet_1.default)({
            contentSecurityPolicy: {
                directives: {
                    ...helmet_1.default.contentSecurityPolicy.getDefaultDirectives(),
                    'script-src': ["'self'"],
                },
            },
        }));
        this.app.use((0, cors_1.default)());
        this.app.use((0, morgan_1.default)('combined'));
        this.app.use(express_1.default.json({ limit: '2mb' }));
        this.app.use(express_1.default.urlencoded({ extended: true }));
    }
    setupStaticFiles() {
        this.app.use(express_1.default.static(this.publicDir));
    }
    setupRoutes() {
        // ---------- Bot control ----------
        this.app.post('/api/bot/start', async (req, res) => {
            try {
                await this.bot.startTrading();
                res.json({ success: true, status: this.bot.getIsRunning() ? 'running' : 'stopped' });
            }
            catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });
        this.app.post('/api/bot/stop', async (req, res) => {
            try {
                await this.bot.stopTrading();
                res.json({ success: true, status: this.bot.getIsRunning() ? 'running' : 'stopped' });
            }
            catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });
        // ---------- Status / stats / logs ----------
        this.app.get('/api/status', (req, res) => {
            res.json({
                status: this.bot.getIsRunning() ? 'running' : 'stopped',
                timestamp: new Date().toISOString(),
                dashboard: `http://127.0.0.1:${this.port}`,
            });
        });
        this.app.get('/api/stats', (req, res) => {
            res.json((0, utils_1.jsonSafe)(this.bot.getStats()));
        });
        this.app.get('/api/logs', (req, res) => {
            const limit = Math.min(parseInt(String(req.query.limit || '200')) || 200, 2000);
            const level = String(req.query.level || 'all');
            res.json((0, utils_1.jsonSafe)(this.bot.getLogs(limit, level)));
        });
        this.app.get('/api/opportunities', (req, res) => {
            res.json((0, utils_1.jsonSafe)(this.bot.getRecentOpportunities()));
        });
        // ---------- Settings ----------
        this.app.get('/api/settings', (req, res) => {
            res.json(this.store.get());
        });
        this.app.put('/api/settings', (req, res) => {
            try {
                if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
                    return res.status(400).json({ success: false, error: 'Invalid settings payload' });
                }
                const updated = this.store.update(req.body);
                res.json({ success: true, settings: updated, version: this.store.getVersion() });
            }
            catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });
        this.app.post('/api/settings/reset', (req, res) => {
            const updated = this.store.reset();
            res.json({ success: true, settings: updated });
        });
        // ---------- Wallets (multi-wallet management) ----------
        this.app.get('/api/wallets', (req, res) => {
            res.json((0, utils_1.jsonSafe)(this.store.getWallets()));
        });
        // Generate a fresh wallet (address + private key + seed phrase) — returned
        // only, not stored; the dashboard modal lets the operator keep it.
        this.app.post('/api/wallets/generate', (req, res) => {
            try {
                const w = ethers_1.ethers.Wallet.createRandom();
                res.json({
                    address: w.address,
                    privateKey: w.privateKey,
                    mnemonic: w.mnemonic?.phrase || '',
                });
            }
            catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });
        this.app.post('/api/wallets', (req, res) => {
            try {
                const body = req.body || {};
                const entry = this.store.addWallet(body);
                res.json({ success: true, wallet: (0, utils_1.jsonSafe)(entry), wallets: (0, utils_1.jsonSafe)(this.store.getWallets()) });
            }
            catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });
        this.app.put('/api/wallets/:id', (req, res) => {
            try {
                const entry = this.store.updateWallet(String(req.params.id), req.body || {});
                if (!entry)
                    return res.status(404).json({ success: false, error: `Wallet ${req.params.id} not found` });
                res.json({ success: true, wallet: (0, utils_1.jsonSafe)(entry), wallets: (0, utils_1.jsonSafe)(this.store.getWallets()) });
            }
            catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });
        this.app.delete('/api/wallets/:id', (req, res) => {
            const ok = this.store.removeWallet(String(req.params.id));
            if (!ok)
                return res.status(404).json({ success: false, error: `Wallet ${req.params.id} not found` });
            res.json({ success: true, wallets: (0, utils_1.jsonSafe)(this.store.getWallets()) });
        });
        this.app.post('/api/wallets/:id/activate', (req, res) => {
            const entry = this.store.setActiveWallet(String(req.params.id));
            if (!entry)
                return res.status(404).json({ success: false, error: `Wallet ${req.params.id} not found` });
            res.json({ success: true, wallet: (0, utils_1.jsonSafe)(entry), wallets: (0, utils_1.jsonSafe)(this.store.getWallets()) });
        });
        // ---------- Networks & protocols ----------
        this.app.get('/api/networks', (req, res) => {
            const settings = this.store.get();
            res.json(Object.entries(settings.networks).map(([key, cfg]) => ({
                key,
                name: SettingsStore_1.NETWORK_NAMES[key]?.name || key,
                native: SettingsStore_1.NETWORK_NAMES[key]?.native || '',
                ...cfg,
            })));
        });
        this.app.post('/api/networks/:network/dexes', (req, res) => {
            const network = String(req.params.network);
            const settings = this.store.get();
            const netCfg = settings.networks[network];
            if (!netCfg) {
                return res.status(404).json({ success: false, error: `Network ${network} not found` });
            }
            const { id, name, type, factory, router, enabled } = req.body || {};
            if (!id || !type) {
                return res.status(400).json({ success: false, error: 'id and type are required' });
            }
            if (netCfg.dexes.some((d) => d.id === id)) {
                return res.status(409).json({ success: false, error: `Protocol ${id} already exists on ${network}` });
            }
            const dex = {
                id: String(id),
                name: String(name || id),
                type: String(type),
                factory: String(factory || ''),
                router: String(router || ''),
                enabled: enabled !== false,
            };
            this.store.update({ networks: { [network]: { dexes: [...netCfg.dexes, dex] } } });
            logger_1.logger.info(`Protocol ${dex.id} added to ${network}`);
            res.json({ success: true, dexes: this.store.get().networks[network].dexes });
        });
        this.app.put('/api/networks/:network/dexes/:dexId', (req, res) => {
            const network = String(req.params.network);
            const dexId = String(req.params.dexId);
            const netCfg = this.store.get().networks[network];
            if (!netCfg) {
                return res.status(404).json({ success: false, error: `Network ${network} not found` });
            }
            const idx = netCfg.dexes.findIndex(d => d.id === dexId);
            if (idx === -1) {
                return res.status(404).json({ success: false, error: `Protocol ${dexId} not found` });
            }
            const dexes = netCfg.dexes.map((d) => d.id === dexId ? { ...d, ...req.body, id: d.id } : d);
            this.store.update({ networks: { [network]: { dexes } } });
            res.json({ success: true, dexes: this.store.get().networks[network].dexes });
        });
        this.app.delete('/api/networks/:network/dexes/:dexId', (req, res) => {
            const network = String(req.params.network);
            const dexId = String(req.params.dexId);
            const netCfg = this.store.get().networks[network];
            if (!netCfg) {
                return res.status(404).json({ success: false, error: `Network ${network} not found` });
            }
            const dexes = netCfg.dexes.filter((d) => d.id !== dexId);
            this.store.update({ networks: { [network]: { dexes } } });
            logger_1.logger.info(`Protocol ${dexId} removed from ${network}`);
            res.json({ success: true, dexes: this.store.get().networks[network].dexes });
        });
        // ---------- AI agent ----------
        this.app.get('/api/ai/status', (req, res) => {
            const agent = this.bot.getAiAgent();
            const ai = this.store.get().ai;
            res.json((0, utils_1.jsonSafe)({
                provider: ai.provider,
                model: ai.model,
                configured: agent.isConfigured(),
                historyCount: agent.getHistory().length,
                lastAnalysis: agent.getLastAnalysis(),
            }));
        });
        this.app.get('/api/ai/messages', (req, res) => {
            const limit = Math.min(parseInt(String(req.query.limit || '50')) || 50, 100);
            res.json((0, utils_1.jsonSafe)(this.bot.getAiAgent().getHistory(limit)));
        });
        this.app.post('/api/ai/chat', async (req, res) => {
            try {
                const message = String(req.body?.message || '').trim();
                if (!message)
                    return res.status(400).json({ success: false, error: 'message is required' });
                const reply = await this.bot.getAiAgent().chat(message);
                res.json((0, utils_1.jsonSafe)({ success: true, reply }));
            }
            catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });
        this.app.post('/api/ai/analyze', async (req, res) => {
            try {
                const analysis = await this.bot.getAiAgent().analyzeMarket();
                res.json((0, utils_1.jsonSafe)({ success: true, analysis }));
            }
            catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });
        this.app.post('/api/ai/apply', (req, res) => {
            try {
                const result = this.bot.getAiAgent().applyPatch(req.body || {});
                if (!result)
                    return res.status(400).json({ success: false, error: 'No valid settings sections in patch' });
                res.json((0, utils_1.jsonSafe)({ success: true, analysis: result }));
            }
            catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });
        this.app.delete('/api/ai/messages', (req, res) => {
            this.bot.getAiAgent().clearHistory();
            res.json({ success: true });
        });
        // ---------- Price oracle ----------
        this.app.get('/api/prices', async (req, res) => {
            try {
                res.json((0, utils_1.jsonSafe)(await this.bot.getOracle().getSnapshot()));
            }
            catch (err) {
                res.status(500).json({ error: err.message });
            }
        });
        // ---------- Meta ----------
        this.app.get('/api/meta', (req, res) => {
            res.json({
                networkNames: SettingsStore_1.NETWORK_NAMES,
                dashboardPort: this.port,
                settingsVersion: this.store.getVersion(),
                publicDir: this.publicDir,
            });
        });
        // Catch-all: serve the React app for non-API routes
        this.app.use((req, res, next) => {
            if (req.path.startsWith('/api/')) {
                return next();
            }
            res.sendFile(path_1.default.join(this.publicDir, 'index.html'), (err) => {
                if (err && !res.headersSent) {
                    res.status(404).send('Dashboard build not found. Run: npm run build:web');
                }
            });
        });
    }
    async start() {
        return new Promise((resolve, reject) => {
            this.server = this.app.listen(this.port, '0.0.0.0', () => {
                logger_1.logger.info(`Web dashboard available at http://127.0.0.1:${this.port}`);
                resolve();
            }).on('error', (err) => {
                logger_1.logger.error('Web server error:', err);
                reject(err);
            });
        });
    }
    async stop() {
        return new Promise((resolve, reject) => {
            if (this.server) {
                this.server.close((err) => {
                    if (err) {
                        logger_1.logger.error('Error stopping web server:', err);
                        reject(err);
                    }
                    else {
                        logger_1.logger.info('Web dashboard stopped');
                        resolve();
                    }
                });
            }
            else {
                logger_1.logger.info('Web dashboard stopped');
                resolve();
            }
        });
    }
}
exports.WebServer = WebServer;
