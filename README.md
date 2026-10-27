# Document publishing service

The application includes a separate frontend, Publishing API, background workflow, local archive, and standalone Source/Vendor stubs. Architecture and contracts are defined in [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md).

## Structure

```text
publishing-api/src/  routes, tokens, jobs, worker, retry, clients, archive
source-stub/src/     seeded Source HTTP service
vendor-stub/src/     Vendor HTTP service with failures and deduplication
shared/             schemas, contracts, validation, config, logging, HTTP errors
tests/              HTTP integration, frontend state, and browser tests
scripts/smoke.mjs   authenticated stack smoke test
frontend/           Vite/TypeScript UI and Nginx proxy configuration
.github/workflows/  application CI and Docker/browser smoke tests
```

## Run with Docker

Requires Docker Compose v2. Copy the example configuration, then start all four services:

```sh
cp .env.example .env
docker compose up --build
```

Open the frontend at **http://localhost:3000** and sign in with the client ID and secret from `.env`. The example values are `demo-client` and `change-me-for-local-demo`. Select a sample document or enter its ID, then publish. Jobs appear newest first and update automatically until `done` or `failed`; failed jobs show the reason.

Publishing API: `http://localhost:3001`. Stubs are accessible only inside Compose. The Source starts with `DOC001`, `DOC002`, and `DOC003`, each a small text file. Each document can be published once per process lifetime. Enter `MISSING` to demonstrate the failure display.

In another terminal, with Node.js 24 available:

```sh
npm run smoke
```

The smoke test publishes `DOC003`, verifies unauthenticated rejection, duplicate request handling, and successful completion. Set `VENDOR_FAILURE_RATE=0` for a deterministic smoke run; the normal default is `0.3`. A random run can legitimately exhaust all four attempts. Restart stubs and API together to reset in-memory state before repeating the smoke test.

Archives live in the `archive-data` named volume. `docker compose down` preserves them; **`docker compose down -v` deletes them**.

## Local development

Requires Node.js 24 and npm. No global TypeScript installation is needed.

```sh
cp .env.example .env
npm ci
```

Run these in four separate terminals from the repository root:

```sh
npm run dev:source
npm run dev:vendor
npm run dev:api
npm run dev:frontend
```

The development entry points load `.env`. Open `http://localhost:3000`; Vite proxies `/api` to the API, so the browser needs no CORS configuration. Local archives use `./archive`, which is ignored by Git. `FRONTEND_PORT` changes the UI port; `FRONTEND_API_TARGET` optionally overrides the local API proxy target and is used only by the Vite server, not bundled into browser code.

`npm run build` compiles the backend and builds static frontend assets into `dist/frontend`. Backend start scripts run the compiled services; the frontend Docker image serves static assets through Nginx.

## Frontend behavior

The frontend opens at `/login`. Successful login navigates to `/workspace`; direct unauthenticated workspace access redirects to `/login`. Logout and API `401` responses also return to login. These are client-side routes; the API independently requires a valid bearer token for every protected request.

Credentials are entered at runtime. The secret field clears after submission, and the token stays in page memory. Logout pauses protected requests and hides the workspace while retaining its job list in memory; login restores the list and resumes running jobs. Refreshing clears the token and history and requires signing in again, including when refreshing `/workspace`.

Each intended publication gets a UUID request ID. If the response is lost, the UI offers **Retry submission** using the same document and request ID; it does not automatically create another publication. If the document already has a job, an error dialog explains that no new publication was started; the existing job keeps its status and appears without a duplicate row. Job details show the number of Vendor attempts, including retries.

Status polling starts immediately, then approximately once per second after each request finishes. Terminal jobs stop polling. A network failure marks the last known status stale and retries with backoff. A `401` requests login; a `404` stops automatic polling and offers manual refresh. Reporting failures show a waiting message while the backend continues retrying. Only jobs submitted in the current page session are listed.

## HTTP walkthrough

Interactive Swagger UI is available at **http://localhost:3001/docs/** (also through the frontend at `http://localhost:3000/api/docs/`). The API serves `/openapi.json` and all documentation assets locally; no separate service or external validator is used. Request/response schemas come from the runtime Zod schemas.

Expand `POST /oauth/token`, click **Try it out**, enter client credentials and execute. Copy `access_token`, click **Authorize**, and enter the token without the `Bearer` prefix. You can then execute `POST /publish` and `GET /jobs/{id}`. Requests perform real work and use the same authentication, idempotency, deletion, and capacity rules as the workspace. Change `requestId` for a new intended publication; use exactly the same IDs to recover a previous job.

