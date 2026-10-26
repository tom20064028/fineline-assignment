import { setTimeout as sleep } from 'node:timers/promises';
import { RemoteError, errorDetail } from '../../shared/errors.js';
import type { ErrorDetail } from '../../shared/contracts.js';

export type Delay = (ms: number, signal: AbortSignal) => Promise<void>;
export const delay: Delay = async (ms, signal) => { await sleep(ms, undefined, { signal }); };

export interface RetryOptions {
  attempts: number;
  signal: AbortSignal;
  delay: Delay;
  random: () => number;
  onRetry?: (details: { error: ErrorDetail; attempt: number; delayMs: number }) => void;
}

export function backoff(attempt: number, random: () => number, cap = 5000): number {
  return Math.min(cap, 250 * 2 ** Math.min(attempt - 1, 10) + Math.floor(random() * 100));
}

export async function retry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    options.signal.throwIfAborted();
    try { return await operation(); }
    catch (error) {
      if (options.signal.aborted || attempt >= options.attempts || !(error instanceof RemoteError) || !error.retryable) throw error;
      const delayMs = Math.max(backoff(attempt, options.random), Math.min(5000, error.retryAfterMs));
      options.onRetry?.({ error: errorDetail(error), attempt, delayMs });
      await options.delay(delayMs, options.signal);
    }
  }
}
