# Roadmap

Scope follows SPEC. This delivery is limited to authorized Phase 1.3; later units still require approval.

| Phase | Status / scope |
|---|---|
| 0 | Implemented engineering foundation, real service UI, contracts, isolation tests, CI configuration and docs; evidence in PHASE0_DELIVERY |
| 1.1 | Implemented identity lifecycle/session plus required identity audit/outbox/worker/Mailpit; see PHASE1_1_DELIVERY |
| 1.1b | Single-conference deployment correction; runtime display, isolated resource template and dual-instance regression |
| 1.2 | Implemented fixed local roles/permissions, one-time operator CLI bootstrap, account management UI/API, reauthentication and audit; see PHASE1_2_DELIVERY |
| 1.3 | Implemented bounded settings/site draft, protected preview, immutable publication/history, initial HTML and official mail branding; see PHASE1_3_DELIVERY |
| Later Phase 1 | Not started: private files/media safety lifecycle, invitations and resource-specific permissions |
| 2 | Not started: registration, pricing, capacity, manual reconciliation, group payments, meals, receipts |
| 3 | Not started: submission, revisions, private content validation/quarantine |
| 4 | Not started: assignments, conflicts, review and decision publication |
| 5 | Not started: program, publication versions, oral/poster competitions |
| 6 | Not started: check-in/redemption, documents, notifications, exports, selected provider sandboxes |
| 7 | Not started: Claude read-only UI audit then isolated presentation PRs; end-to-end launch verification |

## Phase 1 increments (only 1.3 currently authorized)

1. **1.1 retained:** local registration/verification/reset/session, CSRF/Origin, audit/outbox/worker/Mailpit, race and crash recovery.
2. **1.1b retained:** correct single-conference model in contracts/config/Compose/UI/mail/docs/tests, same-build dual-instance isolation. No role/CMS/business modules.
3. **1.2 implemented:** fixed roles, explicit policies, one-time operator CLI bootstrap, bounded account UI/API, audited grant/revoke/status/session management and recent password proof. Resource/assignment/self-review exclusions await their real business modules. Administrator MFA remains a launch gate. Membership/scope-resolver and conference-switch plans remain cancelled.
4. **1.3 implemented:** bounded versioned conference/site configuration, dates/timezone/locales, protected saved-draft preview, immutable publications/history and public initial HTML/metadata. Currency/fees/deadlines belong to later business modules. Future reuse exports/imports whitelisted settings into a fresh instance; never clone account/business DBs.
5. **Later reliability:** local invitations and resource-specific notification policy; private file framework with validation/quarantine/download authorization. Preserve all original registration/finance/submission/review/competition/program/on-site/mail/statistics phases above.

Each unit needs real UI/API/errors/permissions/tests/docs. Stop after Phase 1.3 local commit; no implicit approval for files, invitations or later business work.

Open questions that do not block Phase 0: hosting, volumes/traffic, external mail/payment provider, SSO, receipt requirements, data retention and anonymization policy. No provider/production-readiness claim is made.

## Phase 0 maintainability review — 2026-10-15

Focused source review of baseline `c6f1d5f`, covering API/worker entry points, config, transaction helper/migrations, SDK/data hook, import checks, build distribution and tests. This review adds enduring requirements, not Phase 1 authorization. No full rewrite or new framework is justified by the present health-only API and synthetic worker.

At that Phase 0 baseline, boundaries were explicit: DTO/SDK/data hook/presentation are separated, `withTenant` uses transaction-local settings and a single checked-out client, and app/worker isolation is exercised by actual nonprivileged-role tests. No concrete safety/correctness blocker was demonstrated for the existing Phase 0 behavior in this focused review. This is not a comprehensive security assessment or permission to add business access without authorization.

| ID / evidence | Practical risk and scope | Treatment point and acceptance criteria |
|---|---|---|
| M1 — `packages/config/src/index.ts` requires both DB URLs; `compose.yaml` shares `&app-env` | Each process receives the other's credential and irrelevant settings. Both roles are currently restricted and expose no business API; this would undermine future least-privilege separation. Migration URL validation is also outside the common validator. | Before the first authorized Phase 1 identity/persistence slice: split validated API/worker/migration config entry points while reusing shared field schemas; give each container only its own credentials. Tests must prove independent startup and safe missing/invalid-env errors. Update examples/Compose/CI/docs together. |
| M2 — `apps/{api,worker}/src/main.ts`, worker processor and `packages/db/src/index.ts` | Redis error listeners discard details, worker/DB logs mix text and JSON, and readiness failure categories are coarse. They report failure rather than fake success, but diagnosis and cross-process correlation are weak. | In the next authorized reliability work, before persistent jobs: add consistent sanitized event/service/job/request/attempt context, documented deliberate suppression, outage/recovery tests and assertions that secrets never enter logs. Keep public health DTOs minimal. |
| M3 — `scripts/check-boundaries.mjs` and `eslint.config.mjs` | AST check assumes every feature has `components/` and allows a literal relative import instead of resolving a general graph; contracts lint checks named DB imports, not every indirect path. Current source follows the intended boundary, but module expansion may fail unnecessarily or expose blind spots. | Before adding the next feature/package: cover empty/absent presentation folders, permitted UI-to-UI imports and forbidden relative/aliased/re-export paths with regression fixtures. Extend checks only for demonstrated cases, without a new dependency framework. |
| M4 — root `package.json` build and `scripts/distribute-build.mjs` | `tsc` staging output is not cleaned before copying to package-local dist; deleted/renamed source can leave old compiled files. No stale route/module was demonstrated in the current tree; clean container builds avoid this inherited-output case. | Before the next source removal/move: clean only known generated outputs as part of build, and test build → delete a fixture source → rebuild excludes the old output. Preserve sources and unrelated files. |
| M5 — `apps/api/src/app.ts` error handler | All thrown 4xx statuses become 400. Current health-only routes have no business authorization errors; future 401/403/409/429 would lose their semantics. | Before introducing authenticated or business mutation routes: define safe typed error-to-HTTP mappings and contract/regression cases. Do not expose raw framework/provider errors or rely on hidden UI controls. |

