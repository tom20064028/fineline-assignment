import { describe, expect, it, vi } from 'vitest';
import { retry, type Delay } from '../publishing-api/src/retry.js';
import { RemoteError } from '../shared/errors.js';

describe('retry timing', () => {
  it('retries only retryable errors and bounds Retry-After', async () => {
    const wait = vi.fn<Delay>(async () => {});
    const operation = vi.fn().mockRejectedValueOnce(new RemoteError('BUSY', 'Busy.', true, false, 90_000)).mockResolvedValue('ok');
    expect(await retry(operation, { attempts: 4, signal: new AbortController().signal, delay: wait, random: () => 0 })).toBe('ok');
    expect(wait.mock.calls[0]?.[0]).toBe(5000);
  });

  it('does not retry nonretryable errors or aborted work', async () => {
    const operation = vi.fn(async () => { throw new RemoteError('INVALID', 'Invalid.', false); });
    const wait = vi.fn(async () => {});
    await expect(retry(operation, { attempts: 4, signal: new AbortController().signal, delay: wait, random: () => 0 })).rejects.toMatchObject({ code: 'INVALID' });
    expect(operation).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort();
    await expect(retry(operation, { attempts: 4, signal: controller.signal, delay: wait, random: () => 0 })).rejects.toThrow();
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
