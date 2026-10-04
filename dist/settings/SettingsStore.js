"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsStore = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = require("../logger");
function buildDefaultSettings() {
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
class SettingsStore {
    constructor(filePath) {
        this.version = 0;
        this.listeners = new Set();
        this.filePath = filePath || path_1.default.join(process.cwd(), 'data', 'settings.json');
        this.settings = this.load();
    }
    load() {
        const defaults = buildDefaultSettings();
        try {
            if (fs_1.default.existsSync(this.filePath)) {
                const raw = JSON.parse(fs_1.default.readFileSync(this.filePath, 'utf-8'));
                return this.merge(defaults, raw);
            }
        }
        catch (err) {
            logger_1.logger.warn('Failed to load settings file, using defaults:', err);
        }
        return defaults;
    }
    save() {
        try {
            fs_1.default.mkdirSync(path_1.default.dirname(this.filePath), { recursive: true });
            fs_1.default.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2));
        }
        catch (err) {
            logger_1.logger.error('Failed to save settings:', err);
        }
    }
    merge(base, patch) {
        if (Array.isArray(patch) || patch === null || typeof patch !== 'object') {
            return patch;
        }
        if (Array.isArray(base) || base === null || typeof base !== 'object') {
            return JSON.parse(JSON.stringify(patch));
        }
        const out = { ...base };
        for (const key of Object.keys(patch)) {
            out[key] = this.merge(base[key], patch[key]);
        }
        return out;
    }
    get() {
        return this.settings;
    }
    getVersion() {
        return this.version;
    }
    update(patch) {
        const clean = {};
        for (const section of ALLOWED_PATCH_SECTIONS) {
            const val = patch[section];
            if (val && typeof val === 'object' && !Array.isArray(val)) {
                clean[section] = val;
            }
        }
        this.settings = this.merge(this.settings, clean);
        this.persist();
        logger_1.logger.info(`Settings updated (v${this.version})`);
        return this.settings;
    }
    reset() {
        this.settings = buildDefaultSettings();
        this.persist();
        logger_1.logger.info('Settings reset to defaults');
        return this.settings;
    }
    /** credentials are live-trading ready (private key present) */
    hasLiveCredentials() {
        const pm = this.settings.polymarket;
        return !!pm.privateKey;
    }
    persist() {
        this.version++;
        this.save();
        this.notify();
    }
    onChange(listener) {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    notify() {
        for (const l of this.listeners) {
            try {
                l();
            }
            catch (err) {
                logger_1.logger.warn('Settings listener failed:', err);
            }
        }
    }
}
exports.SettingsStore = SettingsStore;
