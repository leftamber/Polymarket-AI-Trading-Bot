export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: any;
}

export type OpportunityType = 'bundle-long' | 'bundle-short' | 'market-making' | 'btc-signal';

export interface Opportunity {
  id: string;
  type: OpportunityType;
  marketId: string;
  question: string;
  edgePct: number;
  profitUsd: number;
  sizeShares: number;
  orderUsd: number;
  yesAsk?: number | null;
  yesBid?: number | null;
  noAsk?: number | null;
  noBid?: number | null;
  side?: 'YES' | 'NO';
  score?: number;
  reason?: string;
  timestamp: string;
}

export interface RiskStats {
  consecutiveFailures: number;
  emergencyPaused: boolean;
  killSwitchTriggered: boolean;
  killSwitchReason: string;
  tradesTracked: number;
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
  mode: string;
  cashBalance: number;
  exposureUsd: number;
  marketsMonitored: number;
  liveCredentials: boolean;
  profitHistory: Array<{ t: number; profit: number; balance: number }>;
  riskStats: RiskStats;
}

export interface MarketRow {
  id: string;
  question: string;
  volume24h: number;
  liquidity: number;
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  bundleAsk: number | null;
  bundleBid: number | null;
  edgeLongPct: number | null;
  edgeShortPct: number | null;
  spreadYes: number | null;
  updatedAt: string;
}

export interface Position {
  key: string;
  marketId: string;
  question: string;
  side: 'YES' | 'NO';
  size: number;
  avgEntry: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
}

export interface TradeRecord {
  ts: string;
  marketId: string;
  question: string;
  side: 'YES' | 'NO';
  action: 'BUY' | 'SELL';
  price: number;
  size: number;
  notional: number;
  fee: number;
  realizedPnl: number;
  strategy: string;
  dryRun: boolean;
}

export interface PortfolioData {
  initialBalance: number;
  cashBalance: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  feesPaid: number;
  exposureUsd: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  positions: Position[];
  trades: TradeRecord[];
}

export interface TradingSettings {
  mode: 'arb' | 'btc15' | 'both';
  loopIntervalMs: number;
  marketsRefreshMs: number;
  bookRefreshMs: number;
  maxMarketsScanned: number;
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
  minSpreadCents: number;
  tickSizeCents: number;
  btcTradeAmountUsd: number;
  spikeThresholdPct: number;
  divergenceThresholdPct: number;
  spikeWindowSec: number;
  decisionThreshold: number;
  signalWeights: { spike: number; divergence: number; momentum: number };
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
  privateKey: string;
  funderAddress: string;
  signatureType: number;
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
  dryRunInitialBalanceUsd: number;
  fillProbability: number;
  paperFillFeeBps: number;
}

export type AiProvider = 'demo' | 'openai' | 'openrouter' | 'anthropic' | 'custom';

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

export interface BtcSnapshot {
  asset: string;
  price: number;
  source: string;
  ts: string;
  changePct1m: number;
  changePct5m: number;
}

export const OPPTYPE_LABELS: Record<OpportunityType, string> = {
  'bundle-long': 'Bundle LONG (buy YES+NO)',
  'bundle-short': 'Bundle SHORT (sell YES+NO)',
  'market-making': 'Market making',
  'btc-signal': 'BTC signal',
};

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