Reassess the relevant item before starting its authorized unit. If a reproducible security/correctness failure is found, fix it with regression coverage before dependent feature work; otherwise keep the change scoped. Existing production-hardening/backup/provider limitations remain tracked in the delivery and operations documents, without duplicating them here.

## Phase 1.1 focused recheck — 2026-10-15

Baseline `c10b025` contains `c6f1d5f`; clean status and ancestry checked before branching. The historical M1–M5 descriptions above remain the evidence/acceptance baseline. Only blockers and directly adjacent work were changed:

| Item | Classification | Result and acceptance evidence |
|---|---|---|
| M1 | Blocking before identity persistence | Separate API/worker/migration validators and Compose env; host/E2E launcher filters child env. Worker cannot read identity credential tables or reassign notification recipients/tokens; API cannot SELECT delivery secrets or update unsupported identity fields. Additive 0003 narrows column grants. Unit config and actual-role integration tests. |
| M2 | Directly related; blocking before durable mail | Structured sanitized service/event/request/event-ID/attempt logs; safe public errors, durable minimal audit and explicit delivery states. Captured log secrecy, Redis/DB outage, real SMTP crash/recovery tests. No raw exception/body/query logging. Full metrics/alerting remains pre-launch work. |
| M3 | Directly related before adding auth feature/package | Resolver-based relative/alias/re-export checks, UI-to-UI allow rules, absent-folder support, automatic auth coverage. Regression fixtures reject escapes without an added dependency-graph framework. |
| M4 | Directly related to clean builds | Build clears only root staging and known package/app dist before compilation; compile → delete fixture source → clean/recompile test proves obsolete outputs disappear. Container and host build no longer depend on residual dist. |
| M5 | Blocking before auth mutations | Contract-owned error/status map and SDK preservation; auth regressions for 400/401/403/429/503 plus real framework 413/415. No blanket 4xx→400 behavior for supported statuses. |

## Remaining bounded debt / next treatment point

| Evidence | Practical risk | Acceptance and phase |
|---|---|---|
| Identity audit/token/session history has no retention sweep beyond delivery secrets | Long-running deployments grow tables; audit retention obligations are not decided | Before production and during Phase 1 reliability completion: agree retention policy, implement bounded dry-run/real purge preserving audit requirements, test backups/restore/key lifecycle. Do not improvise destructive cleanup now. |
| API has `trustProxy=false`; local capture proxy masks client IP | Shared source bucket can throttle multiple legitimate users behind the proxy | Deployment preparation before public use: explicit trusted proxy chain, spoofed-forwarded-header tests and per-source/account abuse review. Never enable arbitrary header trust. |
| Single active delivery-encryption key, capture-only sender, conservative unknown handling | Rotation requires draining; lost keys invalidate pending mail; unknown deliveries require operator diagnosis | Phase 1 reliability/provider unit: managed multi-version key lifecycle if operationally needed, controlled provider integration/metrics/runbook validation. No automatic unknown resend; preserve crash tests. |
| Local weak-password blocklist and configured Argon2 minimum, no breach corpus/load benchmark | Some common compromised passwords pass; production capacity is unmeasured | Before any production identity use: vetted broader offline/breach screening, password/Argon2 concurrency benchmarks and operational limits; no MFA/high-privilege readiness claim. |
| Basic auth UI uses existing engineering primitives; Chromium only | Complete accessibility and cross-browser assurance unavailable | Later presentation phase: Claude-owned accessibility/design audit; verify keyboard/assistive tech and browser matrix without moving SDK/permissions into components. |

## Phase 1.1b focused recheck — 2026-10-15

Verified `f1126ad` includes `c10b025`/`c6f1d5f`. M1–M5 fixes remain; no auth rewrite warranted. Current blockers addressed: hard-coded shared Compose name/ports, build/runtime display absence and contradictory product assumptions. Unused tenant helper/fixture retired with explicit replacement matrix in TESTING. Identity schema/migrations and least-privilege grants unchanged. All previous remaining debt above stays open.

