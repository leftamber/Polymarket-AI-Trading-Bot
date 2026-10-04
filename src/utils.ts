/**
 * Shared utilities
 */

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export function chunk<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}

/**
 * Polymarket Gamma returns clobTokenIds / outcomes / outcomePrices as JSON-encoded
 * strings ('["id1","id2"]'). Sometimes they are already arrays, sometimes
 * comma-separated. This helper normalizes all the shapes.
 */
export function parseJsonish<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return trimmed.replace(/[[\]"]/g, '').split(',').map(s => s.trim()).filter(Boolean) as unknown as T[];
      }
    }
    return trimmed.split(',').map(s => s.trim()).filter(Boolean) as unknown as T[];
  }
  return [];
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

/**
 * Simple token-bucket rate limiter for REST polling
 */
export class RateLimiter {
  private queue: number[] = [];

  constructor(private maxPerSecond: number) {}

  public async acquire(): Promise<void> {
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
