# Roadmap

Scope follows SPEC; only Phase 0 is authorized in this change.

| Phase | Status / scope |
|---|---|
| 0 | Implemented engineering foundation, real service UI, contracts, isolation tests, CI configuration and docs; evidence in PHASE0_DELIVERY |
| 1 | Not started: identity, tenancy, conference settings/public pages, invitations, audit, outbox/private-file foundations |
| 2 | Not started: registration, pricing, capacity, manual reconciliation, group payments, meals, receipts |
| 3 | Not started: submission, revisions, private content validation/quarantine |
| 4 | Not started: assignments, conflicts, review and decision publication |
| 5 | Not started: program, publication versions, oral/poster competitions |
| 6 | Not started: check-in/redemption, documents, notifications, exports, selected provider sandboxes |
| 7 | Not started: Claude read-only UI audit then isolated presentation PRs; end-to-end launch verification |

## Smallest Phase 1 increments (require approval)

1. **Identity + real session slice:** users/identities, verification/reset/session tables and audit/outbox foundation; register/verify/login/logout UI and APIs; local Mailpit only; password hashing, CSRF/Origin, rotation/revocation tests. No production known-password seeds.
2. **Organization/conference access slice:** memberships, scoped role templates, two orgs/three synthetic conferences, trusted context resolver replacing test-only assumptions; full RLS/composite constraints; real conference switch with cache/form isolation tests.
3. **Conference/series settings slice:** timezone/currency/locales, immutable settings versions, draft create/edit; clone whitelisted configuration only with dates reconfirmed and new identifiers.
4. **Published site slice:** draft/revision/public projection, Vite-compatible prerender or server-rendered public shell; public HTML validation, locale/SEO basics, no private-data leak.
5. **Shared reliability completion:** invitations + persisted outbox dispatcher/attempts/unknown outcomes; private file framework, bounded validation/quarantine and authorization; complete Phase 1 acceptance regression.

Each slice needs usable UI, real API, errors, authorization, migrations/tests and docs. Contracts must be coordinated before presentation changes. Stop after Phase 0; do not implement these slices without confirmation.

Open questions that do not block Phase 0: hosting, volumes/traffic, external mail/payment provider, SSO, receipt requirements, data retention and anonymization policy. No provider/production-readiness claim is made.

## Phase 0 maintainability review — 2026-10-15

Focused source review of baseline `c6f1d5f`, covering API/worker entry points, config, transaction helper/migrations, SDK/data hook, import checks, build distribution and tests. This review adds enduring requirements, not Phase 1 authorization. No full rewrite or new framework is justified by the present health-only API and synthetic worker.

Current boundaries are explicit: DTO/SDK/data hook/presentation are separated, `withTenant` uses transaction-local settings and a single checked-out client, and app/worker isolation is exercised by actual nonprivileged-role tests. No concrete safety/correctness blocker was demonstrated for the existing Phase 0 behavior in this focused review. This is not a comprehensive security assessment or permission to add business access without authorization.

| ID / evidence | Practical risk and scope | Treatment point and acceptance criteria |
|---|---|---|
| M1 — `packages/config/src/index.ts` requires both DB URLs; `compose.yaml` shares `&app-env` | Each process receives the other's credential and irrelevant settings. Both roles are currently restricted and expose no business API; this would undermine future least-privilege separation. Migration URL validation is also outside the common validator. | Before the first authorized Phase 1 identity/persistence slice: split validated API/worker/migration config entry points while reusing shared field schemas; give each container only its own credentials. Tests must prove independent startup and safe missing/invalid-env errors. Update examples/Compose/CI/docs together. |
| M2 — `apps/{api,worker}/src/main.ts`, worker processor and `packages/db/src/index.ts` | Redis error listeners discard details, worker/DB logs mix text and JSON, and readiness failure categories are coarse. They report failure rather than fake success, but diagnosis and cross-process correlation are weak. | In the next authorized reliability work, before persistent jobs: add consistent sanitized event/service/job/request/attempt context, documented deliberate suppression, outage/recovery tests and assertions that secrets never enter logs. Keep public health DTOs minimal. |
| M3 — `scripts/check-boundaries.mjs` and `eslint.config.mjs` | AST check assumes every feature has `components/` and allows a literal relative import instead of resolving a general graph; contracts lint checks named DB imports, not every indirect path. Current source follows the intended boundary, but module expansion may fail unnecessarily or expose blind spots. | Before adding the next feature/package: cover empty/absent presentation folders, permitted UI-to-UI imports and forbidden relative/aliased/re-export paths with regression fixtures. Extend checks only for demonstrated cases, without a new dependency framework. |
| M4 — root `package.json` build and `scripts/distribute-build.mjs` | `tsc` staging output is not cleaned before copying to package-local dist; deleted/renamed source can leave old compiled files. No stale route/module was demonstrated in the current tree; clean container builds avoid this inherited-output case. | Before the next source removal/move: clean only known generated outputs as part of build, and test build → delete a fixture source → rebuild excludes the old output. Preserve sources and unrelated files. |
| M5 — `apps/api/src/app.ts` error handler | All thrown 4xx statuses become 400. Current health-only routes have no business authorization errors; future 401/403/409/429 would lose their semantics. | Before introducing authenticated or business mutation routes: define safe typed error-to-HTTP mappings and contract/regression cases. Do not expose raw framework/provider errors or rely on hidden UI controls. |

Reassess the relevant item before starting its authorized unit. If a reproducible security/correctness failure is found, fix it with regression coverage before dependent feature work; otherwise keep the change scoped. Existing production-hardening/backup/provider limitations remain tracked in the delivery and operations documents, without duplicating them here.
