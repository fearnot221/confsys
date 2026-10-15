-- Assignment creation is a manager operation; assignee update rights never imply self-assignment.
DROP POLICY review_assignments_actor ON confsys.review_assignments;
CREATE POLICY review_assignments_read ON confsys.review_assignments FOR SELECT TO confsys_app USING(current_setting('app.reviews_manage',true)='true' OR reviewer_id=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE POLICY review_assignments_update ON confsys.review_assignments FOR UPDATE TO confsys_app USING(current_setting('app.reviews_manage',true)='true' OR reviewer_id=nullif(current_setting('app.actor_id',true),'')::uuid) WITH CHECK(current_setting('app.reviews_manage',true)='true' OR reviewer_id=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE POLICY review_assignments_insert ON confsys.review_assignments FOR INSERT TO confsys_app WITH CHECK(current_setting('app.reviews_manage',true)='true' AND nullif(current_setting('app.actor_id',true),'') IS NOT NULL);
DROP POLICY competition_assignments_actor ON confsys.competition_assignments;
CREATE POLICY competition_assignments_read ON confsys.competition_assignments FOR SELECT TO confsys_app USING(current_setting('app.competitions_manage',true)='true' OR judge_id=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE POLICY competition_assignments_update ON confsys.competition_assignments FOR UPDATE TO confsys_app USING(current_setting('app.competitions_manage',true)='true' OR judge_id=nullif(current_setting('app.actor_id',true),'')::uuid) WITH CHECK(current_setting('app.competitions_manage',true)='true' OR judge_id=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE POLICY competition_assignments_insert ON confsys.competition_assignments FOR INSERT TO confsys_app WITH CHECK(current_setting('app.competitions_manage',true)='true' AND nullif(current_setting('app.actor_id',true),'') IS NOT NULL);

-- Participants request or withdraw; only management can qualify/reject/disqualify.
DROP POLICY competition_entries_actor ON confsys.competition_entries;
CREATE POLICY competition_entries_read ON confsys.competition_entries FOR SELECT TO confsys_app USING(current_setting('app.competitions_manage',true)='true' OR owner_id=nullif(current_setting('app.actor_id',true),'')::uuid OR EXISTS(SELECT 1 FROM confsys.competition_assignments a WHERE a.entry_id=competition_entries.id AND a.judge_id=nullif(current_setting('app.actor_id',true),'')::uuid));
CREATE POLICY competition_entries_insert ON confsys.competition_entries FOR INSERT TO confsys_app WITH CHECK(state='requested' AND nullif(current_setting('app.actor_id',true),'') IS NOT NULL AND (current_setting('app.competitions_manage',true)='true' OR owner_id=nullif(current_setting('app.actor_id',true),'')::uuid));
CREATE POLICY competition_entries_update ON confsys.competition_entries FOR UPDATE TO confsys_app
 USING(current_setting('app.competitions_manage',true)='true' OR (owner_id=nullif(current_setting('app.actor_id',true),'')::uuid AND state IN('requested','approved')))
 WITH CHECK(current_setting('app.competitions_manage',true)='true' OR (owner_id=nullif(current_setting('app.actor_id',true),'')::uuid AND state='withdrawn'));
CREATE FUNCTION confsys.guard_competition_entry_transition() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,confsys AS $$
BEGIN
 IF OLD.state<>NEW.state AND NOT((OLD.state='requested' AND NEW.state IN('approved','rejected','withdrawn')) OR (OLD.state='approved' AND NEW.state IN('disqualified','withdrawn'))) THEN
 RAISE EXCEPTION 'Invalid competition entry state transition' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION confsys.guard_competition_entry_transition() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confsys.guard_competition_entry_transition() TO confsys_app;
CREATE TRIGGER competition_entry_transition BEFORE UPDATE OF state ON confsys.competition_entries FOR EACH ROW EXECUTE FUNCTION confsys.guard_competition_entry_transition();
