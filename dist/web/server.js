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
const logger_1 = require("../logger");
const utils_1 = require("../utils");
const config_1 = require("../config");
class WebServer {
    constructor(bot, store, port = Number(process.env.DASHBOARD_PORT || config_1.DASHBOARD_PORT_DEFAULT)) {
        this.bot = bot;
        this.store = store;
        this.port = port;
        this.app = (0, express_1.default)();
        this.publicDir = WebServer.resolvePublicDir();
        this.setupMiddleware();
        this.setupStaticFiles();
        this.setupRoutes();
    }
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
        // ---------- Markets & portfolio ----------
        this.app.get('/api/markets', (req, res) => {
            res.json((0, utils_1.jsonSafe)({
                markets: this.bot.getMarketFeed().getMarketRows(),
                updatedAt: new Date().toISOString(),
            }));
        });
        this.app.get('/api/portfolio', (req, res) => {
            res.json((0, utils_1.jsonSafe)(this.bot.getPortfolio().getSafe()));
        });
        this.app.post('/api/portfolio/reset', (req, res) => {
            this.bot.getPortfolio().reset();
            res.json({ success: true });
        });
        // ---------- Signals & backtest ----------
        this.app.post('/api/signals/optimize', (req, res) => {
            try {
                const result = this.bot.optimizeSignalWeights();
                res.json((0, utils_1.jsonSafe)({ success: true, ...result }));
            }
            catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });
        this.app.post('/api/backtest/run', async (req, res) => {
            try {
                const durationSec = Math.min(3600, Math.max(10, Number(req.body?.durationSec) || 300));
                const markets = Math.min(10, Math.max(1, Number(req.body?.markets) || 3));
                const result = await this.bot.runBacktest(durationSec, markets);
                res.json((0, utils_1.jsonSafe)({ success: true, result }));
            }
            catch (err) {
                res.status(500).json({ success: false, error: err.message });
            }
        });
        this.app.get('/api/prices', async (req, res) => {
            try {
                const asset = String(req.query.asset || 'BTC').toUpperCase();
                const snap = await this.bot.getMarketData().getBtcSnapshot(asset);
                res.json((0, utils_1.jsonSafe)(snap || { error: 'price unavailable' }));
            }
            catch (err) {
                res.status(500).json({ error: err.message });
            }
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
        // ---------- Meta ----------
        this.app.get('/api/meta', (req, res) => {
            res.json({
                dashboardPort: this.port,
                settingsVersion: this.store.getVersion(),
                publicDir: this.publicDir,
                liveCredentials: this.store.hasLiveCredentials(),
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
