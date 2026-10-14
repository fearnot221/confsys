# Architecture

## Implemented in Phase 0

```mermaid
flowchart LR
  Web[React / Vite] --> Hook[Data hook / TanStack Query]
  Hook --> SDK[Typed SDK / Zod DTO]
  SDK --> API[Fastify API]
  API --> PG[(PostgreSQL)]
  API --> Redis[(Redis)]
  API --> WH[Worker readiness]
  Worker[BullMQ worker] --> Redis
  Worker --> PG
```

API is a modular monolith, with only infrastructure routes in this phase. Worker is a separate process; it supports only `synthetic.ping` with a UUID nonce and no external effects. There is no job enqueue HTTP endpoint. Mailpit is a local capture service; no production sender or payment adapter is present.

Workspace packages resolve TypeScript source under the `development` condition, and compiled JavaScript under the default condition. Build outputs are distributed to each package's `dist`, preserving pnpm's per-package dependency resolution. Server production entry points are `apps/api/dist/main.js` and `apps/worker/dist/main.js`. No runtime tsx is needed for built apps.

API returns a true 503 if PostgreSQL migrations/role checks, Redis PING or worker readiness fail. Liveness reports process availability independently. Worker readiness checks its own role, migration state, Redis and queue startup/running state. A ready response is a point-in-time probe, not an uptime guarantee. Requests have server-generated UUIDs. Logs omit headers, query strings, request bodies, credentials and raw exception text.

## Isolation boundary

PostgreSQL owns durable state. Migration login `confsys_migrator` owns schemas; `confsys_app` and `confsys_worker` are distinct NOSUPERUSER/NOBYPASSRLS logins, not table owners and not members of elevated roles. Runtime startup probes reject unsafe roles. Initial migration installs only a checksum ledger and its grants; no product entities or seed users exist.

`withTenant` acquires one pooled connection, begins a transaction, validates UUID scope, sets both context settings with `set_config(..., true)`, executes a Drizzle/client callback on that connection, then commits or rolls back. Failed rollback destroys the connection. Scope cannot be omitted. Integration tests also directly query without context to prove RLS denial. Schema policies use both organization and conference keys, FORCE RLS and WITH CHECK. Composite keys prevent cross-scope references.

**This helper does not authenticate anybody.** Future HTTP services must resolve scope from authenticated memberships and resource ownership, then invoke it. Never map arbitrary request headers/body IDs directly into this helper. RLS is defense in depth against forgotten filters; it does not defeat a compromised application credential that can execute arbitrary SQL and set its own context.

## Planned; not implemented

Phase 1 introduces identity/session, organization/conference memberships, settings versions, audit, transactional outbox and private file metadata. Domain services/policies will be shared with worker; controllers only validate/map requests. No empty domain package was created because there are no business state machines yet.

Outbox: business state + event commit atomically in PostgreSQL. Dispatcher retries delivery using stable event IDs; handlers re-load trusted scope, re-check current policy, record attempts and deduplicate business outcomes. At-least-once processing does not guarantee exactly-once SMTP/payment effects. See ADR for interface conventions. No notification/outbox tables are claimed in Phase 0.

Storage will be private and authorized; no upload endpoint, public upload directory or provider exists. Public content requires explicit published DTO projections, not table rows. Redis queue and cache share a single noeviction development instance only; production requires separate instances. Redis logical DBs used in tests do not provide production resource isolation.