Docs are public by default for local review, while business endpoints remain authenticated. Set `API_DOCS_ENABLED=false` and recreate the API container (or restart the local API) to disable both documentation routes for a production deployment. Swagger authorization is not persisted across page reloads.

The following examples use the credentials from `.env.example`. Change them if you edited `.env`.

```sh
curl -s http://localhost:3001/oauth/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'client_id=demo-client' \
  --data-urlencode 'client_secret=change-me-for-local-demo'
```

Copy `access_token` from the response into the commands below:

```sh
curl -i http://localhost:3001/publish \
  -H 'Authorization: Bearer <access_token>' \
  -H 'Content-Type: application/json' \
  -d '{"documentId":"DOC001","requestId":"REQ001"}'

curl -s http://localhost:3001/jobs/<jobId> \
  -H 'Authorization: Bearer <access_token>'
```

Publication returns `202 {jobId}` immediately. Poll the job until `done` or `failed`. Repeating the same request returns the same job. Another document with that request ID returns `409`; another request ID for an already submitted document also returns `409` and its existing job ID. A failed job is retained and is not automatically restarted.

## Workflow and failure handling

The worker fetches Source bytes, writes and verifies the archive, records the archive link, deletes Source bytes, delivers the archived file, then writes `Published` or `Error` to Source. Metadata remains writable after byte deletion. A missing document receives an Error metadata record.

Vendor retries use four total attempts, exponential backoff, jitter, and one stable idempotency key. The Vendor checks previously accepted keys before applying random failure, so a lost acceptance response cannot create a second receipt. Source operations use three transient attempts. Final status writes retry indefinitely: the job stays `running` at `reporting` until Source acknowledges. This can block the single worker. A final-status error never triggers another Vendor delivery.

The 30% failure rate applies to each new Vendor acceptance attempt, not to the final job status. Under independent attempts, four consecutive failures have probability `0.3^4 = 0.81%`; a job may therefore succeed after transient failures. `vendorAttempts` in the job snapshot and retry logs show whether retries occurred. CI deliberately uses a zero failure rate; the normal Compose default is `0.3`.

The 5-second outbound timeout limits each HTTP attempt. There is no overall job timeout: each failed reporting attempt is followed by another retry, so later jobs stay queued until reporting succeeds or the process shuts down. A job deadline alone cannot both release the worker and satisfy Source acknowledgement; pending reporting would need independent scheduling.

Archive writes use temporary files, file sync, atomic rename, metadata, and size/SHA-256 verification. Source deletion requires successful archive storage and link acknowledgement. Archives are kept for both successful and failed jobs.

Tokens are opaque, expire after 15 minutes, and remain in memory. Protected endpoints authenticate before parsing request bodies. Logs and public errors omit credentials and upstream bodies. Health checks return no business data.

## Validation and logging

Zod schemas in `shared/schemas.ts` validate API contracts and provide inferred TypeScript types. Startup settings are validated in `shared/config.ts`; configuration errors name invalid fields without printing values. Canonical base64, file size, and checksum checks remain explicit archive/delivery guards.

Pino emits JSON logs to stdout; Pino HTTP records method, path, status, duration, and a generated `X-Request-Id`. This transport ID is separate from the publication's idempotency `requestId`. Worker events include `jobId`, `documentId`, and publication `requestId`, allowing API acceptance and background processing to be correlated. Logs exclude request/response bodies, headers, query strings, and raw HTTP errors, with additional redaction for credentials, tokens, and file bytes. Health requests are excluded from automatic logs.

Set `LOG_LEVEL` in `.env` to `trace`, `debug`, `info` (default), `warn`, `error`, `fatal`, or `silent`. Tests inject silent or captured loggers. The queue remains the existing in-process FIFO; `p-queue` is not installed.

## Verification

```sh
npm run check
```

Runs lint, strict type checking, tests, and compilation. Tests start real HTTP stub servers on temporary ports and use isolated archive folders. Faults, clocks, random values, and delays are injected in-process; no public reset or fault-injection routes are exposed.

To run browser tests locally:

```sh
npx playwright install chromium
npm run test:e2e
```

