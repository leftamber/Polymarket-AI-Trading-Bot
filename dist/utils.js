"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatUnits = formatUnits;
exports.parseUnits = parseUnits;
exports.applySlippage = applySlippage;
exports.sleep = sleep;
exports.generateId = generateId;
exports.chunk = chunk;
exports.jsonSafe = jsonSafe;
const ethers_1 = require("ethers");
/**
 * Format units from wei to readable string
 */
function formatUnits(value, decimals = 18) {
    return ethers_1.ethers.formatUnits(value, decimals);
}
/**
 * Parse units from readable string to wei
 */
function parseUnits(value, decimals = 18) {
    return ethers_1.ethers.parseUnits(value, decimals);
}
/**
 * Apply slippage to a amount (returns amount with slippage subtracted for safety)
 */
function applySlippage(amount, slippage) {
    // slippage is a fraction (e.g., 0.01 for 1%)
    const slippageBN = BigInt(Math.floor(Number(amount) * slippage));
    return amount - slippageBN;
}
/**
 * Sleep for ms milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Generate a random ID
 */
function generateId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}
/**
 * Chunk an array into smaller arrays of size chunkSize
 */
function chunk(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
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
