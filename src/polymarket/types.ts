/** Gamma API market item (subset of fields we use) */
export interface GammaMarket {
  id: string;
  conditionId: string;
  slug: string;
  question: string;
  description: string;
  yesTokenId: string;
  noTokenId: string;
  outcomes: string[];
  active: boolean;
  closed: boolean;
  resolved: boolean;
  volume24h: number;
  liquidity: number;
  category: string;
  negRisk: boolean;
  endDate?: string;
}

export interface BookLevel {
  price: number;
  size: number;
}

export interface TokenBook {
  bestBid: number | null;
  bestAsk: number | null;
  bestBidSize: number;
  bestAskSize: number;
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface MarketBook {
  marketId: string;
  conditionId: string;
  question: string;
  volume24h: number;
  liquidity: number;
  yesTokenId: string;
  noTokenId: string;
  yes: TokenBook;
  no: TokenBook;
  updatedAt: number;
}

export type OpportunityType = 'bundle-long' | 'bundle-short' | 'market-making' | 'btc-signal';

export interface OrderSpec {
  tokenId: string;
  side: 'BUY' | 'SELL';
  /** which outcome token this order refers to */
  sideLabel: 'YES' | 'NO';
  price: number;
  sizeShares: number;
  strategy: OpportunityType;
  marketId: string;
  question: string;
}

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
  signalSources?: string[];
  timestamp: number;
  expiresAt: number;
  orders: OrderSpec[];
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
