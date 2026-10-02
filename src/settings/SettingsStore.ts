import fs from 'fs';
import path from 'path';
import { NETWORKS, SETTINGS } from '../config';
import { logger } from '../logger';

export interface DexProtocolConfig {
  id: string;
  name: string;
  type: string; // implementation key: uniswapv2 | uniswapv3 | pancakeswap | quickswap | sushiswap | aerodrome | velodrome | traderjoe
  factory: string;
  router: string;
  enabled: boolean;
}

export interface AggregatorConfig {
  id: string;
  name: string;
  type: 'openocean' | 'oneinch' | 'paraswap' | 'custom';
  apiBaseUrl: string;
  apiKey: string;
  enabled: boolean;
}

export interface NetworkConfig {
  enabled: boolean;
  rpcUrl: string;
  mempoolRpcUrl: string;
  pollIntervalMs: number;
  gasPriceGwei: number; // 0 = auto
  tokens: string[];
  dexes: DexProtocolConfig[];
  aggregators: AggregatorConfig[];
}

export interface OracleConfig {
  provider: 'defillama' | 'coingecko' | 'custom';
  apiBaseUrl: string; // for custom (coingecko-compatible endpoint)
  apiKey: string;
  cacheTtlSec: number;
}

export interface AiConfig {
  provider: 'demo' | 'openai' | 'openrouter' | 'anthropic' | 'custom';
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  autoApplyRecommendations: boolean;
  analysisIntervalMin: number; // 0 = manual analysis only
  // Master switch: when enabled the AI agent may autonomously change settings
  // (auto-apply recommendations, even if autoApplyRecommendations is off) and
  // the bot trades automatically on profitable opportunities it finds.
  autonomousTrading: boolean;
}

// ---------- Wallets (multi-wallet management) ----------
export type WalletType = 'generated' | 'imported' | 'metamask';

// Per-wallet settings overrides. null / missing scalar = inherit from global trading settings.
export interface WalletSettings {
  tradeAmountNative: number | null;
  tradeAmountUsd: number | null;
  stableTokenAmount: number | null;
  minProfitUsd: number | null;
  maxSlippagePct: number | null;
  gasPriceGwei: number | null;
  gasLimit: number | null;
  deadlineSec: number | null;
  allowedNetworks: string[]; // empty = all enabled networks
  dryRunOnly: boolean; // this wallet only simulates, never sends real tx
}

export interface WalletEntry {
  id: string;
  label: string;
  type: WalletType;
  address: string;
  privateKey: string;
  seedPhrase: string;
  enabled: boolean;
  createdAt: string;
  settings: WalletSettings;
}

export interface WalletsConfig {
  activeId: string; // wallet used for trading
  list: WalletEntry[];
}

export function defaultWalletSettings(): WalletSettings {
  return {
    tradeAmountNative: null,
    tradeAmountUsd: null,
    stableTokenAmount: null,
    minProfitUsd: null,
    maxSlippagePct: null,
    gasPriceGwei: null,
    gasLimit: null,
    deadlineSec: null,
    allowedNetworks: [],
    dryRunOnly: false,
  };
}

// Scalar trading fields a wallet may override
const WALLET_OVERRIDE_FIELDS: Array<keyof TradingConfig> = [
  'tradeAmountNative',
  'tradeAmountUsd',
  'stableTokenAmount',
  'minProfitUsd',
  'maxSlippagePct',
  'gasPriceGwei',
  'gasLimit',
  'deadlineSec',
];

export interface TradingConfig {
  tradeAmountNative: number;
  tradeAmountUsd: number;
  stableTokenAmount: number;
  stableDecimals: number;
  minProfitUsd: number;
  maxSlippagePct: number;
  maxPathLength: number;
  gasPriceGwei: number;
  gasLimit: number;
  deadlineSec: number;
  loopIntervalMs: number;
  scanMode: 'mempool' | 'pools' | 'both';
  maxPairsPerScan: number;
  maxPendingTxPerNetwork: number;
}

export interface FeaturesConfig {
  enableMempoolMonitor: boolean;
  enableCrosschain: boolean;
  enableFlashLoans: boolean;
  enablePerpArb: boolean;
  enableConcentratedLiquidity: boolean;
  dryRun: boolean;
}

export interface FlashLoanConfig {
  provider: 'aave' | 'balancer' | 'dodo' | 'none';
  maxAmountUsd: number;
  feeBps: number;
  autoRepay: boolean;
}

