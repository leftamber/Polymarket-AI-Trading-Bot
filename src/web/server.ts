import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { ethers } from 'ethers';
import { logger } from '../logger';
import { ArbAiBot } from '../index';
import { SettingsStore, NETWORK_NAMES } from '../settings/SettingsStore';
import { jsonSafe } from '../utils';

class WebServer {
  private app: express.Express;
  private port: number;
  private bot: ArbAiBot;
  private store: SettingsStore;
  private server: any; // Reference to the HTTP server
  private publicDir: string;

  constructor(bot: ArbAiBot, store: SettingsStore, port: number = Number(process.env.DASHBOARD_PORT || 4449)) {
    this.bot = bot;
    this.store = store;
    this.port = port;
    this.app = express();
    this.publicDir = WebServer.resolvePublicDir();

    this.setupMiddleware();
    this.setupStaticFiles();
    this.setupRoutes();
  }

  // The React dashboard is built into dist/web/public by vite
  private static resolvePublicDir(): string {
    const fs = require('fs');
    const candidates = [
      path.join(__dirname, 'public'),
      path.join(__dirname, '..', '..', 'webapp', 'dist'),
    ];
    return candidates.find((p) => fs.existsSync(p)) || candidates[0];
  }

  private setupMiddleware(): void {
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          'script-src': ["'self'"],
        },
      },
    }));
    this.app.use(cors());
    this.app.use(morgan('combined'));
    this.app.use(express.json({ limit: '2mb' }));
    this.app.use(express.urlencoded({ extended: true }));
  }

  private setupStaticFiles(): void {
    this.app.use(express.static(this.publicDir));
  }

  private setupRoutes(): void {
    // ---------- Bot control ----------
    this.app.post('/api/bot/start', async (req: Request, res: Response) => {
      try {
        await this.bot.startTrading();
        res.json({ success: true, status: this.bot.getIsRunning() ? 'running' : 'stopped' });
      } catch (err) {
        res.status(500).json({ success: false, error: (err as Error).message });
      }
    });

    this.app.post('/api/bot/stop', async (req: Request, res: Response) => {
      try {
        await this.bot.stopTrading();
        res.json({ success: true, status: this.bot.getIsRunning() ? 'running' : 'stopped' });
      } catch (err) {
        res.status(500).json({ success: false, error: (err as Error).message });
      }
    });

    // ---------- Status / stats / logs ----------
    this.app.get('/api/status', (req: Request, res: Response) => {
      res.json({
        status: this.bot.getIsRunning() ? 'running' : 'stopped',
        timestamp: new Date().toISOString(),
        dashboard: `http://127.0.0.1:${this.port}`,
      });
    });

    this.app.get('/api/stats', (req: Request, res: Response) => {
      res.json(jsonSafe(this.bot.getStats()));
    });

    this.app.get('/api/logs', (req: Request, res: Response) => {
      const limit = Math.min(parseInt(String(req.query.limit || '200')) || 200, 2000);
      const level = String(req.query.level || 'all');
      res.json(jsonSafe(this.bot.getLogs(limit, level)));
    });

    this.app.get('/api/opportunities', (req: Request, res: Response) => {
      res.json(jsonSafe(this.bot.getRecentOpportunities()));
    });

    // ---------- Settings ----------
    this.app.get('/api/settings', (req: Request, res: Response) => {
      res.json(this.store.get());
    });

    this.app.put('/api/settings', (req: Request, res: Response) => {
      try {
        if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
          return res.status(400).json({ success: false, error: 'Invalid settings payload' });
        }
        const updated = this.store.update(req.body);
        res.json({ success: true, settings: updated, version: this.store.getVersion() });
      } catch (err) {
        res.status(500).json({ success: false, error: (err as Error).message });
      }
    });

    this.app.post('/api/settings/reset', (req: Request, res: Response) => {
      const updated = this.store.reset();
      res.json({ success: true, settings: updated });
    });

    // ---------- Wallets (multi-wallet management) ----------
    this.app.get('/api/wallets', (req: Request, res: Response) => {
      res.json(jsonSafe(this.store.getWallets()));
    });

    // Generate a fresh wallet (address + private key + seed phrase) — returned
    // only, not stored; the dashboard modal lets the operator keep it.
    this.app.post('/api/wallets/generate', (req: Request, res: Response) => {
      try {
        const w = ethers.Wallet.createRandom();
        res.json({
          address: w.address,
          privateKey: w.privateKey,
          mnemonic: w.mnemonic?.phrase || '',
        });
      } catch (err) {
        res.status(500).json({ success: false, error: (err as Error).message });
      }
    });

    this.app.post('/api/wallets', (req: Request, res: Response) => {
      try {
        const body = req.body || {};
        const entry = this.store.addWallet(body);
        res.json({ success: true, wallet: jsonSafe(entry), wallets: jsonSafe(this.store.getWallets()) });
      } catch (err) {
        res.status(500).json({ success: false, error: (err as Error).message });
      }
    });

    this.app.put('/api/wallets/:id', (req: Request, res: Response) => {
      try {
        const entry = this.store.updateWallet(String(req.params.id), req.body || {});
        if (!entry) return res.status(404).json({ success: false, error: `Wallet ${req.params.id} not found` });
        res.json({ success: true, wallet: jsonSafe(entry), wallets: jsonSafe(this.store.getWallets()) });
      } catch (err) {
        res.status(500).json({ success: false, error: (err as Error).message });
      }
    });

    this.app.delete('/api/wallets/:id', (req: Request, res: Response) => {
      const ok = this.store.removeWallet(String(req.params.id));
      if (!ok) return res.status(404).json({ success: false, error: `Wallet ${req.params.id} not found` });
      res.json({ success: true, wallets: jsonSafe(this.store.getWallets()) });
    });

    this.app.post('/api/wallets/:id/activate', (req: Request, res: Response) => {
      const entry = this.store.setActiveWallet(String(req.params.id));
      if (!entry) return res.status(404).json({ success: false, error: `Wallet ${req.params.id} not found` });
      res.json({ success: true, wallet: jsonSafe(entry), wallets: jsonSafe(this.store.getWallets()) });
    });

    // ---------- Networks & protocols ----------
    this.app.get('/api/networks', (req: Request, res: Response) => {
      const settings = this.store.get();
      res.json(Object.entries(settings.networks).map(([key, cfg]) => ({
        key,
        name: NETWORK_NAMES[key]?.name || key,
        native: NETWORK_NAMES[key]?.native || '',
        ...cfg,
      })));
    });

    this.app.post('/api/networks/:network/dexes', (req: Request, res: Response) => {
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
      logger.info(`Protocol ${dex.id} added to ${network}`);
      res.json({ success: true, dexes: this.store.get().networks[network].dexes });
    });

    this.app.put('/api/networks/:network/dexes/:dexId', (req: Request, res: Response) => {
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

    this.app.delete('/api/networks/:network/dexes/:dexId', (req: Request, res: Response) => {
      const network = String(req.params.network);
      const dexId = String(req.params.dexId);
      const netCfg = this.store.get().networks[network];
      if (!netCfg) {
        return res.status(404).json({ success: false, error: `Network ${network} not found` });
      }
      const dexes = netCfg.dexes.filter((d) => d.id !== dexId);
      this.store.update({ networks: { [network]: { dexes } } });
      logger.info(`Protocol ${dexId} removed from ${network}`);
      res.json({ success: true, dexes: this.store.get().networks[network].dexes });
    });

    // ---------- AI agent ----------
    this.app.get('/api/ai/status', (req: Request, res: Response) => {
      const agent = this.bot.getAiAgent();
      const ai = this.store.get().ai;
      res.json(jsonSafe({
        provider: ai.provider,
        model: ai.model,
        configured: agent.isConfigured(),
        historyCount: agent.getHistory().length,
        lastAnalysis: agent.getLastAnalysis(),
      }));
    });

    this.app.get('/api/ai/messages', (req: Request, res: Response) => {
      const limit = Math.min(parseInt(String(req.query.limit || '50')) || 50, 100);
      res.json(jsonSafe(this.bot.getAiAgent().getHistory(limit)));
    });

    this.app.post('/api/ai/chat', async (req: Request, res: Response) => {
      try {
        const message = String(req.body?.message || '').trim();
        if (!message) return res.status(400).json({ success: false, error: 'message is required' });
        const reply = await this.bot.getAiAgent().chat(message);
        res.json(jsonSafe({ success: true, reply }));
      } catch (err) {
        res.status(500).json({ success: false, error: (err as Error).message });
      }
    });

    this.app.post('/api/ai/analyze', async (req: Request, res: Response) => {
      try {
        const analysis = await this.bot.getAiAgent().analyzeMarket();
        res.json(jsonSafe({ success: true, analysis }));
      } catch (err) {
        res.status(500).json({ success: false, error: (err as Error).message });
      }
    });

    this.app.post('/api/ai/apply', (req: Request, res: Response) => {
      try {
        const result = this.bot.getAiAgent().applyPatch(req.body || {});
        if (!result) return res.status(400).json({ success: false, error: 'No valid settings sections in patch' });
        res.json(jsonSafe({ success: true, analysis: result }));
      } catch (err) {
        res.status(500).json({ success: false, error: (err as Error).message });
      }
    });

    this.app.delete('/api/ai/messages', (req: Request, res: Response) => {
      this.bot.getAiAgent().clearHistory();
      res.json({ success: true });
    });

    // ---------- Price oracle ----------
    this.app.get('/api/prices', async (req: Request, res: Response) => {
      try {
        res.json(jsonSafe(await this.bot.getOracle().getSnapshot()));
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
    });

    // ---------- Meta ----------
    this.app.get('/api/meta', (req: Request, res: Response) => {
      res.json({
        networkNames: NETWORK_NAMES,
        dashboardPort: this.port,
        settingsVersion: this.store.getVersion(),
        publicDir: this.publicDir,
      });
    });

    // Catch-all: serve the React app for non-API routes
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api/')) {
        return next();
      }
      res.sendFile(path.join(this.publicDir, 'index.html'), (err) => {
        if (err && !res.headersSent) {
          res.status(404).send('Dashboard build not found. Run: npm run build:web');
        }
      });
    });
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, '0.0.0.0', () => {
        logger.info(`Web dashboard available at http://127.0.0.1:${this.port}`);
        resolve();
      }).on('error', (err: Error) => {
        logger.error('Web server error:', err);
        reject(err);
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err: any) => {
          if (err) {
            logger.error('Error stopping web server:', err);
            reject(err);
          } else {
            logger.info('Web dashboard stopped');
            resolve();
          }
        });
      } else {
        logger.info('Web dashboard stopped');
        resolve();
      }
    });
  }
}

export { WebServer };