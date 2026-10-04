"use strict";
/**
 * Shared utilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimiter = void 0;
exports.sleep = sleep;
exports.generateId = generateId;
exports.chunk = chunk;
exports.clamp = clamp;
exports.round2 = round2;
exports.round4 = round4;
exports.parseJsonish = parseJsonish;
exports.jsonSafe = jsonSafe;
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function generateId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}
function chunk(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}
function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
}
function round2(v) {
    return Math.round(v * 100) / 100;
}
function round4(v) {
    return Math.round(v * 10000) / 10000;
}
/**
 * Polymarket Gamma returns clobTokenIds / outcomes / outcomePrices as JSON-encoded
 * strings ('["id1","id2"]'). Sometimes they are already arrays, sometimes
 * comma-separated. This helper normalizes all the shapes.
 */
function parseJsonish(value) {
    if (Array.isArray(value))
        return value;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed)
            return [];
        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                return Array.isArray(parsed) ? parsed : [];
            }
            catch {
                return trimmed.replace(/[[\]"]/g, '').split(',').map(s => s.trim()).filter(Boolean);
            }
        }
        return trimmed.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
}
/**
 * Convert a value into JSON-serializable form (bigints -> strings)
 */
function jsonSafe(value) {
    if (typeof value === 'bigint')
        return value.toString();
    if (Array.isArray(value))
        return value.map(jsonSafe);
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = jsonSafe(v);
        }
        return out;
    }
    return value;
}
/**
 * Simple token-bucket rate limiter for REST polling
 */
class RateLimiter {
    constructor(maxPerSecond) {
        this.maxPerSecond = maxPerSecond;
        this.queue = [];
    }
    async acquire() {
        const now = Date.now();
        this.queue = this.queue.filter(t => now - t < 1000);
        if (this.queue.length >= this.maxPerSecond) {
            const waitMs = 1000 - (now - this.queue[0]) + 5;
            await sleep(Math.max(waitMs, 5));
            return this.acquire();
        }
        this.queue.push(Date.now());
    }
}
exports.RateLimiter = RateLimiter;
