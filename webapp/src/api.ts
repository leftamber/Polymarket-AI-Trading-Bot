export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: any;
}

export interface Opportunity {
  type: string;
  source?: string;
  network?: string;
  dexIn?: string;
  dexOut?: string;
  tokenIn?: string;
  tokenOut?: string;
  inputAmount?: string;
  inputUsd?: number;
  profitPct?: number;
  profitEstimate?: number;
  confidence?: number;
  timestamp: string;
  details?: any;
}

export interface Stats {
  status: string;
  uptimeSec: number;
  totalProfit: number;
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  successRate: number;
  opportunitiesFound: number;
  roiPct: number;
  dailyPnl: number;
  dryRun: boolean;
  walletBalances: Record<string, string>;
  profitHistory: Array<{ t: number; profit: number; balance: number }>;
  networksEnabled: string[];
  riskStats: { consecutiveFailures: number; emergencyPaused: boolean; tradesTracked: number };
}

export interface DexProtocol {
  id: string;
  name: string;
  type: string;
  factory: string;
  router: string;
  enabled: boolean;
}

export interface Aggregator {
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
  gasPriceGwei: number;
  tokens: string[];
  dexes: DexProtocol[];
  aggregators: Aggregator[];
}

export type WalletType = 'generated' | 'imported' | 'metamask';

// null = inherit the value from global Trading settings
export interface WalletSettings {
  tradeAmountNative: number | null;
  tradeAmountUsd: number | null;
  stableTokenAmount: number | null;
  minProfitUsd: number | null;
  maxSlippagePct: number | null;
  gasPriceGwei: number | null;
  gasLimit: number | null;
  deadlineSec: number | null;
  allowedNetworks: string[];
  dryRunOnly: boolean;
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
  activeId: string;
  list: WalletEntry[];
}

export interface BotSettings {
  trading: Record<string, any>;
  features: Record<string, boolean>;
  flashloan: Record<string, any>;
  risk: Record<string, any>;
  oracle: Record<string, any>;
  ai: Record<string, any>;
  wallets: WalletsConfig;
  networks: Record<string, NetworkConfig>;
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  ts: string;
  meta?: { kind?: string; recommendations?: AiRecommendation[]; patch?: any };
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

export interface AiStatus {
  provider: string;
  model: string;
  configured: boolean;
  historyCount: number;
  lastAnalysis: AiAnalysis | null;
}

export interface PriceSnapshot {
  network: string;
  token: string;
  price: number;
}

export const KNOWN_TOKENS: Record<string, string> = {
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 'WETH',
  '0x4200000000000000000000000000000000000006': 'WETH',
  '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 'WETH',
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c': 'WBNB',
  '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270': 'WMATIC',
  '0xb31f66aa3c1e785363f0875a1b74e27b85fd9c63': 'WAVAX',
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 'USDC',
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
  '0xaf88d065e77c8cc2239327c5edb3a432268e5831': 'USDC',
  '0x0b2c639c533813f4aa9d7837caf62653d097ff85': 'USDC',
  '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e': 'USDC',
  '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': 'USDC',
  '0xdac17f958d2ee523a2206206994597c13d831ec7': 'USDT',
  '0x55d398326f99059ff775485246999027b3197955': 'USDT',
  '0xe9e7cea3dedca5984780bafc599bd69add087d56': 'BUSD',
  '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9': 'USDT',
  '0x970229a8a518b4ede774191bfade9e3414391742': 'USDT.e',
  '0xc2132d05d31c914a87c6611c10748aeb04b58e8f': 'USDT',
};

export function tokenSymbol(address?: string): string {
  if (!address) return '?';
  const known = KNOWN_TOKENS[address.toLowerCase()];
  if (known) return known;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}