-- Judge-scoped boolean projection: scoring cannot fetch authors or raw manuscript rows.
CREATE VIEW confsys.competition_judging_eligibility AS
 SELECT a.id,
 (e.state='approved' AND s.state<>'withdrawn' AND e.owner_id<>a.judge_id
 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.document->'authors') author WHERE lower(btrim(author->>'email'))=u.email)
 AND NOT EXISTS(SELECT 1 FROM confsys.competition_conflicts x WHERE x.entry_id=e.id AND x.judge_id=a.judge_id)
 AND EXISTS(SELECT 1 FROM confsys.published_acceptances p WHERE p.revision_id=e.revision_id AND p.outcome='accept_'||(f.document->>'kind'))
 AND (NOT coalesce((f.document->>'requireRegistration')::boolean,false) OR EXISTS(SELECT 1 FROM confsys.registrations reg WHERE reg.user_id=e.owner_id AND reg.state='confirmed'))
 ) AS eligible
 FROM confsys.competition_assignments a JOIN confsys.competition_entries e ON e.id=a.entry_id JOIN confsys.submissions s ON s.id=e.submission_id JOIN confsys.submission_revisions r ON r.id=e.revision_id JOIN confsys.users u ON u.id=a.judge_id JOIN confsys.competition_rubrics f ON f.id=a.rubric_id
 WHERE a.judge_id=nullif(current_setting('app.actor_id',true),'')::uuid;
GRANT SELECT ON confsys.competition_judging_eligibility TO confsys_app;
