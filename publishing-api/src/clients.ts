import type { ArchiveLink, Delivery, DocumentFile, FinalStatus } from '../../shared/contracts.js';
import { RemoteError } from '../../shared/errors.js';
import { documentFile, parse } from '../../shared/validation.js';
import { receiptSchema } from '../../shared/schemas.js';

export interface SourceClient {
  getDocument(id: string, signal: AbortSignal): Promise<DocumentFile>;
  linkArchive(id: string, link: ArchiveLink, signal: AbortSignal): Promise<void>;
  deleteDocument(id: string, signal: AbortSignal): Promise<void>;
  writeStatus(id: string, status: FinalStatus, signal: AbortSignal): Promise<void>;
}
export interface VendorClient { deliver(jobId: string, delivery: Delivery, signal: AbortSignal): Promise<void> }

export class HttpClient {
  private readonly base: URL;
  constructor(url: string, private readonly service: 'SOURCE' | 'VENDOR', private readonly timeoutMs = 5000) {
    this.base = new URL(url);
    if (!['http:', 'https:'].includes(this.base.protocol) || this.base.username || this.base.password) throw new Error('Invalid upstream URL.');
  }

  async request(path: string, method: string, body: unknown, signal: AbortSignal, json = false, headers: Record<string, string> = {}): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    try {
      const response = await fetch(new URL(path, this.base), {
        method, signal: AbortSignal.any([signal, timeout]), redirect: 'error',
        headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        const retryAfter = response.headers.get('retry-after');
        const seconds = retryAfter === null ? 0 : Number(retryAfter);
        const retryAfterMs = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : Math.max(0, Date.parse(retryAfter ?? '') - Date.now()) || 0;
        throw new RemoteError(`${this.service}_HTTP_${response.status}`, `${this.service} API returned ${response.status}.`, retryable, response.status >= 500 || response.status === 408, retryAfterMs);
      }
      if (!json) { await response.body?.cancel(); return undefined; }
      const chunks: Uint8Array[] = [];
      let length = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            length += value.length;
            if (length > 8 * 1024 * 1024) {
              await reader.cancel();
              throw new RemoteError(`${this.service}_INVALID_RESPONSE`, `${this.service} response exceeds the size limit.`, false, true);
            }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
      }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown; }
      catch { throw new RemoteError(`${this.service}_INVALID_RESPONSE`, `${this.service} returned invalid JSON.`, false, true); }
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof RemoteError) throw error;
      throw new RemoteError(`${this.service}_NETWORK_ERROR`, `${this.service} API request failed or timed out.`, true, true);
    }
  }
}

export function sourceClient(url: string, timeoutMs = 5000): SourceClient {
  const http = new HttpClient(url, 'SOURCE', timeoutMs);
  return {
    async getDocument(id, signal) {
      const result = await http.request(`/documents/${encodeURIComponent(id)}`, 'GET', undefined, signal, true);
      try {
        const file = documentFile(result);
        if (file.id !== id) throw new Error('Document identity mismatch.');
        return file;
      } catch { throw new RemoteError('SOURCE_INVALID_DOCUMENT', 'Source returned an invalid document.', false); }
    },
    async linkArchive(id, link, signal) { await http.request(`/documents/${encodeURIComponent(id)}/archive`, 'PUT', link, signal); },
    async deleteDocument(id, signal) { await http.request(`/documents/${encodeURIComponent(id)}`, 'DELETE', undefined, signal); },
    async writeStatus(id, status, signal) { await http.request(`/documents/${encodeURIComponent(id)}/status`, 'PUT', status, signal); },
  };
}

export function vendorClient(url: string, timeoutMs = 5000): VendorClient {
  const http = new HttpClient(url, 'VENDOR', timeoutMs);
  return {
    async deliver(jobId, delivery, signal) {
      const result = await http.request('/deliveries', 'POST', delivery, signal, true, { 'Idempotency-Key': jobId });
      try { parse(receiptSchema, result); }
      catch { throw new RemoteError('VENDOR_INVALID_RESPONSE', 'Vendor returned an invalid receipt.', false, true); }
    },
  };
}
