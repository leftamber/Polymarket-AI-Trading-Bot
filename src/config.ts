/**
 * Polymarket API endpoints and protocol constants
 */
export const GAMMA_API_URL = 'https://gamma-api.polymarket.com';
export const CLOB_API_URL = 'https://clob.polymarket.com';
export const DATA_API_URL = 'https://data-api.polymarket.com';
export const CLOB_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

export const POLYGON_CHAIN_ID = 137;

/** Polymarket CTF Exchange contract (signature type 0 / EOA) */
export const CTF_EXCHANGE_V2 = '0x5D91E07c9BD8FaECe7F7e5eB3D4677E0Ee6D6b8F';

/** spot price feeds for BTC/15m signal pipeline */
export const COINBASE_SPOT_URL = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';
export const BINANCE_SPOT_URL = 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT';

/** gamma /markets pagination */
export const GAMMA_PAGE_SIZE = 100;
export const GAMMA_PAGE_DELAY_MS = 150;

/** book polling pacing (from the reference implementation) */
export const BOOK_FETCH_BATCH = 20;
export const BOOK_FETCH_DELAY_MS = 50;
export const BOOK_BATCH_DELAY_MS = 300;

export const DASHBOARD_PORT_DEFAULT = 4449;
