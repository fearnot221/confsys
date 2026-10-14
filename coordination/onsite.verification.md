# Onsite checkpoint (2026-10-15 06:40 Asia/Taipei)

API `createOnsiteService` / `registerOnsiteRoutes`; SDK `createOnsiteClient`; UI `useOnsite(administrative)` -> `OnsiteScreen` (props only). Main wiring routes suggested `/onsite/pass` and `/admin/onsite`. Participant pass is owner-only; onsite role staff uses manual/USB scanner code, restricted directory, checkin/redeem; admin can reverse with reason. QR is not a session credential and has no unauthenticated lookup. Key rotation invalidates earlier codes; participant can explicitly rotate.

Main-owned migration0019 and registry central contracts consumed. Operations use shared access/session fence then registration_state lock, same as registration/payment/cancellation. Eligibility is confirmed + fully settled original registration order, and separately settled reserved activity booking. Narrow settlement view avoids broad finance privilege. No paid provider assumed; free synthetic fixtures qualify.

Verification executed:
- `PATH=/tmp/confsys-tools/node_modules/.bin:$PATH pnpm typecheck`: pass.
- `PATH=/tmp/confsys-tools/node_modules/.bin:$PATH pnpm exec eslint apps/api/src/onsite packages/sdk/src/onsite.ts apps/web/src/features/onsite tests/integration/onsite.test.ts tests/unit/onsite.test.ts`: pass before HTTP test addition.
- `PATH=/tmp/confsys-tools/node_modules/.bin:$PATH pnpm exec vitest run tests/unit/onsite.test.ts tests/unit/documents.test.ts`: 4/4 pass.
- `PATH=/tmp/confsys-tools/node_modules/.bin:$PATH CONFSYS_ENV_FILE=/Users/fearnot/Desktop/confsys-phase-1-4-to-6-continuous/.env node --env-file=/Users/fearnot/Desktop/confsys-phase-1-4-to-6-continuous/.env node_modules/vitest/vitest.mjs run tests/integration/onsite.test.ts`: 4/4 pass06:39:40 before adding HTTP fifth test (await serialized slot). Real nonprivileged PG/worker roles, owner separation, rotated tokens, current key validation, concurrency cap, idempotent retry, rollback on audit failure, onsite revocation, immutable reversal. HTTP test authored but not yet run.

Maintainability: handler owns transport/CSRF; service owns permission and transaction; repository owns scoped queries; token helper only cryptography; SDK owns network; hook owns remote state and replay keys; presentation receives callbacks. No second permission registry/money state rules. Parent settlement projection is authoritative. Current manual ID entry for participant needs registration link integration; batch badge worker follows next. Camera scanner is not claimed. No mock data or external side effects.
