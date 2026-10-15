-- Additive administrative initial-check history; no legacy decision or assignment is rewritten.
CREATE TABLE confsys.review_screenings(
 id uuid PRIMARY KEY,submission_id uuid NOT NULL REFERENCES confsys.submissions(id),revision_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0),outcome text NOT NULL CHECK(outcome IN('ready','needs_correction','ineligible')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 2000),created_by uuid NOT NULL REFERENCES confsys.users(id),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(revision_id,submission_id) REFERENCES confsys.submission_revisions(id,submission_id),UNIQUE(revision_id,version)
);
GRANT SELECT,INSERT ON confsys.review_screenings TO confsys_app;
ALTER TABLE confsys.review_screenings ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.review_screenings FORCE ROW LEVEL SECURITY;
CREATE POLICY review_screenings_manager ON confsys.review_screenings TO confsys_app USING(current_setting('app.reviews_manage',true)='true') WITH CHECK(current_setting('app.reviews_manage',true)='true');
CREATE POLICY review_screenings_operator ON confsys.review_screenings TO confsys_migrator USING(true) WITH CHECK(true);
-- Reviewers can inspect only current status/version for their own assignment, never internal reasons.
CREATE VIEW confsys.review_screening_status AS
 SELECT DISTINCT ON(s.revision_id) s.revision_id,s.version,s.outcome
 FROM confsys.review_screenings s
 WHERE current_setting('app.reviews_manage',true)='true' OR EXISTS(SELECT 1 FROM confsys.review_assignments a WHERE a.revision_id=s.revision_id AND a.reviewer_id=nullif(current_setting('app.actor_id',true),'')::uuid)
 ORDER BY s.revision_id,s.version DESC;
GRANT SELECT ON confsys.review_screening_status TO confsys_app;
