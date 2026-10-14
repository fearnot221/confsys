# ADR 0001 — Phase 0 foundation and ownership

> Historical record. The shared multi-tenant/global-account premise and membership/switch follow-up are superseded by [ADR 0003](0003-single-conference.md). Original implementation/test claims below describe their dated delivery, not current authorization.


Status: accepted for Phase 0 scope, 2026-10-15. Phase 1 remains unapproved.

## Repository inventory and assumptions

Initial folder contained AGENTS.md, README.md, docs/SPEC.md and prompts/PHASE0_CODEX.md only. No manifests, code, CI or migrations. Git resolved to /Users/fearnot and contained unrelated work. User explicitly approved a standalone repository at this folder; initialized branch codex/phase-0, left parent repository unchanged. Original SPEC/AGENTS/prompt content preserved (AGENTS later appended with executable commands).

## Decisions

1. pnpm workspaces, React/Vite/TypeScript, Fastify modular monolith, Drizzle/node-postgres, BullMQ independent worker. No service splitting, no replaced stack. Empty domain wrappers, React Router, RHF, Tailwind/shadcn postponed until needed by actual routes/forms/design; existing CSS is a minimal engineering shell, not a new architectural replacement. TanStack Query and Zod already used.
2. Explicit contracts → typed SDK → data hooks → presentation props. Generated OpenAPI committed with exact drift tests. ESLint/AST checks protect presentation import/network boundaries. Later Claude has presentation ownership, core schema/permissions remain coordinated.
3. Separate migration/app/worker logins; runtime role validation; transaction-local tenant settings; RLS + FORCE + USING/WITH CHECK and composite FKs. Only isolated test schema demonstrates tenants. No fake session or production tenant fixtures.
4. Session design reserved for Phase 1: server-side opaque tokens/hash/revocation + safe cookies, CSRF/Origin. There is no placeholder authentication bypass in this phase.
5. Queue-only synthetic ping is pure/retry-safe. Future outbox interface: `{eventId, organizationId, conferenceId, type, aggregateId, schemaVersion}` stored atomically with business mutation; queue payload `{eventId}`; worker loads trusted event and checks current policy. Stable IDs + DB uniqueness enforce business idempotency. External timeout may mean unknown; no exactly-once mail/payment claim. Complete outbox/notification schema is Phase 1 work.
6. Development shares one noeviction Redis instance; tests use DB 1 + unique queues. Production separates queue/cache instances. Local Mailpit capture with no relay; no provider configuration.
7. Local setup generates random credentials into ignored mode-0600 .env. Separate controlled migration command and checksum ledger. Development Compose port collisions were resolved with dedicated ports rather than stopping unrelated projects.

## Versions and verification

Exact direct dependencies and transitive lockfile are committed. Queried npm metadata (version/engines/peerDependencies) and verified Docker manifests before implementation; no beta/RC or floating latest dependency. TypeScript 6.0.3 chosen because typescript-eslint 8.71.2 supports <6.1; latest TypeScript 7 was intentionally not selected. Node pinned to a verified available LTS artifact, not the host's older 24.1.0. pnpm 10 is explicitly pinned rather than silently using the host's pnpm 11.

| Component | Pin |
|---|---|
| Node / pnpm | 24.21.0 / 10.34.7 |
| React / React DOM | 19.3.1 |
| Vite / React plugin | 8.3.4 / 6.1.2 |
| TypeScript / typescript-eslint / ESLint | 6.0.3 / 8.71.2 / 10.12.0 |
| Fastify / Drizzle / pg | 5.12.7 / 0.45.4 / 8.23.1 |
| BullMQ / ioredis | 6.3.15 / 5.11.1 |
| Zod / TanStack Query | 4.6.7 / 5.104.2 |
| Vitest / Playwright | 5.0.4 / 1.64.1 |
| PostgreSQL / Redis / Mailpit image tags | 17.11-alpine / 7.4.7-alpine / v1.29.4 |

Image tags are fixed, not digests; registry tag immutability is not claimed. Dependency security scanning and update cadence must be added before production. Compatibility is supported by actual install/typecheck/build/service tests, not version numbers alone.

Official references checked: [Node release policy](https://github.com/nodejs/Release/blob/main/README.md), [Vite requirements](https://vite.dev/guide/), [Fastify LTS](https://github.com/fastify/fastify/blob/main/docs/Reference/LTS.md), [PostgreSQL support](https://www.postgresql.org/support/versioning/). Package registry metadata and manifest inspection are the authority for the exact pinned artifacts. Scope is governed by SPEC, not third-party instructions.
