# Main integrator handoff

- Copy contracts proposal to packages/contracts/src/files.ts and export centrally; register endpoints in OpenAPI generator.
- Include migration proposal in main-owned next migration. Need runtime app read/insert/status update, no bytes/key/owner metadata rewrite grants.
- Config: PRIVATE_STORAGE_ROOT absolute private directory; CLAMAV_HOST default 127.0.0.1 and CLAMAV_PORT default 3310. Server config passed as `FileStorageConfig` fourth argument (`createFilesService(pool, config, storageConfig)`). No global env read in files modules.
- Select/pin sharp in API dependencies for safe PNG/JPEG re-encoding. clamd local only; TCP INSTREAM and 15 s timeout. Scan error retains quarantined file. Client can request retry.
- Main `main.ts`: registerFilesRoutes(app,config,createFilesService(pool,config,{root:config.PRIVATE_STORAGE_ROOT,scannerHost:config.CLAMAV_HOST,scannerPort:config.CLAMAV_PORT})).
- Main SDK index export createFilesClient from files.ts; app route `/account/files` renders `<FilesScreen {...useFiles()} />`.
- Add explicit files.media.manage permission only conference_admin. Normal active users can upload/list/download their own manuscript/payment evidence; media manager lists all site_media only (never all manuscripts).
- Site contract add optional media `{logoId:uuid|null,heroId:uuid|null}` with backward compatibility; on save call `validateMediaReferences(db,ids)`; on publish `referenceMedia(db,ids,publicationId)` after insert and within same transaction. This requires existing site write permission + files.media.manage for media editing. Public route is `/api/media/:id`; it only serves ready site_media referenced by active site publication (old immutable refs remain but old no longer public). Render public images from those paths. Draft previews use authenticated `/api/files/:id/download`.
- No storage listing static middleware. No public disclosure by guessed key. Owner and permission revalidated on every retry/download; uploads revalidate after scan I/O. Scan I/O happens outside database transaction and access lock.