export interface RiskConfig {
  emergencyPause: boolean;
  honeypotCheck: boolean;
  minLiquidityUsd: number;
  maxDailyLossUsd: number;
  maxConsecutiveFailures: number;
  maxOpenPositions: number;
  maxGasPriceGwei: number;
  maxTradeAmountUsd: number;
  takeProfitUsd: number;
  stopLossUsd: number;
  killSwitchDrawdownPct: number;
  cooldownAfterFailureSec: number;
  blacklistTokens: string[];
}

export interface BotSettings {
  trading: TradingConfig;
  features: FeaturesConfig;
  flashloan: FlashLoanConfig;
  risk: RiskConfig;
  oracle: OracleConfig;
  ai: AiConfig;
  wallets: WalletsConfig;
  networks: Record<string, NetworkConfig>;
}

const NETWORK_META: Record<string, { name: string; native: string }> = {
  ethereum: { name: 'Ethereum', native: 'ETH' },
  base: { name: 'Base', native: 'ETH' },
  bsc: { name: 'BSC', native: 'BNB' },
  solana: { name: 'Solana', native: 'SOL' },
  arbitrum: { name: 'Arbitrum', native: 'ETH' },
  avalanche: { name: 'Avalanche', native: 'AVAX' },
  optimism: { name: 'Optimism', native: 'ETH' },
  polygon: { name: 'Polygon', native: 'MATIC' },
};

// Well-known token addresses used as default watch lists
const DEFAULT_TOKENS: Record<string, string[]> = {
  ethereum: [
    '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
    '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
  ],
  base: [
    '0x4200000000000000000000000000000000000006', // WETH
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
  ],
  bsc: [
    '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
    '0x55d398326f99059fF775485246999027B3197955', // USDT
    '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', // BUSD
  ],
  arbitrum: [
    '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
    '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
  ],
  avalanche: [
    '0xB31f66AA3C1e785363F0875A1B74E27b85FD9c63', // WAVAX
    '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', // USDC
    '0x970229A8A518b4Ede774191BFadE9e3414391742', // USDT.e
  ],
  optimism: [
    '0x4200000000000000000000000000000000000006', // WETH
    '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', // USDC
  ],
  polygon: [
    '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270', // WMATIC
    '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // USDC
    '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // USDT
  ],
  solana: ['So11111111111111111111111111111111111111112'],
};

// Map legacy config keys (xxxFactory/xxxRouter) to protocol entries
const FACTORY_KEY_TO_TYPE: Record<string, string> = {
  uniswapV2: 'uniswapv2',
  uniswapV3: 'uniswapv3',
  pancakeSwapV2: 'pancakeswap',
  aerodrome: 'aerodrome',
  traderJoeV2: 'traderjoe',
  velocity: 'velodrome',
  quickswapV2: 'quickswap',
  sushi: 'sushiswap',
};

const TYPE_TO_NAME: Record<string, string> = {
  uniswapv2: 'Uniswap V2',
  uniswapv3: 'Uniswap V3',
  pancakeswap: 'PancakeSwap V2',
  aerodrome: 'Aerodrome',
  traderjoe: 'TraderJoe',
  velodrome: 'Velodrome',
  quickswap: 'QuickSwap',
  sushiswap: 'SushiSwap',
};

// OpenOcean v3 chain slugs
const OPENOCEAN_SLUGS: Record<string, string> = {
  ethereum: 'eth',
  base: 'base',
  bsc: 'bsc',
  arbitrum: 'arbitrum',
  avalanche: 'avax',
  optimism: 'optimism',
  polygon: 'polygon',
};

function defaultAggregators(networkKey: string): AggregatorConfig[] {
  const list: AggregatorConfig[] = [];
  const chainId = CHAIN_IDS_DEFAULT[networkKey];
  if (chainId) {
    list.push({
      id: 'paraswap',
      name: 'ParaSwap',
      type: 'paraswap',
      apiBaseUrl: 'https://api.paraswap.io',
      apiKey: '',
      enabled: true,
    });
  }
  return list;
}

// Chain ids for aggregator APIs
const CHAIN_IDS_DEFAULT: Record<string, number> = {
  ethereum: 1,
  bsc: 56,
  polygon: 137,
  arbitrum: 42161,
  avalanche: 43114,
  optimism: 10,
  base: 8453,
};

function isEvmAddress(a: unknown): a is string {
  return typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
}

