import type { Job } from '../../shared/contracts.js';
import { identifierSchema } from '../../shared/schemas.js';
import { ApiError, type PublishingApi } from './api.js';

export interface JobEntry {
  jobId: string;
  documentId: string;
  acceptedAt: number;
  order: number;
  snapshot?: Job;
  staleMessage?: string;
  unavailable: boolean;
}
export interface WorkspaceView {
  authenticated: boolean;
  authenticating: boolean;
  submitting: boolean;
  clientId: string;
  authMessage: string;
  publicationMessage: string;
  publicationError: boolean;
  publicationConflict?: { documentId: string; jobId: string };
  uncertainSubmission: boolean;
  pendingDocumentId: string;
  jobs: JobEntry[];
}

export class Workspace {
  private token: string | undefined;
  private epoch = 0;
  private disposed = false;
  private sequence = 0;
  private readonly entries = new Map<string, JobEntry>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly polling = new Map<string, AbortController>();
  private readonly failures = new Map<string, number>();
  private readonly listeners = new Set<(view: WorkspaceView) => void>();
  private loginController: AbortController | undefined;
  private publishController: AbortController | undefined;
  private pending: { documentId: string; requestId: string } | undefined;
  private authenticating = false;
  private submitting = false;
  private clientId = '';
  private authMessage = '';
  private publicationMessage = '';
  private publicationError = false;
  private publicationConflict: WorkspaceView['publicationConflict'];

  constructor(private readonly api: PublishingApi, private readonly options: { now?: () => number; uuid?: () => string; pollMs?: number } = {}) {}

  get view(): WorkspaceView {
    return {
      authenticated: this.token !== undefined, authenticating: this.authenticating, submitting: this.submitting,
      clientId: this.clientId, authMessage: this.authMessage, publicationMessage: this.publicationMessage, publicationError: this.publicationError,
      ...(this.publicationConflict ? { publicationConflict: { ...this.publicationConflict } } : {}),
      uncertainSubmission: !!this.pending && !this.submitting,
      pendingDocumentId: this.pending?.documentId ?? '',
      jobs: [...this.entries.values()].sort((a, b) => {
        const created = (entry: JobEntry) => entry.snapshot ? Date.parse(entry.snapshot.createdAt) : entry.acceptedAt;
        return created(b) - created(a) || b.order - a.order;
      }).map((entry) => structuredClone(entry)),
    };
  }

  subscribe(listener: (view: WorkspaceView) => void): () => void {
    this.listeners.add(listener); listener(this.view);
    return () => this.listeners.delete(listener);
  }
  private notify(): void { if (!this.disposed) for (const listener of this.listeners) listener(this.view); }

  async login(clientId: string, secret: string): Promise<void> {
    if (this.disposed || this.authenticating) return;
    this.authenticating = true; this.authMessage = ''; this.notify();
    const epoch = this.epoch;
    const controller = new AbortController(); this.loginController = controller;
    try {
      const token = await this.api.login(clientId, secret, controller.signal);
      if (this.disposed || epoch !== this.epoch) return;
      this.token = token; this.clientId = clientId;
      for (const entry of this.entries.values()) if (!entry.unavailable && (!entry.snapshot || entry.snapshot.status === 'running')) void this.poll(entry.jobId);
    } catch (error) {
      if (!this.disposed && epoch === this.epoch) this.authMessage = error instanceof ApiError ? error.message : 'Unable to sign in. Please try again.';
    } finally {
      if (epoch === this.epoch) { this.authenticating = false; this.loginController = undefined; this.notify(); }
    }
  }

  logout(message = ''): void {
    this.publicationConflict = undefined;
    this.epoch++; this.token = undefined; this.authenticating = false; this.submitting = false;
    this.loginController?.abort(); this.publishController?.abort(); this.pausePolling();
    this.authMessage = message; this.notify();
  }

  dismissPublicationConflict(): void {
    this.publicationConflict = undefined;
    this.notify();
  }

