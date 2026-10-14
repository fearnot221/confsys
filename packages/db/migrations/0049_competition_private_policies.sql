-- Current catalog and active public snapshots are explicit projections. Private
-- award drafts, old rubrics and publication history require administrative scope.
CREATE VIEW confsys.competition_catalog WITH(security_barrier=true) AS
 SELECT c.id,c.version,c.current_rubric_id,r.document AS config
 FROM confsys.competitions c JOIN confsys.competition_rubrics r ON r.id=c.current_rubric_id
 WHERE EXISTS(SELECT 1 FROM confsys.users u WHERE u.id=nullif(current_setting('app.actor_id',true),'')::uuid AND u.state='active' AND u.verified_at IS NOT NULL);
CREATE VIEW confsys.competition_active_awards WITH(security_barrier=true) AS
 SELECT c.id,p.id AS publication_id,p.document,p.published_at
 FROM confsys.competitions c JOIN confsys.competition_publications p ON p.id=c.active_publication_id AND p.competition_id=c.id;
CREATE VIEW confsys.competition_assignment_rubrics WITH(security_barrier=true) AS
 SELECT r.id,r.competition_id,r.document FROM confsys.competition_rubrics r
 WHERE current_setting('app.competitions_manage',true)='true'
 OR EXISTS(SELECT 1 FROM confsys.competition_assignments a WHERE a.rubric_id=r.id AND a.judge_id=nullif(current_setting('app.actor_id',true),'')::uuid);
GRANT SELECT ON confsys.competition_catalog,confsys.competition_active_awards,confsys.competition_assignment_rubrics TO confsys_app;
ALTER TABLE confsys.competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.competitions FORCE ROW LEVEL SECURITY;
CREATE POLICY competitions_manager ON confsys.competitions TO confsys_app USING(current_setting('app.competitions_manage',true)='true') WITH CHECK(current_setting('app.competitions_manage',true)='true');
CREATE POLICY competitions_operator ON confsys.competitions TO confsys_migrator USING(true) WITH CHECK(true);
ALTER TABLE confsys.competition_rubrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.competition_rubrics FORCE ROW LEVEL SECURITY;
CREATE POLICY competition_rubrics_read ON confsys.competition_rubrics FOR SELECT TO confsys_app USING(current_setting('app.competitions_manage',true)='true');
CREATE POLICY competition_rubrics_insert ON confsys.competition_rubrics FOR INSERT TO confsys_app WITH CHECK(current_setting('app.competitions_manage',true)='true');
CREATE POLICY competition_rubrics_operator ON confsys.competition_rubrics TO confsys_migrator USING(true) WITH CHECK(true);
ALTER TABLE confsys.competition_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.competition_publications FORCE ROW LEVEL SECURITY;
CREATE POLICY competition_publications_manager ON confsys.competition_publications TO confsys_app USING(current_setting('app.competitions_manage',true)='true') WITH CHECK(current_setting('app.competitions_manage',true)='true');
CREATE POLICY competition_publications_operator ON confsys.competition_publications TO confsys_migrator USING(true) WITH CHECK(true);
-- Conflict reasons already have actor/operator RLS in0043.
-- Entry and judging commands must advance the publication source version without
-- granting access to award drafts. This function exposes no private row values.
CREATE FUNCTION confsys.advance_competition_version(p_competition uuid,p_entry uuid,p_assignment uuid DEFAULT NULL) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,confsys AS $$
DECLARE actor uuid := nullif(current_setting('app.actor_id',true),'')::uuid;
BEGIN
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM confsys.users u WHERE u.id=actor AND u.state='active' AND u.verified_at IS NOT NULL)
 OR NOT EXISTS(SELECT 1 FROM confsys.competition_entries e WHERE e.id=p_entry AND e.competition_id=p_competition)
 OR (p_assignment IS NOT NULL AND NOT EXISTS(SELECT 1 FROM confsys.competition_assignments a WHERE a.id=p_assignment AND a.entry_id=p_entry AND a.competition_id=p_competition))
 OR NOT (coalesce(current_setting('app.competitions_manage',true),'false')='true'
 OR (p_assignment IS NULL AND EXISTS(SELECT 1 FROM confsys.competition_entries e WHERE e.id=p_entry AND e.owner_id=actor))
 OR EXISTS(SELECT 1 FROM confsys.competition_assignments a WHERE a.id=p_assignment AND a.entry_id=p_entry AND a.competition_id=p_competition AND a.judge_id=actor))
 THEN RAISE EXCEPTION 'Competition version scope denied' USING ERRCODE='42501'; END IF;
 UPDATE confsys.competitions SET version=version+1 WHERE id=p_competition;
END $$;
REVOKE ALL ON FUNCTION confsys.advance_competition_version(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confsys.advance_competition_version(uuid,uuid,uuid) TO confsys_app;
