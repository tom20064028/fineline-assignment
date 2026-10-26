import { HttpPublishingApi } from './api.js';
import { Workspace, type JobEntry, type WorkspaceView } from './workspace.js';
import { resolveRoute, type AppRoute } from './routing.js';
import type { JobStep } from '../../shared/contracts.js';
import './style.css';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Application root is missing.');
const fileIcon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 3h7l4 4v14H7zM14 3v5h4M10 12h5M10 16h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

root.innerHTML = `
  <header class="topbar">
    <a class="brand" href="/" aria-label="Fineline publishing home"><span class="brand-mark">${fileIcon}</span><span>FINELINE<span class="brand-divider"></span><span class="brand-product">Publishing</span></span></a>
    <div class="topbar-session"><span id="session-badge" class="session-badge">Not signed in</span><button id="logout" class="button button-quiet" type="button" hidden>Sign out</button></div>
  </header>
  <main id="login-page" class="login-page" hidden>
    <div class="login-intro"><p class="eyebrow">DOCUMENT OPERATIONS</p><h1>Sign in to publishing</h1><p class="page-description">Access your workspace to publish and track documents.</p></div>
    <section class="panel login-panel" aria-labelledby="login-heading">
      <div class="panel-heading"><span class="section-icon">${fileIcon}</span><div><h2 id="login-heading">Workspace access</h2><p>Enter your client credentials to continue.</p></div></div>
      <form id="login-form" method="post">
        <div class="credential-fields"><div><label for="client-id">Client ID</label><input id="client-id" name="clientId" autocomplete="username" placeholder="Your client ID" maxlength="255" required /></div><div><label for="client-secret">Client secret</label><input id="client-secret" name="clientSecret" type="password" autocomplete="current-password" placeholder="Your client secret" maxlength="1024" required /></div></div>
        <p id="auth-message" class="form-message form-error" role="alert" hidden></p>
        <button id="login-button" class="button button-primary login-submit" type="submit">Sign in</button>
      </form>
      <p class="session-note login-note">Your token stays in this page. Refreshing the page requires signing in again.</p>
    </section>
    <p class="login-footer">Fineline · Document publishing service</p>
  </main>
  <main id="workspace-page" class="workspace" hidden>
    <div class="page-heading"><div><p class="eyebrow">DOCUMENT OPERATIONS</p><h1 id="workspace-title" tabindex="-1">Publishing workspace</h1><p class="page-description">From source to delivery, with a copy safely archived.</p></div><span class="workspace-label"><span></span>Document publishing</span></div>
    <div class="action-grid">
      <section class="panel publish-panel" aria-labelledby="publish-heading">
        <div class="panel-heading"><span class="section-icon">${fileIcon}</span><div><h2 id="publish-heading">Publish a document</h2><p>Start a publication using its source document ID.</p></div></div>
        <form id="publish-form">
          <label for="document-id">Document ID</label>
          <div class="publish-controls"><input id="document-id" name="documentId" placeholder="e.g. DOC001" maxlength="128" pattern="[A-Za-z0-9_-]+" required autocomplete="off" spellcheck="false" aria-describedby="document-help publication-message" disabled /><button id="publish-button" class="button button-primary" type="submit" disabled>Publish document <span aria-hidden="true">↗</span></button></div>
          <p id="document-help" class="field-help">Sign in to start publishing.</p>
          <div class="sample-documents"><span>Sample documents</span><button type="button" data-document="DOC001">DOC001</button><button type="button" data-document="DOC002">DOC002</button><button type="button" data-document="DOC003">DOC003</button></div>
          <p id="publication-message" class="form-message" role="status" hidden></p>
        </form>
        <div class="workflow"><span><i>1</i> Archive</span><span class="workflow-line"></span><span><i>2</i> Deliver</span><span class="workflow-line"></span><span><i>3</i> Report status</span></div>
      </section>
      <section class="panel access-panel" aria-labelledby="access-heading">
        <div class="access-heading"><h2 id="access-heading">Your session</h2><span class="lock-icon" aria-hidden="true">${'<svg viewBox="0 0 24 24" fill="none"><rect x="6" y="10" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'}</span></div>
        <div id="signed-in" hidden><div class="signed-in-mark" aria-hidden="true">✓</div><p class="signed-in-title">You're ready to publish</p><p class="access-description">Signed in as <strong id="active-client"></strong></p><p class="session-note">Your token stays in this page and expires after 15 minutes.</p></div>
      </section>
    </div>
    <section class="panel jobs-panel" aria-labelledby="jobs-heading">
      <div class="jobs-heading"><div><h2 id="jobs-heading">Publication jobs <span id="job-count" class="count">0</span></h2><p>Track the progress of documents submitted in this session.</p></div><span id="update-indicator" class="update-indicator">No active jobs</span></div>
      <div class="job-summary" aria-label="Job totals"><span><i class="dot dot-blue"></i>Running <strong id="running-count">0</strong></span><span><i class="dot dot-green"></i>Done <strong id="done-count">0</strong></span><span><i class="dot dot-red"></i>Failed <strong id="failed-count">0</strong></span><span class="sort-label">Newest first <span aria-hidden="true">↓</span></span></div>
      <div id="empty-jobs" class="empty-state"><span class="empty-icon">${fileIcon}</span><h3>No publications yet</h3><p>Your jobs will appear here when you publish a document.</p><span>Start with one of the sample document IDs above.</span></div>
      <div id="job-columns" class="job-columns" aria-hidden="true" hidden><span>DOCUMENT / JOB ID</span><span>STATUS</span><span>PROGRESS</span><span>CREATED</span></div>
      <ol id="jobs-list" class="jobs-list" aria-label="Publication jobs"></ol>
      <footer class="jobs-footer"><span>Session history clears when this page is refreshed.</span><span>Archive before delivery <span aria-hidden="true">✓</span></span></footer>
    </section>
    <footer class="page-footer"><span>Fineline · Document publishing service</span><span>Source → Archive → Vendor</span></footer>
    <div id="announcements" class="sr-only" role="status" aria-live="polite"></div>
  </main>
  <dialog id="publication-conflict" class="conflict-dialog" role="alertdialog" aria-labelledby="conflict-title" aria-describedby="conflict-description conflict-job">
    <span class="conflict-icon" aria-hidden="true">!</span>
    <h2 id="conflict-title">Document already submitted</h2>
    <p id="conflict-description"></p>
    <p id="conflict-job" class="job-id"></p>
    <button id="dismiss-conflict" type="button" class="button button-primary" autofocus>Close</button>
  </dialog>`;

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing UI element: ${selector}`);
  return found;
}
const loginForm = element<HTMLFormElement>('#login-form');
const clientId = element<HTMLInputElement>('#client-id');
const clientSecret = element<HTMLInputElement>('#client-secret');
const documentId = element<HTMLInputElement>('#document-id');
const publishButton = element<HTMLButtonElement>('#publish-button');
const loginButton = element<HTMLButtonElement>('#login-button');
const logoutButton = element<HTMLButtonElement>('#logout');
const conflictDialog = element<HTMLDialogElement>('#publication-conflict');
const workspace = new Workspace(new HttpPublishingApi());
const steps: Record<JobStep, string> = {
  queued: 'Waiting in queue', fetching: 'Reading source document', archiving: 'Saving archive',
  linking: 'Recording archive location', deleting: 'Removing source copy', delivering: 'Delivering to vendor', reporting: 'Writing final status',
};
const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

function text(tag: string, className: string, value: string): HTMLElement {
  const node = document.createElement(tag); node.className = className; node.textContent = value; return node;
}

function jobRow(entry: JobEntry, view: WorkspaceView): HTMLLIElement {
  const li = document.createElement('li');
  const row = document.createElement('article'); row.className = 'job-row'; row.setAttribute('aria-label', `Publication ${entry.documentId}`);
  const identity = document.createElement('div'); identity.className = 'job-identity';
  const icon = document.createElement('span'); icon.className = 'job-file-icon'; icon.innerHTML = fileIcon;
  const labels = document.createElement('div');
  labels.append(text('h3', 'document-name', entry.documentId), text('span', 'job-id', entry.jobId));
  identity.append(icon, labels);
  const status = entry.snapshot?.status ?? 'running';
  const statusCell = document.createElement('div'); statusCell.className = 'job-status';
  const badge = text('span', `status-badge status-${entry.unavailable ? 'unavailable' : status}`, entry.unavailable ? 'Unavailable' : status[0]!.toUpperCase() + status.slice(1));
  statusCell.append(badge);
  const progress = document.createElement('div'); progress.className = 'job-progress';
  const title = status === 'done' ? 'Delivered and reported' : status === 'failed' ? 'Publication failed' : entry.snapshot ? steps[entry.snapshot.step] : 'Checking job status';
  progress.append(text('p', 'progress-title', entry.snapshot?.reportingError ? 'Waiting to write final status' : title));
  if (entry.snapshot && entry.snapshot.vendorAttempts > 0) progress.append(text('p', 'field-help', `Vendor attempts: ${entry.snapshot.vendorAttempts}`));
  if (entry.snapshot?.error) progress.append(text('p', 'error-reason', entry.snapshot.error.message));
  if (entry.snapshot?.reportingError) progress.append(text('p', 'error-reason', entry.snapshot.reportingError.message));
  if (entry.snapshot?.deliveryOutcome === 'unknown') progress.append(text('p', 'field-help', 'Delivery could not be confirmed.'));
  if (entry.staleMessage) {
    progress.append(text('p', 'stale-message', entry.staleMessage));
    const refresh = text('button', 'refresh-button', 'Refresh status') as HTMLButtonElement;
    refresh.type = 'button'; refresh.disabled = !view.authenticated;
    refresh.addEventListener('click', () => { void workspace.refresh(entry.jobId); });
    progress.append(refresh);
  } else if (!view.authenticated && status === 'running') progress.append(text('p', 'field-help', 'Sign in to resume updates.'));
  else if (status === 'done') progress.append(text('p', 'field-help', 'Archive copy retained'));
  const createdAt = entry.snapshot?.createdAt ?? new Date(entry.acceptedAt).toISOString();
  const time = document.createElement('time'); time.className = 'job-time'; time.dateTime = createdAt; time.textContent = dateFormat.format(new Date(createdAt));
  row.append(identity, statusCell, progress, time); li.append(row);
  return li;
}

const lastStatuses = new Map<string, string>();
const renderedRows = new Map<string, { signature: string; node: HTMLLIElement }>();
let currentRoute: AppRoute | undefined;
function render(view: WorkspaceView): void {
  const route = resolveRoute(window.location.pathname, view.authenticated);
  if (window.location.pathname !== route) window.history.replaceState(null, '', route);
  element('#login-page').hidden = route !== '/login';
  element('#workspace-page').hidden = route !== '/workspace';
  document.title = route === '/login' ? 'Sign in · Fineline' : 'Document publishing · Fineline';
  element('#signed-in').hidden = !view.authenticated;
  element('#active-client').textContent = view.clientId;
  element('#session-badge').textContent = view.authenticated ? 'Signed in' : 'Not signed in';
  element('#session-badge').classList.toggle('is-connected', view.authenticated);
  logoutButton.hidden = !view.authenticated;
  loginButton.disabled = view.authenticating;
  loginButton.textContent = view.authenticating ? 'Signing in…' : 'Sign in';
  clientId.disabled = view.authenticating; clientSecret.disabled = view.authenticating;
  const authMessage = element('#auth-message'); authMessage.hidden = !view.authMessage; authMessage.textContent = view.authMessage;
  documentId.disabled = !view.authenticated || view.submitting || view.uncertainSubmission;
  if (view.pendingDocumentId) documentId.value = view.pendingDocumentId;
  publishButton.disabled = !view.authenticated || view.submitting;
  publishButton.dataset.loading = String(view.submitting);
  publishButton.textContent = view.submitting ? 'Submitting…' : view.uncertainSubmission ? 'Retry submission' : 'Publish document ↗';
  element('#document-help').textContent = !view.authenticated ? 'Sign in to start publishing.' : view.uncertainSubmission ? 'Retry keeps the original request ID and document.' : 'The original is removed only after its archive is safe.';
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-document]')) button.disabled = !view.authenticated || view.submitting || view.uncertainSubmission;
  const publicationMessage = element('#publication-message'); publicationMessage.hidden = !view.publicationMessage; publicationMessage.textContent = view.publicationMessage;
  publicationMessage.classList.toggle('form-error', view.publicationError);
  if (view.publicationConflict && view.authenticated) {
    element('#conflict-description').textContent = `${view.publicationConflict.documentId} already has a publication job. No new publication was started. Check the existing job in your workspace.`;
    element('#conflict-job').textContent = `Existing job: ${view.publicationConflict.jobId}`;
    if (!conflictDialog.open) conflictDialog.showModal();
  } else if (conflictDialog.open) conflictDialog.close();
  element('#job-count').textContent = String(view.jobs.length);
  const totals = { running: 0, done: 0, failed: 0 };
  for (const entry of view.jobs) totals[entry.snapshot?.status ?? 'running']++;
  for (const status of ['running', 'done', 'failed'] as const) element(`#${status}-count`).textContent = String(totals[status]);
  const indicator = element('#update-indicator');
  const pollingJobs = view.jobs.filter((entry) => !entry.unavailable && (!entry.snapshot || entry.snapshot.status === 'running')).length;
  indicator.textContent = pollingJobs ? view.authenticated ? 'Updating automatically' : 'Updates paused' : 'No active jobs';
  indicator.classList.toggle('is-updating', !!pollingJobs && view.authenticated);
  element('#empty-jobs').hidden = view.jobs.length > 0;
  element('#job-columns').hidden = view.jobs.length === 0;
  const list = element('#jobs-list');
  const rows = view.jobs.map((entry) => {
    const signature = JSON.stringify([entry, view.authenticated]);
    const existing = renderedRows.get(entry.jobId);
    if (existing?.signature === signature) return existing.node;
    const node = jobRow(entry, view); renderedRows.set(entry.jobId, { signature, node });
    return node;
  });
  // Keep unchanged rows attached so polling does not steal keyboard focus.
  rows.forEach((row, index) => { const current = list.children.item(index); if (current !== row) list.insertBefore(row, current); });
  while (list.children.length > rows.length) list.lastElementChild?.remove();
  for (const entry of view.jobs) {
    const status = entry.snapshot?.status ?? 'running';
    if (lastStatuses.get(entry.jobId) !== status && status !== 'running') element('#announcements').textContent = `${entry.documentId}: ${status}.${entry.snapshot?.error ? ` ${entry.snapshot.error.message}` : ''}`;
    lastStatuses.set(entry.jobId, status);
  }
  if (currentRoute !== route) {
    currentRoute = route;
    (route === '/login' ? clientId : element('#workspace-title')).focus({ preventScroll: true });
  }
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault(); const secret = clientSecret.value; clientSecret.value = '';
  void workspace.login(clientId.value.trim(), secret);
});
element<HTMLFormElement>('#publish-form').addEventListener('submit', (event) => { event.preventDefault(); void workspace.publish(documentId.value); });
logoutButton.addEventListener('click', () => workspace.logout());
element('#dismiss-conflict').addEventListener('click', () => workspace.dismissPublicationConflict());
conflictDialog.addEventListener('cancel', (event) => { event.preventDefault(); workspace.dismissPublicationConflict(); });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-document]')) button.addEventListener('click', () => { documentId.value = button.dataset.document ?? ''; documentId.focus(); });
workspace.subscribe(render);
window.addEventListener('popstate', () => render(workspace.view));
element<HTMLAnchorElement>('.brand').addEventListener('click', (event) => {
  // Avoid reloading the document and discarding an active in-memory session.
  event.preventDefault(); render(workspace.view);
});
window.addEventListener('pagehide', () => workspace.dispose(), { once: true });
