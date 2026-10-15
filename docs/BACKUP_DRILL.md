# Synthetic same-instance backup / restore drill

This executable drill validates disaster recovery of **one existing synthetic conference instance**. It is not a production backup policy and must never be used to bootstrap a different conference with cloned users, sessions or cryptographic keys.

Prerequisites:

- Node24.21.0, installed repository dependencies, Docker Desktop and a successfully completed current `scripts/test-instances.ts` run.
- Explicit source `.instances/<8-hex-run>/a.env` or `b.env`, private mode0600, matching `confsys-p6-<run>-a/b` container/volume labels and completed evidence including real private upload/submission references.
- Operator pauses only that generated instance's API and worker using its exact env/project; PostgreSQL remains running. The drill refuses running writers and never stops/restarts the source itself. Keep writers paused until the command completes; source files are mounted readonly.

Example for the operator, replacing only the verified generated env path:

```
CONFSYS_ENV_FILE=.instances/<run>/a.env node --conditions=development --import tsx scripts/compose.mjs --profile app stop api worker
node --conditions=development --import tsx scripts/backup-drill.ts --source-env .instances/<run>/a.env --validate-only
node --conditions=development --import tsx scripts/backup-drill.ts --source-env .instances/<run>/a.env
```

`--validate-only` performs read-only identity/evidence/paused-writer checks. It creates no restore resources. The actual drill:

1. Dumps the full source database in PostgreSQL custom format using its container-local operator, including FORCE RLS data. It copies private files from the exact readonly source volume and validates all ready/referenced files against persisted SHA256 and size. Symlinks, unexpected names, oversized files, missing/corrupt manifests and nonempty destinations fail closed. Bound:1000 files,8MiB/file,1GiB total.
2. Captures schema migration checksums, every business table row count, sequence positions, file/reference metadata and hashes/counts of nonnull generated badge PDFs and export CSVs. A zero generated-artifact count means there were none in that fixture; it is not evidence that a generated artifact was restored.
3. Creates a fresh `confsys-drill-<run>` PostgreSQL project on a reserved free loopback port, with freshly generated database credentials. It refuses any preexisting target resource or nonempty target database. Restoration is a single transaction under `confsys_migrator`, retaining application grants/RLS. Source and restore PostgreSQL image IDs must match.
4. Creates a new private volume, copies bytes with exclusive file creation, fsyncs/re-reads hashes, and restores node UID/GID1000 ownership and0700/0600 modes. The helper has no network, readonly root filesystem, all capabilities dropped except DAC_OVERRIDE/CHOWN for the explicitly mounted private files and fresh destination. It uses the same tested application image, not an unpinned utility image.
5. Uses the shared production crypto helpers to decrypt a source-key envelope probe with the recovered mail key, decrypt every retained notification envelope and recompute every retained QR token hash. Evidence reports actual stored sample counts; zero means that fixture contained no retained sample. Tokens/plaintext are never logged.
6. Connects using the real restored `confsys_app` login: missing context and foreign owner must see no private files/references, owner access must succeed, and transaction-local context must clear on pooled reuse. Application and worker roles must remain NOSUPERUSER/NOBYPASSRLS.

Artifacts live in ignored `.restore-drills/<run>/`: private `backup/database.dump`, SHA256 manifest/files, `backup/source.env`, new `restore.env`, and `evidence.json`. Secrets remain mode0600. Retaining the original MAIL_ENCRYPTION_KEY, MAIL_KEY_VERSION, CSRF_SIGNING_KEY and QR_SIGNING_KEY is deliberate for this same-instance recovery; original DB credentials are archived only for evidence and the restored runtime uses fresh DB passwords. This local synthetic artifact bundle is not encrypted at rest by the script.

No worker, mail service, API or external provider starts in the restored project. Source containers/volumes/data are never modified. On failure, inspect the new private evidence and retain the new resources for diagnosis; do not reuse/overwrite a partial target or delete original volumes. Cleanup is an operator action scoped to the exact recorded restore project and private volume, never a global prune.

After the source is ready to resume, the operator uses its original exact env/project and existing native scanner override if applicable. Do not start the restored clone as a second active instance or a new conference.

## Non-empty recovery samples

For the next fresh two-instance run, add `--restore-fixtures` to the existing command, for example:

```sh
pnpm test:instances --image confsys:<new-tested-tag> --native-scanner --scanner-port 53310 --restore-fixtures
```

The flag retains every original isolation check. After those pass, the harness verifies this run's `.instances/<run>/a.env`, exact A project, origin, immutable API/worker image and running state. Through actual authenticated APIs it configures a free synthetic ticket, registers the existing synthetic administrator, creates a private QR pass, requests a badge PDF and a CSV export, waits for the real worker, downloads the results and compares their hashes with persisted bytes. It then stops **only this A worker** and calls the real registration-mail API for a fresh synthetic address, leaving a pending encrypted notification. SQL is read-only verification; it does not manufacture generated files or queue payloads.

The evidence includes nonzero sample counts, artifact IDs, byte lengths and hashes; it never includes QR tokens, passwords or encrypted envelopes. A failed enrichment records `restoreFixtures.status=failed` while preserving the completed original isolation checks, and the harness exits unsuccessfully. It does not turn an enrichment failure into a successful restore claim. `--prepare-only` only records the selected option and never creates samples.

After successful enrichment, A's API remains active and its worker remains intentionally stopped. Before running `backup-drill.ts`, stop A's API with that exact run's environment file, leaving PostgreSQL available. Do not restart A's worker until the backup is captured, or the pending encrypted-mail sample may be consumed. The backup script independently verifies stopped writers. Use the same run's A source for this drill; B is unchanged and does not receive enrichment samples. This remains recovery of the same conference and keys, never bootstrap of a different conference.

The drill now connects with the **restored worker credentials**, checks its actual login and `NOSUPERUSER` / `NOBYPASSRLS`, and verifies all three export source views deny both missing and forged job/claim context. It also checks every restored document/export job (bounded at 1,000 per table) through the actual app login: missing context and a foreign actor cannot see it; its requester with the corresponding module context can; context disappears after each transaction. Counts are recorded even when a legacy fixture contains no generated jobs, so zero is not mistaken for exercised ownership coverage.

QR verification compares source and restored token rows plus their validity under each environment's current key. Legitimate stale rows left after key rotation are reported separately as `restoredQrStaleCount`; any changed row or validity classification fails. A completed A-instance `--restore-fixtures` sample must still contain the **specific current valid QR token hash recorded by enrichment**, preventing a failed fixture MAC from being relabeled stale. The report contains counts only, never QR bearer tokens, signing keys or encrypted mail contents.

Source-only verification on 2026-10-15 08:19 Taipei: `pnpm exec vitest run tests/unit/restore-qr-check.test.ts` — 3/3; `pnpm typecheck` and targeted ESLint passed. The unit suite covers valid plus stale rows, exact source/restored differences, wrong keys, missing or invalid enriched fixture, bounds, and explicitly empty legacy evidence. These changes require a new real restore rehearsal before claiming the additional database checks passed; no containers or PostgreSQL tests were launched for this source change.