  private pausePolling(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const controller of this.polling.values()) controller.abort();
    this.polling.clear();
  }

  async publish(documentId: string): Promise<void> {
    if (!this.token || this.submitting || this.disposed) return;
    const parsed = identifierSchema.safeParse(documentId.trim());
    if (!parsed.success) { this.publicationError = true; this.publicationMessage = 'Enter a document ID using letters, numbers, hyphens or underscores (up to 128 characters).'; this.notify(); return; }
    if (!this.pending) this.pending = { documentId: parsed.data, requestId: (this.options.uuid ?? (() => crypto.randomUUID()))() };
    const pending = this.pending;
    const token = this.token;
    const epoch = this.epoch;
    const controller = new AbortController(); this.publishController = controller;
    this.submitting = true; this.publicationMessage = ''; this.publicationError = false; this.publicationConflict = undefined; this.notify();
    try {
      const jobId = await this.api.publish(pending.documentId, pending.requestId, token, controller.signal);
      if (epoch !== this.epoch || this.disposed) return;
      this.pending = undefined;
      this.track(jobId, pending.documentId);
      this.publicationMessage = `Publication accepted for ${pending.documentId}.`;
    } catch (error) {
      if (epoch !== this.epoch || this.disposed) return;
      if (error instanceof ApiError && error.status === 401) {
        this.logout('Your session has expired. Sign in to continue.');
      } else if (error instanceof ApiError && error.status === 409 && error.jobId) {
        this.pending = undefined; this.track(error.jobId, pending.documentId);
        this.publicationMessage = 'This document was already submitted. Its existing job is shown below.';
        this.publicationError = true;
        this.publicationConflict = { documentId: pending.documentId, jobId: error.jobId };
      } else if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        this.pending = undefined; this.publicationMessage = error.message; this.publicationError = true;
      } else {
        this.publicationMessage = 'The submission could not be confirmed. Retry submission to recover the same job safely.';
        this.publicationError = true;
      }
    } finally {
      if (epoch === this.epoch) { this.submitting = false; this.publishController = undefined; this.notify(); }
    }
  }

  private track(jobId: string, documentId: string): void {
    if (!this.entries.has(jobId)) this.entries.set(jobId, { jobId, documentId, acceptedAt: (this.options.now ?? Date.now)(), order: ++this.sequence, unavailable: false });
    void this.poll(jobId, true);
    this.notify();
  }

  async refresh(jobId: string): Promise<void> {
    const entry = this.entries.get(jobId);
    if (!entry || !this.token) return;
    entry.unavailable = false;
    await this.poll(jobId, true);
  }

  private async poll(jobId: string, manual = false): Promise<void> {
    const entry = this.entries.get(jobId);
    if (!entry || !this.token || this.disposed || this.polling.has(jobId)) return;
    if (!manual && (entry.unavailable || (entry.snapshot && entry.snapshot.status !== 'running'))) return;
    const timer = this.timers.get(jobId); if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(jobId);
    const controller = new AbortController(); this.polling.set(jobId, controller);
    const epoch = this.epoch;
    try {
      const job = await this.api.job(jobId, this.token, controller.signal);
      if (epoch !== this.epoch || this.disposed) return;
      entry.snapshot = job; entry.documentId = job.documentId; entry.unavailable = false;
      delete entry.staleMessage; this.failures.delete(jobId);
    } catch (error) {
      if (epoch !== this.epoch || this.disposed) return;
      if (error instanceof ApiError && error.status === 401) { this.logout('Your session has expired. Sign in to resume job updates.'); return; }
      if (error instanceof ApiError && error.status === 404) { entry.unavailable = true; entry.staleMessage = 'Job unavailable. The service may have restarted.'; }
      else { entry.staleMessage = 'Unable to refresh; showing the last known status. Retrying…'; this.failures.set(jobId, (this.failures.get(jobId) ?? 0) + 1); }
    } finally {
      if (epoch === this.epoch) this.polling.delete(jobId);
    }
    if (epoch !== this.epoch || this.disposed) return;
    this.notify();
    if (!entry.unavailable && (!entry.snapshot || entry.snapshot.status === 'running')) {
      const failures = this.failures.get(jobId) ?? 0;
      const delay = failures ? Math.min(15_000, 1000 * 2 ** Math.min(failures, 4)) : (this.options.pollMs ?? 1000);
      this.timers.set(jobId, setTimeout(() => { this.timers.delete(jobId); void this.poll(jobId); }, delay));
    }
  }

  dispose(): void { this.disposed = true; this.logout(); this.listeners.clear(); }
}
