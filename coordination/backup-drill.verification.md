# Backup drill implementation checkpoint

Source-only delivery: `scripts/backup-drill.ts`, bounded container entrypoint `private-volume-copy.mjs`, dependency-free tested copier `private-volume-copy.ts`, and `docs/BACKUP_DRILL.md`. Main owns `.gitignore` addition `.restore-drills/`.

Executed:
- `pnpm exec tsc --noEmit -p tsconfig.json`: passed.
- Targeted eslint of all three scripts and test: passed.
- `pnpm exec vitest run tests/unit/backup-drill.test.ts`:3/3 passed at07:35:44. Actual temp files verify backup→fresh restore bytes/checksum/private modes; nonempty destination, corrupted bytes, null manifest, symlinks, unexpected filename and >8MiB file are rejected.

No source containers stopped or mutated and no restore containers/volumes launched by this agent. Main executes actual drill only after completed two-instance evidence and explicit pause of the selected new source API/worker. Full dump/restore/runtime-RLS result remains unverified until that real run.

Maintainability: existing setup/Compose and PostgreSQL runtime identity helper reused; no dependency additions. Small filesystem copier is independently testable, while orchestration owns exact resource identities and evidence. Scripts never log archived secrets/manuscript bytes; failure artifact records error type and completed checks, not assertion dumps. Local artifacts retain synthetic keys mode0600 and are explicitly same-instance disaster recovery only.