function dexesFromLegacyConfig(networkKey: string): DexProtocolConfig[] {
  const cfg = NETWORKS[networkKey as keyof typeof NETWORKS] as unknown as Record<string, string>;
  if (!cfg) return [];
  const dexes: DexProtocolConfig[] = [];
  for (const [key, value] of Object.entries(cfg)) {
    if (!key.endsWith('Factory') || !isEvmAddress(value)) continue;
    const prefix = key.slice(0, -'Factory'.length);
    const type = FACTORY_KEY_TO_TYPE[prefix];
    if (!type) continue;
    const router = cfg[`${prefix}Router`];
    dexes.push({
      id: type,
      name: TYPE_TO_NAME[type] || type,
      type,
      factory: value,
      router: isEvmAddress(router) ? router : '',
      enabled: true,
    });
  }
  return dexes;
}

export function buildDefaultSettings(): BotSettings {
  const networks: Record<string, NetworkConfig> = {};
  for (const key of Object.keys(NETWORKS)) {
    const cfg = NETWORKS[key as keyof typeof NETWORKS];
    networks[key] = {
      enabled: true,
      rpcUrl: cfg.rpcUrl,
      mempoolRpcUrl: cfg.rpcUrl,
      pollIntervalMs: 2000,
      gasPriceGwei: 0,
      tokens: DEFAULT_TOKENS[key] || [],
      dexes: dexesFromLegacyConfig(key),
      aggregators: defaultAggregators(key),
    };
  }

  return {
    trading: {
      tradeAmountNative: 0.5,
      tradeAmountUsd: 500,
      stableTokenAmount: 500,
      stableDecimals: 6,
      minProfitUsd: SETTINGS.minProfitUsd,
      maxSlippagePct: SETTINGS.maxSlippage * 100,
      maxPathLength: SETTINGS.maxPathLength,
      gasPriceGwei: SETTINGS.gasPriceGwei,
      gasLimit: 300000,
      deadlineSec: 300,
      loopIntervalMs: 5000,
      scanMode: 'both',
      maxPairsPerScan: 8,
      maxPendingTxPerNetwork: 1000,
    },
    features: {
      enableMempoolMonitor: true,
      enableCrosschain: SETTINGS.enableCrosschain,
      enableFlashLoans: SETTINGS.enableFlashLoans,
      enablePerpArb: SETTINGS.enablePerpArb,
      enableConcentratedLiquidity: SETTINGS.enableConcentratedLiquidity,
      dryRun: true,
    },
    flashloan: {
      provider: 'aave',
      maxAmountUsd: 10000,
      feeBps: 9,
      autoRepay: true,
    },
    risk: {
      emergencyPause: false,
      honeypotCheck: true,
      minLiquidityUsd: SETTINGS.minLiquidityUsd,
      maxDailyLossUsd: 100,
      maxConsecutiveFailures: 3,
      maxOpenPositions: 3,
      maxGasPriceGwei: 200,
      maxTradeAmountUsd: 1000,
      takeProfitUsd: SETTINGS.takeProfitUsd,
      stopLossUsd: SETTINGS.stopLossUsd,
      killSwitchDrawdownPct: 20,
      cooldownAfterFailureSec: 60,
      blacklistTokens: [],
    },
    networks,
    wallets: {
      activeId: '',
      list: [],
    },
    oracle: {
      provider: 'defillama',
      apiBaseUrl: 'https://coins.llama.fi',
      apiKey: '',
      cacheTtlSec: 60,
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

export const NETWORK_NAMES = NETWORK_META;

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

  /**
   * Settings as seen by the trading engine: global trading config merged with
   * the active wallet's per-wallet overrides (minProfitUsd, amounts, gas, ...).
   */
  public getEffective(): BotSettings {
    const base: BotSettings = JSON.parse(JSON.stringify(this.settings));
    const wallet = this.getActiveWallet();
    if (wallet && wallet.enabled && wallet.settings) {
      const trading = base.trading as unknown as Record<string, unknown>;
      const overrides = wallet.settings as unknown as Record<string, unknown>;
      for (const field of WALLET_OVERRIDE_FIELDS) {
        const v = overrides[field];
        if (v !== null && v !== undefined && String(v) !== '') {
          const num = Number(v);
          if (Number.isFinite(num)) trading[field] = num;
        }
      }
    }
    return base;
  }

  // ---------- Wallet management ----------

  public getWallets(): WalletsConfig {
    return this.settings.wallets || { activeId: '', list: [] };
  }

  public getActiveWallet(): WalletEntry | null {
    const cfg = this.getWallets();
    return cfg.list.find(w => w.id === cfg.activeId) || null;
  }

  private sanitizeWalletSettings(input: unknown): WalletSettings {
    const base = defaultWalletSettings();
    if (!input || typeof input !== 'object') return base;
    const raw = input as Record<string, unknown>;
    for (const field of WALLET_OVERRIDE_FIELDS) {
      const v = raw[field];
      if (v === null || v === undefined || v === ('' as unknown)) {
        (base as unknown as Record<string, unknown>)[field] = null;
      } else {
        const num = Number(v);
        if (Number.isFinite(num)) (base as unknown as Record<string, unknown>)[field] = num;
      }
    }
    if (Array.isArray(raw.allowedNetworks)) {
      base.allowedNetworks = raw.allowedNetworks.map(String).filter(k => k.length > 0);
    }
    base.dryRunOnly = raw.dryRunOnly === true;
    return base;
  }

  public addWallet(input: Partial<WalletEntry>): WalletEntry {
    const cfg = this.settings.wallets || (this.settings.wallets = { activeId: '', list: [] });
    const id = `wallet-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const label = String(input.label || '').trim().slice(0, 60) || `Wallet ${cfg.list.length + 1}`;
    const type: WalletType = input.type === 'generated' || input.type === 'metamask' ? input.type : 'imported';
    const entry: WalletEntry = {
      id,
      label,
      type,
      address: String(input.address || '').trim().toLowerCase(),
      privateKey: String(input.privateKey || '').trim(),
      seedPhrase: String(input.seedPhrase || '').trim(),
      enabled: input.enabled !== false,
      createdAt: new Date().toISOString(),
      settings: this.sanitizeWalletSettings(input.settings),
    };
    cfg.list.push(entry);
    if (!cfg.activeId && entry.enabled) cfg.activeId = entry.id;
    this.persist();
    logger.info(`Wallet added: ${entry.label} (${entry.id}, type=${entry.type})`);
    return entry;
  }

  public updateWallet(id: string, patch: Partial<WalletEntry>): WalletEntry | null {
    const cfg = this.getWallets();
    const entry = cfg.list.find(w => w.id === id);
    if (!entry) return null;
    if (patch.label !== undefined) entry.label = String(patch.label).trim().slice(0, 60) || entry.label;
    if (patch.type !== undefined && (patch.type === 'generated' || patch.type === 'imported' || patch.type === 'metamask')) {
      entry.type = patch.type;
    }
    if (patch.address !== undefined) entry.address = String(patch.address).trim().toLowerCase();
    if (patch.privateKey !== undefined) entry.privateKey = String(patch.privateKey).trim();
    if (patch.seedPhrase !== undefined) entry.seedPhrase = String(patch.seedPhrase).trim();
    if (patch.enabled !== undefined) entry.enabled = patch.enabled === true;
    if (patch.settings !== undefined) {
      const merged = { ...entry.settings, ...(patch.settings as unknown as Record<string, unknown>) } as unknown;
      entry.settings = this.sanitizeWalletSettings(merged);
    }
    this.persist();
    logger.info(`Wallet updated: ${entry.label} (${entry.id})`);
    return entry;
  }

  public removeWallet(id: string): boolean {
    const cfg = this.settings.wallets;
    if (!cfg) return false;
    const idx = cfg.list.findIndex(w => w.id === id);
    if (idx === -1) return false;
    const [removed] = cfg.list.splice(idx, 1);
    if (cfg.activeId === id) {
      cfg.activeId = cfg.list.find(w => w.enabled)?.id || '';
    }
    this.persist();
    logger.info(`Wallet removed: ${removed.label} (${id})`);
    return true;
  }

  public setActiveWallet(id: string): WalletEntry | null {
    const cfg = this.getWallets();
    const entry = cfg.list.find(w => w.id === id);
    if (!entry) return null;
    cfg.activeId = id;
    this.persist();
    logger.info(`Active wallet set: ${entry.label} (${id})`);
    return entry;
  }

  public getVersion(): number {
    return this.version;
  }

  public update(patch: Record<string, unknown>): BotSettings {
    this.settings = this.merge(this.settings, patch) as BotSettings;
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

  // Bump version, write to disk and notify listeners (used by direct mutations, e.g. wallets)
  private persist(): void {
    this.version++;
    this.save();
    this.notify();
  }

  public onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) {
      try { l(); } catch (err) { logger.warn('Settings listener failed:', err); }
    }
  }
}