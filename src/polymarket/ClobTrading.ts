import { logger } from '../logger';
import { SettingsStore } from '../settings/SettingsStore';
import { OrderSpec } from './types';

export interface LiveOrderResult {
  ok: boolean;
  orderId?: string;
  error?: string;
}

/**
 * Live order signing & placement via the official Polymarket CLOB client.
 *
 * The Python reference implementation never finished live trading (its
 * place_order was a TODO); this class completes the loop using
 * @polymarket/clob-client: L1 auth (private key) -> derive L2 API creds ->
 * signed GTC limit orders.
 *
 * The package is loaded lazily so the bot still runs (dry-run) if it is absent.
 */
export class ClobTrading {
  private store: SettingsStore;
  private client: any = null;
  private ready: boolean = false;
  private initPromise: Promise<boolean> | null = null;

  constructor(store: SettingsStore) {
    this.store = store;
  }

  public isReady(): boolean {
    return this.ready;
  }

  public async init(): Promise<boolean> {
    if (this.ready) return true;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit().catch((err) => {
      logger.error(`CLOB live trading init failed: ${(err as Error).message}`);
      this.ready = false;
      return false;
    });
    return this.initPromise;
  }

  private async doInit(): Promise<boolean> {
    const pm = this.store.get().polymarket;
    if (!pm.privateKey) {
      logger.warn('No polymarket.privateKey configured — live trading disabled (dry-run only)');
      return false;
    }

    let mod: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require('@polymarket/clob-client');
    } catch (err) {
      logger.error('@polymarket/clob-client is not installed — live trading disabled. Run: npm install @polymarket/clob-client');
      return false;
    }

    const ethersV5 = require('ethers');
    const signer = new ethersV5.Wallet(pm.privateKey);

    // L1 client (private key only)
    const l1 = new mod.ClobClient(pm.clobApiUrl, pm.chainId, signer);

    // L2 credentials: manual override or derive/create from the private key
    let creds: any = null;
    if (pm.apiKey && pm.apiSecret && pm.apiPassphrase) {
      creds = { key: pm.apiKey, secret: pm.apiSecret, passphrase: pm.apiPassphrase };
      logger.info('CLOB L2 credentials loaded from settings');
    } else {
      try {
        creds = await l1.createOrDeriveApiKey();
        logger.info(`CLOB L2 credentials derived for ${await signer.getAddress()}`);
      } catch (err) {
        logger.warn(`createOrDeriveApiKey failed: ${(err as Error).message} — trying createApiKey`);
        try {
          creds = await l1.createApiKey();
        } catch (err2) {
          logger.error(`Could not obtain CLOB API credentials: ${(err2 as Error).message}`);
          return false;
        }
      }
    }

    const funder = pm.funderAddress || undefined;
    this.client = new mod.ClobClient(pm.clobApiUrl, pm.chainId, signer, creds, pm.signatureType, funder);

    // sanity check: authenticated endpoint
    try {
      const addr = await this.client.getAddress?.();
      logger.info(`CLOB live client ready${addr ? ` (${addr})` : ''}`);
    } catch { /* address endpoint may differ between versions */ }

    this.ready = true;
    return true;
  }

  public async placeLimitOrder(spec: OrderSpec): Promise<LiveOrderResult> {
    if (!this.client) {
      return { ok: false, error: 'live client not initialized' };
    }
    try {
      let tickSize = '0.01';
      try {
        const ts = await this.client.getTickSize(spec.tokenId);
        if (ts) tickSize = String(ts);
      } catch { /* default tick size */ }

      const order = await this.client.createOrder(
        { tokenID: spec.tokenId, price: spec.price, side: spec.side, size: spec.sizeShares },
        { tickSize }
      );
      const resp = await this.client.postOrder(order, 'GTC');
      const orderId = resp?.orderID || resp?.orderId || resp?.id;
      if (resp?.error) {
        return { ok: false, error: String(resp.error) };
      }
      return { ok: true, orderId: orderId ? String(orderId) : undefined };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  public async cancelOrder(orderId: string): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.cancelOrder(orderId);
      return true;
    } catch (err) {
      logger.warn(`cancelOrder(${orderId}) failed: ${(err as Error).message}`);
      return false;
    }
  }

  public async cancelAllOrders(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.cancelAll();
    } catch (err) {
      logger.warn(`cancelAll failed: ${(err as Error).message}`);
    }
  }

  public async getOpenOrders(): Promise<any[]> {
    if (!this.client) return [];
    try {
      return await this.client.getOpenOrders() || [];
    } catch {
      return [];
    }
  }

  public async getTrades(): Promise<any[]> {
    if (!this.client) return [];
    try {
      return await this.client.getTrades() || [];
    } catch {
      return [];
    }
  }

  public async getUsdcBalance(): Promise<number | null> {
    if (!this.client) return null;
    try {
      // CLOB balance endpoint: COLLATERAL balance for the funder/proxy wallet
      const resp = await this.client.getBalanceAllowance?.({ asset_type: 'COLLATERAL' });
      const bal = resp?.balance;
      if (bal !== undefined && bal !== null) {
        const n = Number(bal);
        return Number.isFinite(n) ? (n > 1e6 ? n / 1e6 : n) : null; // raw USDC has 6 decimals
      }
      return null;
    } catch {
      return null;
    }
  }
}
