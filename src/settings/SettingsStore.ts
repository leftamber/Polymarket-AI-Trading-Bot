import fs from 'fs';
import path from 'path';
import { logger } from '../logger';

export type BotMode = 'arb' | 'btc15' | 'both';
export type AiProvider = 'demo' | 'openai' | 'openrouter' | 'anthropic' | 'custom';

export interface TradingSettings {
  /** arb = bundle arbitrage + market making, btc15 = BTC short-term signal markets */
  mode: BotMode;
  loopIntervalMs: number;
  marketsRefreshMs: number;
  bookRefreshMs: number;
  maxMarketsScanned: number;
  /** minimum NET arbitrage edge, percent (1 = 1%) */
  minEdgePct: number;
  orderSizeUsd: number;
  minOrderSizeUsd: number;
  maxOrderSizeUsd: number;
  slippageTolerancePct: number;
  orderTimeoutSec: number;
  takerFeeBps: number;
  makerFeeBps: number;
  gasCostPerOrderUsd: number;
  signalExpirySec: number;
  /** market making */
  minSpreadCents: number;
  tickSizeCents: number;
  /** BTC 15m signal strategy */
  btcTradeAmountUsd: number;
  spikeThresholdPct: number;
  divergenceThresholdPct: number;
  spikeWindowSec: number;
  decisionThreshold: number;
  signalWeights: { spike: number; divergence: number; momentum: number };
  /** default asset for signal markets */
  btcAsset: 'BTC' | 'ETH' | 'SOL' | 'XRP';
}

export interface FeaturesSettings {
  dryRun: boolean;
  enableBundleArb: boolean;
  enableMarketMaking: boolean;
  enableBtcSignals: boolean;
  enableFillSimulation: boolean;
}

export interface RiskSettings {
  maxPositionPerMarketUsd: number;
  maxGlobalExposureUsd: number;
  maxDailyLossUsd: number;
  maxDrawdownPct: number;
  min24hVolumeUsd: number;
  tradeOnlyHighVolume: boolean;
  whitelist: string[];
  blacklist: string[];
  killSwitchEnabled: boolean;
  maxConsecutiveFailures: number;
  cooldownAfterFailureSec: number;
  emergencyPause: boolean;
}

export interface PolymarketSettings {
  gammaApiUrl: string;
  clobApiUrl: string;
  dataApiUrl: string;
  chainId: number;
  /** wallet private key for LIVE order signing (empty = read-only/dry-run only) */
  privateKey: string;
  /** optional proxy/funder address Polymarket UI wallets trade through */
  funderAddress: string;
  /** 0 = EOA, 1 = email/proxy wallet, 2 = gnosis safe */
  signatureType: number;
  /** optional manual L2 credentials; derived from privateKey automatically when empty */
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  dryRunInitialBalanceUsd: number;
  fillProbability: number;
  /** paper fill fee in basis points */
  paperFillFeeBps: number;
}

export interface AiSettings {
  provider: AiProvider;
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  autoApplyRecommendations: boolean;
  analysisIntervalMin: number;
  autonomousTrading: boolean;
}

export interface BotSettings {
  trading: TradingSettings;
  features: FeaturesSettings;
  risk: RiskSettings;
  polymarket: PolymarketSettings;
  ai: AiSettings;
}

