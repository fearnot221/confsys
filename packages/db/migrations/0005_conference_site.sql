-- One bounded site aggregate per independently deployed database.
CREATE TABLE confsys.site_publications (
 id uuid PRIMARY KEY,
 source_draft_version integer NOT NULL UNIQUE CHECK (source_draft_version > 0),
 document jsonb NOT NULL CHECK (document->>'schemaVersion' = '1'),
 published_at timestamptz NOT NULL DEFAULT now(),
 published_by uuid NOT NULL REFERENCES confsys.users(id),
 changed_fields jsonb NOT NULL
);
CREATE TABLE confsys.site_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 draft_version integer NOT NULL DEFAULT 0 CHECK (draft_version >= 0),
 document jsonb,
 active_publication_id uuid REFERENCES confsys.site_publications(id),
 CHECK ((draft_version = 0) = (document IS NULL))
);
INSERT INTO confsys.site_state(singleton) VALUES (true);
CREATE INDEX site_publications_history ON confsys.site_publications(published_at DESC,id DESC);
GRANT SELECT ON confsys.site_state,confsys.site_publications TO confsys_app;
GRANT UPDATE(draft_version,document,active_publication_id) ON confsys.site_state TO confsys_app;
GRANT INSERT ON confsys.site_publications TO confsys_app;
-- Runtime has no update/delete privilege on immutable publications.
ALTER TABLE confsys.notifications ADD COLUMN conference_name text CHECK (length(conference_name) BETWEEN 1 AND 160);
GRANT INSERT(conference_name) ON confsys.notifications TO confsys_app;
-- Existing SELECT on notifications lets worker read the immutable creation snapshot.
