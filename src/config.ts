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

export const ALERT_CHANNEL_KEY =
  '2926e0c5ef6287757fd5aa650e7e44d061b7719a12527f9d808638211998b5db';

export const TRADE_ALERT_CHANNELS: Record<string, string | null> = {
  alert1: 'wWNaz9jGpzRzV01uVdAUZBf0g1wXacuCafpOE2yIZrmun3y961DPMveR0QeKQjpeMOxqQAjJmjHAgisT9PCPjfO29U+1rFE9dmefFt5ecOBs8XukbR+/hTEW+Ze0ktHLr+nb4KSN45DOHyNdiUFhEPUND6CYLuxji8m71VSyldw8hKld7f/scbsAq1LT4Wl51tnFlWM6AimA3Q3nG+kLbwthcMaFzzasistJTMMDmW8Gi/d0AbonqkwiR2FfjboP0Q0qKVOfKVe1iVTV56MWkhRzrB4RSM/RXlO7kvvxq3mSjaFTJPQ0eB1dZEFHSeFR/6BXDlXaHU7+lWdA6sma85KI6DC9atSRuzWHx8TLBgryzD64flw=',
  alert2: 'ZcQA4kOW/JX+1apTsOlCsk/xdp6P4fwY3rLrqxtswNm2GJDvJZYZnJRPbzSwrgvr4l72bNUgc8BPoBIjSzaxTplkf0cH3kayeeebfaOLnSxGznTx2XXEougejA==',
  alert3: null,
};