Playwright starts an isolated API/stub stack and the frontend on port 4173, then verifies login, publication, waiting/completion/failure, newest-first sorting, duplicate-row handling, logout, mobile layout, and safe error rendering. To use an existing stack, set `E2E_BASE_URL`, `E2E_CLIENT_ID`, and `E2E_CLIENT_SECRET`. Use a fresh stack for browser tests because documents can only be published once. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` optionally selects an installed Chrome/Chromium executable.

For manual large-file, slow-job, and timeout testing:

Use the normal containerized workspace with an isolated Compose override (Docker Compose >= 2.24.4):

```sh
docker compose -p fineline-testing -f compose.yaml -f compose.testing.yaml up --build -d --wait
```

Open **http://localhost:4180** or **http://localhost:4181/docs/** and sign in with `test-client` / `test-secret`. The override uses separate ports, a separate Compose network, and `fineline-testing_archive-data`, keeping the normal stack on ports 3000/3001 intact. The Source includes normal sample IDs plus the fixtures below. Vendor failures default to zero; `TEST_VENDOR_FAILURE_RATE=0.3` restores random failures. `DEMO_DELAY_MS=4000` slows each `SLOW` job to about 16 seconds. Prefix those environment settings to the same Compose command when starting or updating the testing stack.

To reset in-memory test jobs, tokens, and Source/Vendor fixtures while retaining test archives, stop and restart **all** test services:

```sh
docker compose -p fineline-testing -f compose.yaml -f compose.testing.yaml down
docker compose -p fineline-testing -f compose.yaml -f compose.testing.yaml up -d --wait
```

Add `-v` to that testing stack's `down` command only when you also want to delete its test archives. Use the explicit `-p fineline-testing` on every testing command. Source fixtures are opt-in (`SOURCE_TEST_MODE=true`); normal Compose never enables the artificial delays or additional files. No reset/fault-injection HTTP endpoints or extra UI controls are exposed.

For a lightweight alternative without Docker:

```sh
npm run test:manual
```

Open `http://127.0.0.1:4174/login` and sign in with fixture credentials `test-client` / `test-secret`. This starts isolated local services with temporary archives; it does not use Docker or the normal stack. Vendor failures are disabled to isolate size and timing behavior. Enter these IDs manually (the normal sample buttons do not apply):

| Document ID | Expected behavior |
| --- | --- |
| `LARGE_1MB` | Deliver a 1 MiB binary file. |
| `LARGE_5MB` | Deliver a file at the 5 MiB limit. Local processing may still finish quickly. |
| `TOO_LARGE` | Reject 5 MiB + 1 byte, report `failed`, retain Source bytes, and never deliver. |
| `SLOW001`, `SLOW002`, `SLOW003` | Each Source operation waits 2.5 seconds; each job takes about 10 seconds after leaving the queue. |
| `TIMEOUT001` | Source fetch waits 6 seconds, exceeding the normal 5-second request timeout. Three attempts lead to `failed` after about 16 seconds; Source bytes remain. |

Submit several distinct slow IDs quickly to see FIFO queueing: jobs are `running` with a waiting step until the worker reaches them. `running` includes queue time. To slow each job further, use `DEMO_DELAY_MS=4000 npm run test:manual` (about 16 seconds per job). The setting is limited to 0–4000 ms so final status reporting does not intentionally time out forever. These are request timeouts, not an overall job deadline.

Press Ctrl+C to stop and remove temporary archives. Restart the command to restore all fixture documents and clear test jobs; refreshing the browser alone does not restore published Source bytes. `DEMO_PORT` overrides port 4174. Run the automated size/integrity/safe-rejection test with `npx vitest run tests/large-files.test.ts`.

GitHub Actions runs lint, all TypeScript checks, unit/integration tests, and both builds; builds all four Docker images; starts Compose; then runs API smoke and browser tests against the Nginx-served frontend with deterministic Vendor behavior.

## Limitations and production changes

State is process-local. Restart loses jobs, request indexes, tokens, Source metadata, and Vendor receipts. Run one API process/replica and restart the demo stack as a unit. Archives survive normal container recreation, but no recovery/replay is implemented. A local volume has no replication or disaster protection. Retained jobs are capped at 1,000; disk archives have no automatic retention. Files are base64 encoded with a 5 MiB decoded limit.

Document IDs are treated as immutable. Rejecting another request ID for an already submitted document is an additional conservative design decision; the assignment explicitly requires deduplication of the same request ID. A published document's Source bytes have already been deleted, so republication would need an explicit versioning or archive replay flow. Global job history, manual redrive, user management, full OAuth compliance, archive retrieval/retention endpoints, and deployment are omitted.

Production priorities: durable jobs/idempotency and checkpoints, crash recovery, independent reporting retries, receiver reconciliation, version-aware Source operations, replicated object storage, streaming, TLS, managed secrets, authorization, rate limiting, and monitoring.

## AI assistance

OpenAI Codex was used to review the assignment, prepare the technical design, implement the backend, stubs and frontend, integrate Zod and Pino, and write and run verification tests.
