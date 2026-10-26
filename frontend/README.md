# Frontend

A separate Vite and TypeScript application for login, document publication, and job tracking. It calls the Publishing API over HTTP through a same-origin `/api` proxy.

Run `npm run dev:frontend` from the repository root after starting the three backend services. The UI is available at `http://localhost:3000`. Vite proxies `/api` to `http://127.0.0.1:3001`; set `API_PORT` or `FRONTEND_API_TARGET` for a different local API.

Production uses a dedicated unprivileged Nginx container serving the static build and proxying `/api` to the Publishing API. Start all four services with `docker compose up --build` from the repository root.

The entry route is `/login`. Login opens `/workspace`; unauthenticated access, logout, and API `401` responses redirect to `/login`. The client stores tokens, pending request IDs, and job history in page memory. Refreshing clears the session and requires login again. It polls running jobs without overlapping requests, stops at terminal status, pauses on authentication expiry, and preserves the original request ID if acceptance is uncertain. No client credentials are bundled into the frontend.

See the root README for credentials, sample documents, tests, and limitations.
