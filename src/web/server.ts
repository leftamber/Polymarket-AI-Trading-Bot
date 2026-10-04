import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { logger } from '../logger';
import { PolymarketBot } from '../index';
import { SettingsStore } from '../settings/SettingsStore';
import { jsonSafe } from '../utils';
import { DASHBOARD_PORT_DEFAULT } from '../config';

class WebServer {
  private app: express.Express;
  private port: number;
  private bot: PolymarketBot;
  private store: SettingsStore;
  private server: any;
  private publicDir: string;

  constructor(bot: PolymarketBot, store: SettingsStore, port: number = Number(process.env.DASHBOARD_PORT || DASHBOARD_PORT_DEFAULT)) {
    this.bot = bot;
    this.store = store;
    this.port = port;
    this.app = express();
    this.publicDir = WebServer.resolvePublicDir();

    this.setupMiddleware();
    this.setupStaticFiles();
    this.setupRoutes();
  }

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

    // ---------- Markets & portfolio ----------
    this.app.get('/api/markets', (req: Request, res: Response) => {
      res.json(jsonSafe({
        markets: this.bot.getMarketFeed().getMarketRows(),
        updatedAt: new Date().toISOString(),
      }));
    });

    this.app.get('/api/portfolio', (req: Request, res: Response) => {
      res.json(jsonSafe(this.bot.getPortfolio().getSafe()));
    });

    this.app.post('/api/portfolio/reset', (req: Request, res: Response) => {
      this.bot.getPortfolio().reset();
      res.json({ success: true });
    });

    // ---------- Signals & backtest ----------
    this.app.post('/api/signals/optimize', (req: Request, res: Response) => {
      try {
        const result = this.bot.optimizeSignalWeights();
        res.json(jsonSafe({ success: true, ...result }));
      } catch (err) {
        res.status(500).json({ success: false, error: (err as Error).message });
      }
    });

    this.app.post('/api/backtest/run', async (req: Request, res: Response) => {
      try {
        const durationSec = Math.min(3600, Math.max(10, Number(req.body?.durationSec) || 300));
        const markets = Math.min(10, Math.max(1, Number(req.body?.markets) || 3));
        const result = await this.bot.runBacktest(durationSec, markets);
        res.json(jsonSafe({ success: true, result }));
      } catch (err) {
        res.status(500).json({ success: false, error: (err as Error).message });
      }
    });

    this.app.get('/api/prices', async (req: Request, res: Response) => {
      try {
        const asset = String(req.query.asset || 'BTC').toUpperCase();
        const snap = await this.bot.getMarketData().getBtcSnapshot(asset);
        res.json(jsonSafe(snap || { error: 'price unavailable' }));
      } catch (err) {
        res.status(500).json({ error: (err as Error).message });
      }
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

    // ---------- Meta ----------
    this.app.get('/api/meta', (req: Request, res: Response) => {
      res.json({
        dashboardPort: this.port,
        settingsVersion: this.store.getVersion(),
        publicDir: this.publicDir,
        liveCredentials: this.store.hasLiveCredentials(),
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
