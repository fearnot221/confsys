# Permissions and tenant isolation

## Current enforcement

Only public infrastructure liveness/readiness endpoints exist. They disclose status booleans only, no tenant data, connection strings or dependency exceptions. Unknown routes return structured 404. There is no identity, cookie, token, login, user-controlled tenant context endpoint or business API.

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

Sessions will be opaque server-side, hashed in DB with rotation/revocation. Cookies: host-only, Secure, HttpOnly, appropriate SameSite; writes require CSRF + Origin checks. High privilege requires MFA before launch. None of these login guarantees have been implemented or tested in Phase 0.

Required Phase 1 regression gates: cross-organization AND same-organization cross-conference reads/writes; ID substitution; revoked permissions; cache clear on conference switch/logout; private downloads reauthorize; published projection excludes drafts. No frontend visibility check substitutes for backend authorization.
