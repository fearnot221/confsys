# Scan transition audit correction

`setStatus` returns whether its conditional update changed one row, excluding same-state writes. `finishScan` records a transition event only when that update succeeds and re-reads the persisted row for all responses. Concurrent losers therefore return the winner's state without false terminal or quarantine events. `finishTransfer` is the only other caller and intentionally ignores the result for idempotent fail-closed transfer completion; it does not emit scan events.

The integration regression uses actual PostgreSQL/app credentials, real private bytes, and the real local ClamAV scanner for the successful winner. A separate local TCP endpoint delays an unavailable scanner response until that winner completes. Both calls must return ready; only the winning request receives a `file.scan_ready` audit. Existing EICAR, content validation, RLS, reference, publication, HTTP and cleanup cases remain intact.

Static verification: `pnpm typecheck`; targeted ESLint for both changed file modules and the integration suite; `pnpm exec vitest run tests/unit/files.test.ts` (4/4 at 08:35 Taipei). `node --env-file=/Users/fearnot/Desktop/confsys-phase-1-4-to-6-continuous/.env node_modules/vitest/vitest.mjs run tests/integration/files.test.ts` passed **6/6** at 08:35:45 Taipei (1.23 seconds), against canonical migrations through 0058 and the actual native ClamAV instance. PG slot released immediately.

Maintainability: no migration, contract, dependency or new production abstraction. Status mutation remains in repository, audit/transaction in service, HTTP untouched. The existing scanner idle-only timeout is unchanged and remains bounded operational follow-up debt; this commit does not claim a wall-clock deadline.
