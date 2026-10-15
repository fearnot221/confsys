ALTER TABLE confsys.user_roles DROP CONSTRAINT user_roles_role_check;
ALTER TABLE confsys.user_roles ADD CONSTRAINT user_roles_role_check CHECK(role IN('conference_staff','conference_admin','finance','chair','reviewer'));
ALTER TABLE confsys.role_invitations DROP CONSTRAINT role_invitations_role_check;
ALTER TABLE confsys.role_invitations ADD CONSTRAINT role_invitations_role_check CHECK(role IN('conference_staff','conference_admin','finance','chair','reviewer'));
CREATE TABLE confsys.review_forms (
 id uuid PRIMARY KEY, version integer NOT NULL UNIQUE CHECK(version>0),
 document jsonb NOT NULL, created_by uuid NOT NULL REFERENCES confsys.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE confsys.review_chair_scopes (
 user_id uuid NOT NULL REFERENCES confsys.users(id), track_id text NOT NULL CHECK(length(track_id) BETWEEN 1 AND 80),
 PRIMARY KEY(user_id,track_id)
);
CREATE TABLE confsys.review_conflicts (
 submission_id uuid NOT NULL REFERENCES confsys.submissions(id), user_id uuid NOT NULL REFERENCES confsys.users(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(submission_id,user_id)
);
CREATE TABLE confsys.review_assignments (
 id uuid PRIMARY KEY, submission_id uuid NOT NULL REFERENCES confsys.submissions(id), revision_id uuid NOT NULL,
 reviewer_id uuid NOT NULL REFERENCES confsys.users(id), form_id uuid NOT NULL REFERENCES confsys.review_forms(id),
 state text NOT NULL CHECK(state IN ('invited','accepted','declined','conflicted','submitted')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 anonymous_confirmed boolean NOT NULL DEFAULT false,
 document jsonb NOT NULL DEFAULT '{"scores":[],"authorComment":"","privateComment":""}'::jsonb,
 created_by uuid NOT NULL REFERENCES confsys.users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(revision_id,submission_id) REFERENCES confsys.submission_revisions(id,submission_id), UNIQUE(revision_id,reviewer_id)
);
CREATE INDEX review_assignments_reviewer ON confsys.review_assignments(reviewer_id,created_at DESC);
CREATE TABLE confsys.review_decisions (
 id uuid PRIMARY KEY, submission_id uuid NOT NULL REFERENCES confsys.submissions(id), revision_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0), outcome text NOT NULL CHECK(outcome IN ('accept_oral','accept_poster','reject','revision_requested')),
 author_message text NOT NULL CHECK(length(author_message) BETWEEN 1 AND 4000), internal_reason text NOT NULL CHECK(length(internal_reason) BETWEEN 3 AND 4000),
 revision_deadline timestamptz, decided_by uuid NOT NULL REFERENCES confsys.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(revision_id,submission_id) REFERENCES confsys.submission_revisions(id,submission_id), UNIQUE(submission_id,version), UNIQUE(id,submission_id),
 CHECK((outcome='revision_requested')=(revision_deadline IS NOT NULL))
);
CREATE TABLE confsys.review_publications (
 submission_id uuid PRIMARY KEY REFERENCES confsys.submissions(id), decision_id uuid NOT NULL,
 published_by uuid NOT NULL REFERENCES confsys.users(id), published_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(decision_id,submission_id) REFERENCES confsys.review_decisions(id,submission_id)
);
GRANT SELECT,INSERT ON confsys.review_forms,confsys.review_conflicts,confsys.review_decisions TO confsys_app;
GRANT SELECT,INSERT,DELETE ON confsys.review_chair_scopes TO confsys_app;
GRANT SELECT,INSERT ON confsys.review_assignments,confsys.review_publications TO confsys_app;
GRANT UPDATE(state,version,document,updated_at) ON confsys.review_assignments TO confsys_app;
GRANT UPDATE(decision_id,published_by,published_at) ON confsys.review_publications TO confsys_app;
-- Services additionally enforce author-email conflict, role, active session, and track scope.
CREATE POLICY revisions_assigned_review ON confsys.submission_revisions FOR SELECT TO confsys_app USING(
 owner_id<>nullif(current_setting('app.actor_id',true),'')::uuid AND
 NOT EXISTS(SELECT 1 FROM confsys.review_conflicts c WHERE c.submission_id=confsys.submission_revisions.submission_id AND c.user_id=nullif(current_setting('app.actor_id',true),'')::uuid) AND
 EXISTS(SELECT 1 FROM confsys.review_assignments a WHERE a.revision_id=confsys.submission_revisions.id AND a.reviewer_id=nullif(current_setting('app.actor_id',true),'')::uuid AND a.state IN('invited','accepted','submitted')));
CREATE POLICY submissions_assigned_review ON confsys.submissions FOR SELECT TO confsys_app USING(
 owner_id<>nullif(current_setting('app.actor_id',true),'')::uuid AND EXISTS(SELECT 1 FROM confsys.review_assignments a WHERE a.submission_id=confsys.submissions.id AND a.reviewer_id=nullif(current_setting('app.actor_id',true),'')::uuid AND a.state IN('invited','accepted','submitted')));
CREATE TABLE confsys.submission_revision_requests (
 id uuid PRIMARY KEY, submission_id uuid NOT NULL REFERENCES confsys.submissions(id), revision_id uuid NOT NULL,
 decision_id uuid NOT NULL UNIQUE REFERENCES confsys.review_decisions(id), deadline timestamptz NOT NULL, published_at timestamptz NOT NULL DEFAULT now(),
 new_revision_id uuid,
 FOREIGN KEY(revision_id,submission_id) REFERENCES confsys.submission_revisions(id,submission_id),
 FOREIGN KEY(new_revision_id,submission_id) REFERENCES confsys.submission_revisions(id,submission_id)
);
GRANT SELECT,INSERT ON confsys.submission_revision_requests TO confsys_app;
GRANT UPDATE(new_revision_id) ON confsys.submission_revision_requests TO confsys_app;
-- Private scoring/decision rows are not visible to an ordinary author connection.
ALTER TABLE confsys.review_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.review_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY review_assignments_actor ON confsys.review_assignments TO confsys_app USING(current_setting('app.reviews_manage',true)='true' OR reviewer_id=nullif(current_setting('app.actor_id',true),'')::uuid) WITH CHECK(current_setting('app.reviews_manage',true)='true' OR reviewer_id=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE POLICY review_assignments_operator ON confsys.review_assignments TO confsys_migrator USING(true) WITH CHECK(true);
ALTER TABLE confsys.review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.review_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY review_decisions_manager ON confsys.review_decisions TO confsys_app USING(current_setting('app.reviews_manage',true)='true') WITH CHECK(current_setting('app.reviews_manage',true)='true');
CREATE POLICY review_decisions_operator ON confsys.review_decisions TO confsys_migrator USING(true) WITH CHECK(true);
CREATE VIEW confsys.review_author_results AS
 SELECT s.id AS submission_id,d.outcome,d.author_message,d.revision_deadline,p.published_at,
 ARRAY(SELECT a.document->>'authorComment' FROM confsys.review_assignments a WHERE a.revision_id=d.revision_id AND a.state='submitted' ORDER BY a.id) AS author_comments
 FROM confsys.submissions s JOIN confsys.review_publications p ON p.submission_id=s.id JOIN confsys.review_decisions d ON d.id=p.decision_id
 WHERE s.owner_id=nullif(current_setting('app.actor_id',true),'')::uuid;
GRANT SELECT ON confsys.review_author_results TO confsys_app;
