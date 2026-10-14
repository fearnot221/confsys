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
