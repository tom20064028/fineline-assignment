# Document publishing service

Node.js/TypeScript Publishing API, separate frontend, local archive, and Source/Vendor stubs. See [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md) for detailed contracts and failure handling.

## Run

Requires Docker Compose v2:

```sh
cp .env.example .env
docker compose up --build
```

Open **http://localhost:3000** and sign in with the credentials in `.env` (defaults: `demo-client` / `change-me-for-local-demo`). Publish `DOC001`, `DOC002`, or `DOC003`; use `MISSING` to see a failed job. Jobs appear newest first, update automatically, and show failure reasons and Vendor attempt counts.

Source documents are generated in memory, and Vendor receipts stay in memory; only archives are physical files. Restart the backend services together to reset jobs, tokens and stub state. `docker compose down` preserves archives in `archive-data`; **`docker compose down -v` deletes them**.

## API and workflow

Publishing API: **http://localhost:3001**. Interactive Swagger: **http://localhost:3001/docs/**; specification: `/openapi.json`. Source/Vendor are internal to Compose.

| Endpoint | Contract |
| --- | --- |
| `POST /oauth/token` | Form fields `client_id`, `client_secret`; returns a bearer token valid for 15 minutes. |
| `POST /publish` | Bearer token; JSON `{documentId, requestId}`; immediately returns `202 {jobId}`. |
| `GET /jobs/{id}` | Bearer token; returns the job snapshot, including `running`, `done` or `failed`. |
| `GET /health` | Public readiness check. |

In Swagger, execute the token endpoint, copy `access_token` into **Authorize** without the `Bearer` prefix, then try publication and job polling. These requests perform real work. Set `API_DOCS_ENABLED=false` to disable documentation routes.

The worker follows the assignment's order:

```text
Fetch Source → archive and verify → record archive link → delete Source bytes
→ deliver to Vendor → write Published/Error to Source
```

Jobs become terminal only after Source acknowledges the final status. Archives remain at `/archive/<jobId>/document.bin`, with original filename and checksum in `metadata.json`.

Matching `requestId` and document return the same job. Reusing the request ID for another document returns `409`. As an additional conservative assumption, documents are immutable: a new request ID for an already submitted document also returns `409` with its existing job ID, including failed jobs. Automatic republication is excluded. Vendor retries reuse the job ID as their idempotency key to prevent duplicate acceptance after a lost response. Deduplication depends on the current Publisher/Vendor memory state; it is not guaranteed across restarts.

The frontend polls unfinished jobs about once per second. Tokens and displayed history stay in page memory; refreshing requires login again and clears the list. Direct unauthenticated workspace access redirects to login; the API independently rejects invalid tokens with `401` before doing work.

## Design decisions

| Choice | Reason |
| --- | --- |
| **Node.js + TypeScript** | The built-in event loop and asynchronous I/O fit HTTP/file orchestration. Frontend, API and stubs share types and Zod schemas. |
| **One process, FIFO worker and in-memory maps** | Keeps execution and deployment simple within the assignment's scope. Request IDs are checked and registered synchronously before work is queued; asynchronous I/O lets the API serve requests while a job waits. |
| **Bounded processing retries; unbounded reporting retries** | Limits repeated processing failures: Vendor gets four total attempts with backoff/jitter for transient errors; Source processing calls get three. Reporting retries indefinitely to meet the final-status requirement, without repeating delivery. This accepts blocking later jobs during a reporting outage. |
| **Verified local filesystem archives** | Temporary writes, file sync, atomic rename, and size/SHA-256 checks implement deletion safety using a local volume. The archive is rechecked immediately before Source deletion. |
| **No failed-job resubmission** | A failed job may have already deleted Source bytes or have an uncertain Vendor outcome. Rejecting new requests for that document avoids introducing an incomplete recovery flow. Retrying the original request ID still returns its original job; this restriction is stricter than the assignment requires. |

The Vendor's default 30% failure rate applies per new acceptance attempt, so a retried job can still finish as `done`. Each outbound HTTP attempt has a 5-second timeout; there is no overall job deadline.

## Tests and CI

Requires Node.js 24:

```sh
npm ci
npm run check
npx playwright install chromium
npm run test:e2e
```

`check` runs lint, TypeScript checks, unit/HTTP integration tests and builds. Tests verify workflow order, Source deletion, archive/Vendor byte integrity, idempotency, retries, failed reporting, size limits, and rejected unauthenticated requests. Failures and delays are injected for deterministic results.

Browser tests start isolated services on port 4173 and cover login, waiting/success/failure, duplicate submissions, sorting and mobile layout. To target a fresh existing stack, set `E2E_BASE_URL`, `E2E_CLIENT_ID` and `E2E_CLIENT_SECRET`.

For a running Docker stack, `npm run smoke` publishes `DOC003` and checks authentication, duplicate handling and completion. Use an unconsumed document; for deterministic success, set `VENDOR_FAILURE_RATE=0` in `.env` before starting Compose.

[GitHub Actions](.github/workflows/ci.yml) runs on pushes, PRs and manual dispatch. It installs dependencies, runs checks, builds all four Docker images, then runs API, Swagger and browser checks against Compose. CI uses disposable credentials and deterministic Vendor behavior. Failure logs/screenshots/traces are retained for seven days; containers and volumes are cleaned up. No deployment is configured.

## Local development

After `npm ci` and creating `.env`, run each command in a separate terminal:

```sh
npm run dev:source
npm run dev:vendor
npm run dev:api
npm run dev:frontend
```

Open `http://localhost:3000`; Vite proxies `/api` to the publisher. Local archives use `./archive`. `npm run build` compiles the backend and frontend. Pino logs include job/request IDs without credentials or file contents; `LOG_LEVEL` controls verbosity.

## Limitations and production improvements

- **Process-local state:** one API process/replica; restart loses jobs, tokens, deduplication records and stub data. Jobs are capped at 1,000 and files at 5 MiB. Production needs durable jobs/idempotency, checkpoints and crash recovery.
- **Single worker:** slow jobs delay the queue; final reporting can block it indefinitely. Production needs durable, independently scheduled reporting retries and controlled concurrency.
- **Local storage:** archives have no automatic retention, replication or disaster recovery. Production would use durable object storage and streaming for larger files.
- **Demo authentication:** one configured client and in-memory opaque tokens. Production needs managed credentials, authorization, TLS, rate limiting and operational monitoring.
- **Failure recovery:** jobs retain errors but no separate failure-stage field; `step` advances to reporting. Production needs recorded failure stages and recovery checkpoints to distinguish safe resubmission from archive replay or Vendor reconciliation, while preserving delivery idempotency.

Prioritize durable jobs/idempotency and recovery checkpoints, then define safe failed-job recovery and Vendor reconciliation before increasing concurrency.

Knowingly omitted: database/message broker integration, manual job redrive, global job history, archive download/retention endpoints, user management, full OAuth compliance, and deployment.

## AI assistance

OpenAI Codex assisted with assignment review, technical design, implementation, documentation and test development/execution.
