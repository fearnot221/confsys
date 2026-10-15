-- Canonical registration gate reads immutable submission policy snapshots. No runtime grant on the base view.
CREATE VIEW confsys.submission_registration_policy AS
 SELECT snapshot.*,(snapshot.deadline IS NULL OR clock_timestamp()<snapshot.deadline OR snapshot.registered) AS eligible
 FROM (SELECT r.id AS revision_id,r.owner_id,
 nullif(r.config_snapshot->>'acceptedRegistrationDeadline','')::timestamptz AS deadline,
 EXISTS(SELECT 1 FROM confsys.registrations reg WHERE reg.user_id=r.owner_id AND reg.state='confirmed') AS registered,
 EXISTS(SELECT 1 FROM confsys.published_acceptances p WHERE p.revision_id=r.id) AS accepted
 FROM confsys.submission_revisions r) snapshot;
CREATE VIEW confsys.submission_registration_status AS SELECT revision_id,deadline,registered,eligible,accepted FROM confsys.submission_registration_policy
 WHERE owner_id=nullif(current_setting('app.actor_id',true),'')::uuid OR current_setting('app.submissions_admin',true)='true';
GRANT SELECT ON confsys.submission_registration_status TO confsys_app;
-- Judge-scoped boolean projection: scoring cannot fetch authors or raw manuscript rows.
CREATE OR REPLACE VIEW confsys.competition_judging_eligibility AS
 SELECT a.id,
 (EXISTS(SELECT 1 FROM confsys.submission_registration_policy policy WHERE policy.revision_id=e.revision_id AND policy.eligible) AND e.state='approved' AND s.state<>'withdrawn' AND e.owner_id<>a.judge_id
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.document->'authors') author WHERE lower(btrim(author->>'email'))=u.email)
 AND NOT EXISTS(SELECT 1 FROM confsys.competition_conflicts x WHERE x.entry_id=e.id AND x.judge_id=a.judge_id)
 AND EXISTS(SELECT 1 FROM confsys.published_acceptances p WHERE p.revision_id=e.revision_id AND p.outcome='accept_'||(f.document->>'kind'))
 AND (NOT coalesce((f.document->>'requireRegistration')::boolean,false) OR EXISTS(SELECT 1 FROM confsys.registrations reg WHERE reg.user_id=e.owner_id AND reg.state='confirmed'))
 ) AS eligible
 FROM confsys.competition_assignments a JOIN confsys.competition_entries e ON e.id=a.entry_id JOIN confsys.submissions s ON s.id=e.submission_id JOIN confsys.submission_revisions r ON r.id=e.revision_id JOIN confsys.users u ON u.id=a.judge_id JOIN confsys.competition_rubrics f ON f.id=a.rubric_id
 WHERE a.judge_id=nullif(current_setting('app.actor_id',true),'')::uuid;
GRANT SELECT ON confsys.competition_judging_eligibility TO confsys_app;

-- Append exact published revision identity to the existing owner-only result projection.
CREATE OR REPLACE VIEW confsys.review_author_results AS
 SELECT s.id AS submission_id,d.outcome,d.author_message,d.revision_deadline,p.published_at,
 ARRAY(SELECT jsonb_array_elements_text(snapshot.author_comments)) AS author_comments,
 d.revision_id
 FROM confsys.submissions s JOIN confsys.review_publications p ON p.submission_id=s.id JOIN confsys.review_decisions d ON d.id=p.decision_id JOIN confsys.review_publication_snapshots snapshot ON snapshot.decision_id=d.id
 WHERE s.owner_id=nullif(current_setting('app.actor_id',true),'')::uuid;
