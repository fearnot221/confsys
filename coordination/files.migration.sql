CREATE TABLE confsys.file_assets (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES confsys.users(id),
 purpose text NOT NULL CHECK(purpose IN ('manuscript','payment_evidence','site_media')),
 original_name text NOT NULL CHECK(length(original_name) BETWEEN 1 AND 180),
 media_type text NOT NULL CHECK(media_type IN ('application/pdf','image/png','image/jpeg')),
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 8388608),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 storage_key uuid NOT NULL UNIQUE,
 status text NOT NULL CHECK(status IN ('uploading','quarantined','ready','rejected')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX file_assets_owner ON confsys.file_assets(owner_id,created_at DESC,id);
-- References are inserted by trusted services in the same transaction as immutable snapshots.
CREATE TABLE confsys.file_references (
 file_id uuid NOT NULL REFERENCES confsys.file_assets(id),
 resource_type text NOT NULL CHECK(resource_type IN ('site_publication','submission_revision','payment_evidence')),
 resource_id uuid NOT NULL,
 PRIMARY KEY(file_id,resource_type,resource_id)
);
GRANT SELECT,INSERT ON confsys.file_assets,confsys.file_references TO confsys_app;
GRANT UPDATE(status) ON confsys.file_assets TO confsys_app;
-- No delete privilege: historical references and bytes cannot be silently rewritten.