function buildDefaultSettings(): BotSettings {
  return {
    trading: {
      mode: 'both',
      loopIntervalMs: 5000,
      marketsRefreshMs: 60000,
      bookRefreshMs: 10000,
      maxMarketsScanned: 500,
      minEdgePct: 1,
      orderSizeUsd: 5,
      minOrderSizeUsd: 2,
      maxOrderSizeUsd: 10,
      slippageTolerancePct: 2,
      orderTimeoutSec: 60,
      takerFeeBps: 150,
      makerFeeBps: 0,
      gasCostPerOrderUsd: 0.02,
      signalExpirySec: 5,
      minSpreadCents: 5,
      tickSizeCents: 1,
      btcTradeAmountUsd: 1,
      spikeThresholdPct: 0.15,
      divergenceThresholdPct: 5,
      spikeWindowSec: 60,
      decisionThreshold: 0.5,
      signalWeights: { spike: 0.5, divergence: 0.3, momentum: 0.2 },
      btcAsset: 'BTC',
    },
    features: {
      dryRun: true,
      enableBundleArb: true,
      enableMarketMaking: false,
      enableBtcSignals: true,
      enableFillSimulation: true,
    },
    risk: {
      maxPositionPerMarketUsd: 15,
      maxGlobalExposureUsd: 50,
      maxDailyLossUsd: 10,
      maxDrawdownPct: 15,
      min24hVolumeUsd: 10000,
      tradeOnlyHighVolume: false,
      whitelist: [],
      blacklist: [],
      killSwitchEnabled: true,
      maxConsecutiveFailures: 3,
      cooldownAfterFailureSec: 60,
      emergencyPause: false,
    },
    polymarket: {
      gammaApiUrl: 'https://gamma-api.polymarket.com',
      clobApiUrl: 'https://clob.polymarket.com',
      dataApiUrl: 'https://data-api.polymarket.com',
      chainId: 137,
      privateKey: '',
      funderAddress: '',
      signatureType: 0,
      apiKey: '',
      apiSecret: '',
      apiPassphrase: '',
      dryRunInitialBalanceUsd: 10000,
      fillProbability: 0.8,
      paperFillFeeBps: 150,
    },
    ai: {
      provider: 'demo',
      apiBaseUrl: '',
      apiKey: '',
      model: 'gpt-4o-mini',
      temperature: 0.3,
      maxTokens: 1200,
      autoApplyRecommendations: false,
      analysisIntervalMin: 0,
      autonomousTrading: false,
    },
  };
}

const ALLOWED_PATCH_SECTIONS = ['trading', 'features', 'risk', 'polymarket', 'ai'];

export class SettingsStore {
  private settings: BotSettings;
  private version: number = 0;
  private listeners: Set<() => void> = new Set();
  private filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(process.cwd(), 'data', 'settings.json');
    this.settings = this.load();
  }

  private load(): BotSettings {
    const defaults = buildDefaultSettings();
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        return this.merge(defaults, raw) as BotSettings;
      }
    } catch (err) {
      logger.warn('Failed to load settings file, using defaults:', err);
    }
    return defaults;
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2));
    } catch (err) {
      logger.error('Failed to save settings:', err);
    }
  }

  private merge(base: any, patch: any): any {
    if (Array.isArray(patch) || patch === null || typeof patch !== 'object') {
      return patch;
    }
    if (Array.isArray(base) || base === null || typeof base !== 'object') {
      return JSON.parse(JSON.stringify(patch));
    }
    const out: any = { ...base };
    for (const key of Object.keys(patch)) {
      out[key] = this.merge(base[key], patch[key]);
    }
    return out;
  }

  public get(): BotSettings {
    return this.settings;
  }

  public getVersion(): number {
    return this.version;
  }

  public update(patch: Record<string, unknown>): BotSettings {
    const clean: Record<string, unknown> = {};
    for (const section of ALLOWED_PATCH_SECTIONS) {
      const val = (patch as Record<string, unknown>)[section];
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        clean[section] = val;
      }
    }
    this.settings = this.merge(this.settings, clean) as BotSettings;
    this.persist();
    logger.info(`Settings updated (v${this.version})`);
    return this.settings;
  }

  public reset(): BotSettings {
    this.settings = buildDefaultSettings();
    this.persist();
    logger.info('Settings reset to defaults');
    return this.settings;
  }

  /** credentials are live-trading ready (private key present) */
  public hasLiveCredentials(): boolean {
    const pm = this.settings.polymarket;
    return !!pm.privateKey;
  }

  private persist(): void {
    this.version++;
    this.save();
    this.notify();
  }

  public onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    for (const l of this.listeners) {
      try { l(); } catch (err) { logger.warn('Settings listener failed:', err); }
    }
  }
}
