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
5. Connects using the real restored `confsys_app` login: missing context and foreign owner must see no private files/references, owner access must succeed, and transaction-local context must clear on pooled reuse. Application and worker roles must remain NOSUPERUSER/NOBYPASSRLS.

Artifacts live in ignored `.restore-drills/<run>/`: private `backup/database.dump`, SHA256 manifest/files, `backup/source.env`, new `restore.env`, and `evidence.json`. Secrets remain mode0600. Retaining the original MAIL_ENCRYPTION_KEY, MAIL_KEY_VERSION, CSRF_SIGNING_KEY and QR_SIGNING_KEY is deliberate for this same-instance recovery; original DB credentials are archived only for evidence and the restored runtime uses fresh DB passwords. This local synthetic artifact bundle is not encrypted at rest by the script.

No worker, mail service, API or external provider starts in the restored project. Source containers/volumes/data are never modified. On failure, inspect the new private evidence and retain the new resources for diagnosis; do not reuse/overwrite a partial target or delete original volumes. Cleanup is an operator action scoped to the exact recorded restore project and private volume, never a global prune.

After the source is ready to resume, the operator uses its original exact env/project and existing native scanner override if applicable. Do not start the restored clone as a second active instance or a new conference.
