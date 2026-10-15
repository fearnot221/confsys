CREATE TABLE confsys.submission_config (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 version integer NOT NULL DEFAULT 0 CHECK(version >= 0),
 document jsonb NOT NULL DEFAULT '{"opensAt":null,"closesAt":null,"requireRegistration":false,"requireAttachment":false,"tracks":[]}'::jsonb
);
INSERT INTO confsys.submission_config(singleton) VALUES(true);
CREATE TABLE confsys.submissions (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES confsys.users(id),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','submitted','withdrawn')),
 version integer NOT NULL CHECK(version > 0), submitted_version integer,
 document jsonb NOT NULL, current_revision_id uuid, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,owner_id), CHECK((submitted_version IS NULL)=(current_revision_id IS NULL)),
 CHECK(submitted_version IS NULL OR submitted_version<=version),
 CHECK(state <> 'submitted' OR current_revision_id IS NOT NULL)
);
CREATE TABLE confsys.submission_revisions (
 id uuid PRIMARY KEY, submission_id uuid NOT NULL, owner_id uuid NOT NULL,
 version integer NOT NULL CHECK(version > 0), document jsonb NOT NULL, submitted_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(submission_id,owner_id) REFERENCES confsys.submissions(id,owner_id),
 UNIQUE(submission_id,version), UNIQUE(id,submission_id)
);
ALTER TABLE confsys.submissions ADD CONSTRAINT submission_current_revision FOREIGN KEY(current_revision_id,id) REFERENCES confsys.submission_revisions(id,submission_id);
CREATE INDEX submissions_owner ON confsys.submissions(owner_id,updated_at DESC,id);
CREATE INDEX submissions_admin ON confsys.submissions(updated_at DESC,id);
ALTER TABLE confsys.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.submissions FORCE ROW LEVEL SECURITY;
ALTER TABLE confsys.submission_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.submission_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY submissions_read ON confsys.submissions FOR SELECT TO confsys_app USING(owner_id=nullif(current_setting('app.actor_id',true),'')::uuid OR current_setting('app.submissions_admin',true)='true');
CREATE POLICY submissions_insert ON confsys.submissions FOR INSERT TO confsys_app WITH CHECK(owner_id=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE POLICY submissions_update ON confsys.submissions FOR UPDATE TO confsys_app USING(owner_id=nullif(current_setting('app.actor_id',true),'')::uuid) WITH CHECK(owner_id=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE POLICY revisions_read ON confsys.submission_revisions FOR SELECT TO confsys_app USING(owner_id=nullif(current_setting('app.actor_id',true),'')::uuid OR current_setting('app.submissions_admin',true)='true');
CREATE POLICY revisions_insert ON confsys.submission_revisions FOR INSERT TO confsys_app WITH CHECK(owner_id=nullif(current_setting('app.actor_id',true),'')::uuid);
GRANT SELECT,INSERT ON confsys.submissions,confsys.submission_revisions TO confsys_app;
GRANT UPDATE(state,version,submitted_version,document,current_revision_id,updated_at) ON confsys.submissions TO confsys_app;
GRANT SELECT ON confsys.submission_config TO confsys_app;
GRANT UPDATE(version,document) ON confsys.submission_config TO confsys_app;

CREATE POLICY submissions_operator ON confsys.submissions TO confsys_migrator USING(true) WITH CHECK(true);
CREATE POLICY revisions_operator ON confsys.submission_revisions TO confsys_migrator USING(true) WITH CHECK(true);
