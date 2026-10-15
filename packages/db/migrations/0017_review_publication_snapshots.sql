CREATE TABLE confsys.review_publication_snapshots(decision_id uuid PRIMARY KEY REFERENCES confsys.review_decisions(id),author_comments jsonb NOT NULL CHECK(jsonb_typeof(author_comments)='array'),published_at timestamptz NOT NULL DEFAULT now());
-- Existing publications preserve the currently observable comments at upgrade time.
INSERT INTO confsys.review_publication_snapshots(decision_id,author_comments,published_at)
 SELECT p.decision_id,coalesce((SELECT jsonb_agg(a.document->>'authorComment' ORDER BY a.id) FROM confsys.review_assignments a WHERE a.revision_id=d.revision_id AND a.state='submitted'),'[]'::jsonb),p.published_at FROM confsys.review_publications p JOIN confsys.review_decisions d ON d.id=p.decision_id;
GRANT SELECT,INSERT ON confsys.review_publication_snapshots TO confsys_app;
ALTER TABLE confsys.review_publication_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.review_publication_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY review_snapshots_manager ON confsys.review_publication_snapshots TO confsys_app USING(current_setting('app.reviews_manage',true)='true') WITH CHECK(current_setting('app.reviews_manage',true)='true');
CREATE POLICY review_snapshots_operator ON confsys.review_publication_snapshots TO confsys_migrator USING(true) WITH CHECK(true);
CREATE OR REPLACE VIEW confsys.review_author_results AS
 SELECT s.id AS submission_id,d.outcome,d.author_message,d.revision_deadline,p.published_at,
 ARRAY(SELECT jsonb_array_elements_text(snapshot.author_comments)) AS author_comments
 FROM confsys.submissions s JOIN confsys.review_publications p ON p.submission_id=s.id JOIN confsys.review_decisions d ON d.id=p.decision_id JOIN confsys.review_publication_snapshots snapshot ON snapshot.decision_id=d.id
 WHERE s.owner_id=nullif(current_setting('app.actor_id',true),'')::uuid;
