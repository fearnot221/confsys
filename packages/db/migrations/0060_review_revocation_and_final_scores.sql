-- Administrative revocation stops pending assignments without deleting prior document/form history.
ALTER TABLE confsys.review_assignments DROP CONSTRAINT review_assignments_state_check;
ALTER TABLE confsys.review_assignments ADD CONSTRAINT review_assignments_state_check CHECK(state IN('invited','accepted','declined','conflicted','submitted','revoked'));
CREATE TABLE confsys.review_assignment_revocations(
 id uuid PRIMARY KEY,assignment_id uuid NOT NULL UNIQUE REFERENCES confsys.review_assignments(id),
 assignment_version integer NOT NULL CHECK(assignment_version>1),previous_state text NOT NULL CHECK(previous_state IN('invited','accepted')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 2000),created_by uuid NOT NULL REFERENCES confsys.users(id),created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT(id,assignment_id,assignment_version,previous_state,reason,created_at),INSERT ON confsys.review_assignment_revocations TO confsys_app;
ALTER TABLE confsys.review_assignment_revocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.review_assignment_revocations FORCE ROW LEVEL SECURITY;
CREATE POLICY review_revocations_manager ON confsys.review_assignment_revocations TO confsys_app USING(current_setting('app.reviews_manage',true)='true' AND nullif(current_setting('app.actor_id',true),'') IS NOT NULL) WITH CHECK(current_setting('app.reviews_manage',true)='true' AND created_by=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE POLICY review_revocations_assignee ON confsys.review_assignment_revocations FOR SELECT TO confsys_app USING(EXISTS(SELECT 1 FROM confsys.review_assignments a WHERE a.id=assignment_id AND a.reviewer_id=nullif(current_setting('app.actor_id',true),'')::uuid));
CREATE POLICY review_revocations_operator ON confsys.review_assignment_revocations TO confsys_migrator USING(true) WITH CHECK(true);
CREATE FUNCTION confsys.guard_review_revocation_basis() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,confsys AS $$
DECLARE existing_state text; existing_version integer;
BEGIN
 SELECT state,version INTO existing_state,existing_version FROM confsys.review_assignments WHERE id=NEW.assignment_id FOR UPDATE;
 IF existing_version IS NULL OR existing_version+1<>NEW.assignment_version OR existing_state<>NEW.previous_state OR existing_state NOT IN('invited','accepted') THEN
 RAISE EXCEPTION 'Invalid review revocation basis' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION confsys.guard_review_revocation_basis() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confsys.guard_review_revocation_basis() TO confsys_app;
CREATE TRIGGER review_revocation_basis BEFORE INSERT ON confsys.review_assignment_revocations FOR EACH ROW EXECUTE FUNCTION confsys.guard_review_revocation_basis();
CREATE FUNCTION confsys.guard_review_assignment_finality() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,confsys AS $$
BEGIN
 IF OLD.state NOT IN('invited','accepted') AND NEW.document IS DISTINCT FROM OLD.document THEN
 RAISE EXCEPTION 'Final review document is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.state<>OLD.state AND NOT(NEW.state='conflicted' OR (OLD.state='invited' AND NEW.state IN('accepted','declined','revoked')) OR (OLD.state='accepted' AND NEW.state IN('submitted','revoked'))) THEN
 RAISE EXCEPTION 'Invalid review assignment transition' USING ERRCODE='23514'; END IF;
 IF NEW.state='revoked' AND OLD.state<>'revoked' AND NOT EXISTS(SELECT 1 FROM confsys.review_assignment_revocations r WHERE r.assignment_id=OLD.id AND r.assignment_version=NEW.version AND r.previous_state=OLD.state) THEN
 RAISE EXCEPTION 'Review revocation requires immutable history' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION confsys.guard_review_assignment_finality() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confsys.guard_review_assignment_finality() TO confsys_app;
CREATE TRIGGER review_assignment_finality BEFORE UPDATE OF state,document ON confsys.review_assignments FOR EACH ROW EXECUTE FUNCTION confsys.guard_review_assignment_finality();
CREATE FUNCTION confsys.guard_competition_assignment_finality() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,confsys AS $$
BEGIN
 IF OLD.state<>'assigned' AND NEW.document IS DISTINCT FROM OLD.document THEN
 RAISE EXCEPTION 'Final competition document is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.state<>OLD.state AND NOT(NEW.state='cancelled' OR (OLD.state='assigned' AND NEW.state IN('submitted','conflicted')) OR (OLD.state='submitted' AND NEW.state='conflicted')) THEN
 RAISE EXCEPTION 'Invalid competition assignment transition' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION confsys.guard_competition_assignment_finality() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confsys.guard_competition_assignment_finality() TO confsys_app;
CREATE TRIGGER competition_assignment_finality BEFORE UPDATE OF state,document ON confsys.competition_assignments FOR EACH ROW EXECUTE FUNCTION confsys.guard_competition_assignment_finality();