Additional bounded debt: shared-host Docker projects do not constrain host/Docker administrators or guarantee CPU/memory availability. Before public deployment review network/firewall/resource limits and separate queue/cache services; validate TLS, secret management, backup/restore and exact image digests for each instance. Local loopback infra ports are a development convenience, not a production exposure policy.

No file adapter/metadata exists, so private file isolation is unimplemented and must be tested in its authorized unit. Runtime display env is intentionally minimal; editable/versioned settings and white-list import are future units. Update each instance independently using an explicit version/digest, documented config requirements, migration/backup/recovery; no central upgrade controller is planned here.

## Phase 1.2 focused Phase 0 baseline recheck — 2026-10-15

Verified 520607e contains ab7120f, f1126ad, c10b025 and c6f1d5f before creating the isolated branch/worktree. Rechecked M1–M5 against config/process grants, auth/service/repository/session/outbox, contracts/SDK/hooks/UI boundaries, migration ledger, build and tests. Existing fixes remain effective. No evidenced inherited blocker required unrelated restructuring. Existing credential_version and user locks support this unit; new management operations must share those fences rather than create a second revocation counter. New additive 0004, serialized access writes, operator-only bootstrap and real failure/race tests close this unit's correctness requirements. Historical approvals are not perpetual approval.

| New evidence | Practical risk | Acceptance / treatment |
|---|---|---|
| Bounded offset directory/audit with literal substring scan | Large accounts/audit tables can increase scan cost; pages shift while concurrent rows are inserted | Before measured large-event rollout: benchmark representative synthetic volumes, add keyset pagination/search indexes if needed, preserve strict projection/permissions and add cursor/filter tests. Current max 50 page / 100000 offset is not an export facility. |
| Single-control-row locking for rare administration | Long transactions can delay management requests | Before scaling administration: monitor safe timeout metrics, load-test lock contention; retain post-lock actor revalidation and invariant tests. No unmeasured permission cache/engine now. |
| Bootstrap intentionally stays closed after completion | All admin credentials lost requires controlled recovery | Before privileged production operation: review a separate audited, operator-authenticated recovery procedure with MFA and backup rehearsal; no force-admin flag or marker-reset product. |
| Account UI has email/UUID and no profile/name editing | Directory can only search actual existing identity fields | Future profile/settings unit: define owned fields and privacy rules before adding names; do not mislabel registration as conference participation. |

All previous debt remains: MFA launch gate, rotation, trusted proxy/IP limits, stronger password screening/Argon2 capacity, retention, TLS, backup restore, external-provider readiness, full accessibility/browser matrix and shared-host limits. Next minimal unit proposed for approval: versioned local conference settings/public website; invitations and other business phases remain separate authorization decisions.

## Phase 1.3 focused Phase 0 baseline recheck — 2026-10-15

Read code/config/migrations/CI and confirmed 9d3e788 contains cc2361d, 520607e, ab7120f, f1126ad, c10b025, c6f1d5f. M1–M5 remain effective; no broad architecture rewrite needed. 0004's control/user/session lock and recent proof can be reused without a second revocation mechanism. An evidenced adjacent correctness issue: production ingress did not map `/access/accounts` to its SPA; fixed and exercised via the container route path. Malformed URL parsing remains contained as a 400 response (not an unhandled process rejection); container regression verifies subsequent liveness. The dual-instance harness now uses run-specific localhost names to avoid retained-test Cookie hostname collisions. Public-only SSR now has a precise separate import boundary; the existing checks were not globally relaxed.

| Evidence / debt | Practical risk | Acceptance / phase |
|---|---|---|
| All site private operations share the access singleton; publication history uses bounded 20-row offset pages | Long admin transactions block others; pages shift on concurrent insertions | Before measured administrative scale: bounded lock/timeout monitoring and load tests; keep post-lock revalidation and exact-version conflict tests. Keyset pagination only if measured need. |
| JSON snapshot schema version 1, no arbitrary renderer or import | Future schema changes need deliberate compatibility; archives cannot silently change meaning | At the next authorized schema change: decoder/migration strategy, immutable historical fixtures and roll-forward tests; never edit old snapshots in place. |
| Public-only renderer rebuilt as an artifact in host dev | Shared presentation edits need build:public; stale local artifact can confuse developers | Documented developer command; future developer-experience work may automate rebuilding with tested watcher lifecycle. Production already builds both artifacts together. |
| Minimal native editing forms and text history summary | Field comparison is manual; no full accessibility/browser audit | Later Claude presentation unit: keyboard/assistive-tech audit, ergonomic comparison, keep SDK/data/permission ownership and regression assertions. |

All prior security/operations debt remains: MFA, TLS, trustProxy/IP limits, encryption-key rotation, password screening/Argon2 capacity, retention, backup restore, real providers, load, WCAG and shared-host resource risks. Next minimal unit for new approval: private files/media metadata, bounded content validation/quarantine, authorized access and lifecycle; then invitations/registration per the existing roadmap. None implemented here.
