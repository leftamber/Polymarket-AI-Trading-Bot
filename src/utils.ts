import { ethers } from 'ethers';

/**
 * Format units from wei to readable string
 */
export function formatUnits(value: bigint | ethers.BigNumberish, decimals: number = 18): string {
  return ethers.formatUnits(value, decimals);
}

/**
 * Parse units from readable string to wei
 */
export function parseUnits(value: string, decimals: number = 18): bigint {
  return ethers.parseUnits(value, decimals);
}

/**
 * Apply slippage to a amount (returns amount with slippage subtracted for safety)
 */
export function applySlippage(amount: bigint, slippage: number): bigint {
  // slippage is a fraction (e.g., 0.01 for 1%)
  const slippageBN = BigInt(Math.floor(Number(amount) * slippage));
  return amount - slippageBN;
}

/**
 * Sleep for ms milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate a random ID
 */
export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Chunk an array into smaller arrays of size chunkSize
 */
export function chunk<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Convert a value into JSON-serializable form (bigints -> strings)
 */
export function jsonSafe(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = jsonSafe(v);
    }
    return out;
  }
  return value;
}