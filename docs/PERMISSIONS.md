# Permissions and tenant isolation

## Current enforcement

Public infrastructure liveness/readiness endpoints remain available. They disclose status booleans only, no tenant data, connection strings or dependency exceptions. Unknown routes return structured 404. Phase 1.1 adds identity-only account endpoints; no user-controlled tenant context endpoint or conference business API exists.

Database app/worker logins cannot bypass RLS, own tables, assume migration role, ALTER policies or TRUNCATE test tenant tables. Transaction-scoped RLS fixture policies enforce organization AND conference on SELECT, INSERT, UPDATE and DELETE. Read/update/delete of invisible rows return no rows; forbidden insert/scope mutation raises insufficient privilege. Tests run as actual logins, not privileged clients with SET ROLE. Composite FK tests reject references to hidden parents.

## Planned Phase 1 matrix — not implemented

| Principal / scope | Planned permissions | Exclusions |
|---|---|---|
| Anonymous | Explicit published conference projection | drafts, participant data, internal configuration |
| Platform operator | organization lifecycle and platform configuration | sensitive tenant data without audited, time-limited support path |
| Organization admin | organization settings, create conference, bounded delegation | automatic access to every conference's manuscript/finance data |
| Conference admin / secretariat | authorized conference settings and administration | other conferences, even in same organization |
| Finance / conference | orders, reconciliation, receipts | blind review content |
| Chair / conference or track | assignment and decision actions | self-review or conflicted work |
| Reviewer / assignment | accepted assignments and permitted DTO fields | unassigned work, hidden author identity |
| Judge / competition assignment | allocated entries and rubric | unrelated entries or own work |
| On-site staff / conference | minimal check-in/redemption fields | unrestricted exports, full manuscripts |
| Author / own resource | own authorized submissions/registration | other users' private records |

Resolve session → subject → active membership → conference/resource → action policy before setting DB scope. Organization membership alone is not conference access. Fail closed on missing context, revoked membership or ambiguous scope. Use role templates + granular permissions + resource relationships, not arbitrary tenant-supplied policy code.

Sessions will be opaque server-side, hashed in DB with rotation/revocation. Cookies: host-only, Secure, HttpOnly, appropriate SameSite; writes require CSRF + Origin checks. High privilege requires MFA before launch. Phase 0 did not implement these guarantees. Phase 1.1 implements session/cookie/CSRF with regression evidence in its delivery; MFA and membership permissions remain pending.

Required Phase 1 regression gates: cross-organization AND same-organization cross-conference reads/writes; ID substitution; revoked permissions; cache clear on conference switch/logout; private downloads reauthorize; published projection excludes drafts. No frontend visibility check substitutes for backend authorization.

## Phase 1.1 enforced identity permissions

Anonymous users can request verification/reset mail with indistinguishable accepted responses, or explicitly submit a one-time token and password. Only pending identities can activate; only active identities can reset/login. Disabled accounts cannot activate, reset, obtain or use a normal session. `/api/auth/me` resolves only the session owner; no user ID or organization ID override exists. Login creates no organization/conference permission.

API runtime can read/update identity credentials and insert audit/outbox. Worker can read the notification eligibility view, read/delete short-lived encrypted delivery secrets, update delivery states and insert audit; it cannot SELECT password/session/token tables, SET ROLE migrator or bypass RLS. API cannot SELECT encrypted delivery secrets. Identity access is a distinct global module, never a `withTenant` exception. Existing actual app/worker cross-organization, same-organization cross-conference, missing-context and pool-reuse tests remain required.

No account administration, role field, impersonation, invitation or high-privilege login is shipped. High-privilege accounts require MFA before any production launch. The SQL view's definer behavior exposes only the reviewed identity eligibility projection; it does not query tenant tables. Adding tenant mail requires new scoped policies/grants, not broadening this view to arbitrary resources.
