"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DASHBOARD_PORT_DEFAULT = exports.BOOK_BATCH_DELAY_MS = exports.BOOK_FETCH_DELAY_MS = exports.BOOK_FETCH_BATCH = exports.GAMMA_PAGE_DELAY_MS = exports.GAMMA_PAGE_SIZE = exports.BINANCE_SPOT_URL = exports.COINBASE_SPOT_URL = exports.CTF_EXCHANGE_V2 = exports.POLYGON_CHAIN_ID = exports.CLOB_WS_URL = exports.DATA_API_URL = exports.CLOB_API_URL = exports.GAMMA_API_URL = void 0;
/**
 * Polymarket API endpoints and protocol constants
 */
exports.GAMMA_API_URL = 'https://gamma-api.polymarket.com';
exports.CLOB_API_URL = 'https://clob.polymarket.com';
exports.DATA_API_URL = 'https://data-api.polymarket.com';
exports.CLOB_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
exports.POLYGON_CHAIN_ID = 137;
/** Polymarket CTF Exchange contract (signature type 0 / EOA) */
exports.CTF_EXCHANGE_V2 = '0x5D91E07c9BD8FaECe7F7e5eB3D4677E0Ee6D6b8F';
/** spot price feeds for BTC/15m signal pipeline */
exports.COINBASE_SPOT_URL = 'https://api.coinbase.com/v2/prices/BTC-USD/spot';
exports.BINANCE_SPOT_URL = 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT';
/** gamma /markets pagination */
exports.GAMMA_PAGE_SIZE = 100;
exports.GAMMA_PAGE_DELAY_MS = 150;
/** book polling pacing (from the reference implementation) */
exports.BOOK_FETCH_BATCH = 20;
exports.BOOK_FETCH_DELAY_MS = 50;
exports.BOOK_BATCH_DELAY_MS = 300;
exports.DASHBOARD_PORT_DEFAULT = 4449;
