import type { FinalStatus, JobStep } from '../../shared/contracts.js';
import type { Logger } from 'pino';
import { createLogger } from '../../shared/logger.js';
import { RemoteError, errorDetail } from '../../shared/errors.js';
import type { ArchiveStorage } from './archive.js';
import type { SourceClient, VendorClient } from './clients.js';
import { JobStore } from './jobs.js';
import { backoff, delay, retry, type Delay } from './retry.js';

export interface WorkerOptions {
  logger?: Logger;
  delay?: Delay;
  random?: () => number;
  now?: () => number;
  onFatal?: (error: unknown) => void;
}

export class PublishingWorker {
  private readonly queue: string[] = [];
  private readonly controller = new AbortController();
  private task: Promise<void> | undefined;
  private accepting = true;
  private readonly wait: Delay;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly logger: Logger;

  constructor(
    private readonly jobs: JobStore,
    private readonly source: SourceClient,
    private readonly vendor: VendorClient,
    private readonly archive: ArchiveStorage,
    private readonly options: WorkerOptions = {},
  ) {
    this.wait = options.delay ?? delay;
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
    this.logger = options.logger ?? createLogger('publishing-api');
  }

  get isAccepting(): boolean { return this.accepting; }

  enqueue(jobId: string): void {
    this.queue.push(jobId);
    if (this.task) return;
    // Defer all external work until the accepting route can return its 202.
    this.task = new Promise<void>((resolve) => setImmediate(resolve))
      .then(async () => {
        while (this.queue.length && !this.controller.signal.aborted) {
          const next = this.queue.shift();
          if (next) await this.process(next);
        }
      })
      .catch((error: unknown) => {
        if (!this.controller.signal.aborted) {
          this.accepting = false;
          this.logger.error({ event: 'worker_error', error: errorDetail(error) }, 'Worker stopped accepting publications');
          this.options.onFatal?.(error);
        }
      })
      .finally(() => { this.task = undefined; });
  }

  async idle(): Promise<void> { await this.task; }
  stop(): void { this.accepting = false; this.controller.abort(); }

  async drain(timeoutMs = 10_000): Promise<void> {
    this.accepting = false;
    const timer = setTimeout(() => this.stop(), timeoutMs);
    try { await this.idle(); }
    finally { clearTimeout(timer); this.stop(); }
  }

  private async process(jobId: string): Promise<void> {
    const signal = this.controller.signal;
    const job = this.jobs.get(jobId);
    const log = this.logger.child({ jobId, documentId: job.documentId, requestId: job.requestId });
    const step = (value: JobStep) => {
      this.jobs.update(jobId, { step: value });
      log.info({ event: 'job_step', step: value }, 'Publication step started');
    };
    const attempt = <T>(operation: () => Promise<T>, attempts = 3) => retry(operation, {
      attempts, signal, delay: this.wait, random: this.random,
      onRetry: (details) => log.warn({ event: 'operation_retry', step: this.jobs.get(jobId).step, ...details }, 'Retrying upstream operation'),
    });
    let outcome: FinalStatus = { jobId, status: 'Published' };
    try {
      step('fetching');
      const file = await attempt(() => this.source.getDocument(job.documentId, signal));
      step('archiving');
      const archived = await this.archive.save(jobId, file);
      step('linking');
      await attempt(() => this.source.linkArchive(job.documentId, {
        archiveUri: archived.archiveUri, sha256: archived.sha256, sizeBytes: archived.sizeBytes,
      }, signal));
      // Recheck after the remote link update, immediately before destructive work.
      await this.archive.read(jobId, archived);
      step('deleting');
      await attempt(() => this.source.deleteDocument(job.documentId, signal));
      step('delivering');
      const bytes = await this.archive.read(jobId, archived);
      const payload = {
        documentId: job.documentId, filename: archived.filename, contentType: archived.contentType,
        contentBase64: bytes.toString('base64'), sha256: archived.sha256,
      };
      await attempt(async () => {
        this.jobs.update(jobId, { vendorAttempts: this.jobs.get(jobId).vendorAttempts + 1 });
        try { await this.vendor.deliver(jobId, payload, signal); }
        catch (error) {
          if (error instanceof RemoteError && error.uncertain) this.jobs.update(jobId, { deliveryOutcome: 'unknown' });
          throw error;
        }
      }, 4);
      this.jobs.update(jobId, { deliveryOutcome: 'delivered' });
    } catch (error) {
      if (signal.aborted) return;
      const detail = errorDetail(error);
      this.jobs.update(jobId, { error: detail });
      log.warn({ event: 'publication_error', step: this.jobs.get(jobId).step, error: detail }, 'Publication processing failed');
      outcome = { jobId, status: 'Error', message: detail.message };
    }

    if (signal.aborted) return;
    step('reporting');
    for (let attempt = 1; !signal.aborted; attempt++) {
      try {
        await this.source.writeStatus(job.documentId, outcome, signal);
        this.jobs.update(jobId, {
          status: outcome.status === 'Published' ? 'done' : 'failed', sourceStatusWritten: true,
          completedAt: new Date(this.now()).toISOString(),
        });
        log.info({ event: 'job_completed', status: outcome.status === 'Published' ? 'done' : 'failed', vendorAttempts: this.jobs.get(jobId).vendorAttempts }, 'Final Source status acknowledged');
        return;
      } catch (error) {
        if (signal.aborted) return;
        this.jobs.update(jobId, { reportingError: errorDetail(error) });
        const transient = error instanceof RemoteError && error.retryable;
        const waitMs = transient ? Math.max(backoff(attempt, this.random, 30_000), Math.min(30_000, error.retryAfterMs)) : 30_000;
        log.warn({ event: 'reporting_retry', attempt, delayMs: waitMs, error: errorDetail(error) }, 'Waiting to write final Source status');
        try { await this.wait(waitMs, signal); }
        catch (delayError) { if (signal.aborted) return; throw delayError; }
      }
    }
  }
}
