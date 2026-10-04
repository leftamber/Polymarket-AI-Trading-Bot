"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClobTrading = void 0;
const logger_1 = require("../logger");
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
class ClobTrading {
    constructor(store) {
        this.client = null;
        this.ready = false;
        this.initPromise = null;
        this.store = store;
    }
    isReady() {
        return this.ready;
    }
    async init() {
        if (this.ready)
            return true;
        if (this.initPromise)
            return this.initPromise;
        this.initPromise = this.doInit().catch((err) => {
            logger_1.logger.error(`CLOB live trading init failed: ${err.message}`);
            this.ready = false;
            return false;
        });
        return this.initPromise;
    }
    async doInit() {
        const pm = this.store.get().polymarket;
        if (!pm.privateKey) {
            logger_1.logger.warn('No polymarket.privateKey configured — live trading disabled (dry-run only)');
            return false;
        }
        let mod;
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            mod = require('@polymarket/clob-client');
        }
        catch (err) {
            logger_1.logger.error('@polymarket/clob-client is not installed — live trading disabled. Run: npm install @polymarket/clob-client');
            return false;
        }
        const ethersV5 = require('ethers');
        const signer = new ethersV5.Wallet(pm.privateKey);
        // L1 client (private key only)
        const l1 = new mod.ClobClient(pm.clobApiUrl, pm.chainId, signer);
        // L2 credentials: manual override or derive/create from the private key
        let creds = null;
        if (pm.apiKey && pm.apiSecret && pm.apiPassphrase) {
            creds = { key: pm.apiKey, secret: pm.apiSecret, passphrase: pm.apiPassphrase };
            logger_1.logger.info('CLOB L2 credentials loaded from settings');
        }
        else {
            try {
                creds = await l1.createOrDeriveApiKey();
                logger_1.logger.info(`CLOB L2 credentials derived for ${await signer.getAddress()}`);
            }
            catch (err) {
                logger_1.logger.warn(`createOrDeriveApiKey failed: ${err.message} — trying createApiKey`);
                try {
                    creds = await l1.createApiKey();
                }
                catch (err2) {
                    logger_1.logger.error(`Could not obtain CLOB API credentials: ${err2.message}`);
                    return false;
                }
            }
        }
        const funder = pm.funderAddress || undefined;
        this.client = new mod.ClobClient(pm.clobApiUrl, pm.chainId, signer, creds, pm.signatureType, funder);
        // sanity check: authenticated endpoint
        try {
            const addr = await this.client.getAddress?.();
            logger_1.logger.info(`CLOB live client ready${addr ? ` (${addr})` : ''}`);
        }
        catch { /* address endpoint may differ between versions */ }
        this.ready = true;
        return true;
    }
    async placeLimitOrder(spec) {
        if (!this.client) {
            return { ok: false, error: 'live client not initialized' };
        }
        try {
            let tickSize = '0.01';
            try {
                const ts = await this.client.getTickSize(spec.tokenId);
                if (ts)
                    tickSize = String(ts);
            }
            catch { /* default tick size */ }
            const order = await this.client.createOrder({ tokenID: spec.tokenId, price: spec.price, side: spec.side, size: spec.sizeShares }, { tickSize });
            const resp = await this.client.postOrder(order, 'GTC');
            const orderId = resp?.orderID || resp?.orderId || resp?.id;
            if (resp?.error) {
                return { ok: false, error: String(resp.error) };
            }
            return { ok: true, orderId: orderId ? String(orderId) : undefined };
        }
        catch (err) {
            return { ok: false, error: err.message };
        }
    }
    async cancelOrder(orderId) {
        if (!this.client)
            return false;
        try {
            await this.client.cancelOrder(orderId);
            return true;
        }
        catch (err) {
            logger_1.logger.warn(`cancelOrder(${orderId}) failed: ${err.message}`);
            return false;
        }
    }
    async cancelAllOrders() {
        if (!this.client)
            return;
        try {
            await this.client.cancelAll();
        }
        catch (err) {
            logger_1.logger.warn(`cancelAll failed: ${err.message}`);
        }
    }
    async getOpenOrders() {
        if (!this.client)
            return [];
        try {
            return await this.client.getOpenOrders() || [];
        }
        catch {
            return [];
        }
    }
    async getTrades() {
        if (!this.client)
            return [];
        try {
            return await this.client.getTrades() || [];
        }
        catch {
            return [];
        }
    }
    async getUsdcBalance() {
        if (!this.client)
            return null;
        try {
            // CLOB balance endpoint: COLLATERAL balance for the funder/proxy wallet
            const resp = await this.client.getBalanceAllowance?.({ asset_type: 'COLLATERAL' });
            const bal = resp?.balance;
            if (bal !== undefined && bal !== null) {
                const n = Number(bal);
                return Number.isFinite(n) ? (n > 1e6 ? n / 1e6 : n) : null; // raw USDC has 6 decimals
            }
            return null;
        }
        catch {
            return null;
        }
    }
}
exports.ClobTrading = ClobTrading;
