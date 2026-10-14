CREATE TABLE confsys.presenter_change_requests (
 id uuid PRIMARY KEY, submission_id uuid NOT NULL,
 source_revision_id uuid NOT NULL, expected_submission_version integer NOT NULL CHECK(expected_submission_version>0),
 config_version integer NOT NULL CHECK(config_version>=0), requester_id uuid NOT NULL,
 target_user_id uuid NOT NULL REFERENCES confsys.users(id), target_author_index integer NOT NULL CHECK(target_author_index>=0),
 target_email text NOT NULL CHECK(target_email=lower(btrim(target_email))),
 projection jsonb NOT NULL CHECK(jsonb_typeof(projection)='object'),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 300),
 state text NOT NULL DEFAULT 'requested' CHECK(state IN('requested','accepted','declined','cancelled','approved','rejected','expired')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 consent_credential_version integer, consented_at timestamptz, response_reason text,
 decision_actor uuid REFERENCES confsys.users(id), decision_reason text, decided_at timestamptz,
 new_revision_id uuid, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(submission_id,requester_id) REFERENCES confsys.submissions(id,owner_id),
 FOREIGN KEY(source_revision_id,submission_id) REFERENCES confsys.submission_revisions(id,submission_id),
 FOREIGN KEY(new_revision_id,submission_id) REFERENCES confsys.submission_revisions(id,submission_id),
 CHECK(expires_at>created_at), CHECK(new_revision_id IS NULL OR new_revision_id<>source_revision_id),
 CHECK(state NOT IN('accepted','approved') OR (consent_credential_version IS NOT NULL AND consented_at IS NOT NULL)),
 CHECK((state='approved')=(new_revision_id IS NOT NULL)),
 CHECK(state NOT IN('approved','rejected','cancelled') OR (decision_actor IS NOT NULL AND length(decision_reason) BETWEEN 3 AND 300 AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX presenter_change_pending ON confsys.presenter_change_requests(submission_id) WHERE state IN('requested','accepted');
ALTER TABLE confsys.presenter_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.presenter_change_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY presenter_change_read ON confsys.presenter_change_requests FOR SELECT TO confsys_app USING(requester_id=nullif(current_setting('app.actor_id',true),'')::uuid OR target_user_id=nullif(current_setting('app.actor_id',true),'')::uuid OR current_setting('app.presenter_admin',true)='true');
CREATE POLICY presenter_change_insert ON confsys.presenter_change_requests FOR INSERT TO confsys_app WITH CHECK(requester_id=nullif(current_setting('app.actor_id',true),'')::uuid AND state='requested' AND version=1 AND new_revision_id IS NULL AND consented_at IS NULL AND decision_actor IS NULL);
CREATE POLICY presenter_change_update ON confsys.presenter_change_requests FOR UPDATE TO confsys_app USING(state IN('requested','accepted') AND (requester_id=nullif(current_setting('app.actor_id',true),'')::uuid OR target_user_id=nullif(current_setting('app.actor_id',true),'')::uuid OR current_setting('app.presenter_admin',true)='true')) WITH CHECK(
 (state IN('accepted','declined') AND target_user_id=nullif(current_setting('app.actor_id',true),'')::uuid)
 OR (state IN('cancelled','expired') AND requester_id=nullif(current_setting('app.actor_id',true),'')::uuid)
 OR (state IN('approved','rejected','expired') AND current_setting('app.presenter_admin',true)='true'));
CREATE POLICY presenter_change_operator ON confsys.presenter_change_requests TO confsys_migrator USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON confsys.presenter_change_requests TO confsys_app;
GRANT UPDATE(state,version,consent_credential_version,consented_at,response_reason,decision_actor,decision_reason,decided_at,new_revision_id) ON confsys.presenter_change_requests TO confsys_app;
CREATE FUNCTION confsys.guard_presenter_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,confsys AS $$
BEGIN
 IF OLD.state NOT IN('requested','accepted') OR NEW.version<>OLD.version+1
 OR (OLD.state='accepted' AND NEW.state NOT IN('approved','rejected','cancelled','expired'))
 OR (OLD.state='requested' AND NEW.state NOT IN('accepted','declined','rejected','cancelled','expired'))
 THEN RAISE EXCEPTION 'Invalid presenter change transition' USING ERRCODE='23514'; END IF;
 IF NEW.state='approved' AND NOT EXISTS(SELECT 1 FROM confsys.submission_revisions n JOIN confsys.submission_revisions s ON s.id=NEW.source_revision_id WHERE n.id=NEW.new_revision_id AND n.submission_id=NEW.submission_id AND n.version>s.version AND n.document=(s.document || jsonb_build_object('presenterIndex',NEW.target_author_index))) THEN RAISE EXCEPTION 'Presenter revision must preserve source content' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER presenter_change_guard BEFORE UPDATE ON confsys.presenter_change_requests FOR EACH ROW EXECUTE FUNCTION confsys.guard_presenter_change();
-- Floor every earlier accepted revision, not merely the directly replaced source. Public snapshots remain immutable.
CREATE OR REPLACE VIEW confsys.published_acceptances AS
 SELECT d.submission_id,d.revision_id,d.outcome
 FROM confsys.review_publications p JOIN confsys.review_decisions d ON d.id=p.decision_id
 JOIN confsys.submission_revisions accepted ON accepted.id=d.revision_id
 WHERE d.outcome IN('accept_oral','accept_poster') AND NOT EXISTS(
 SELECT 1 FROM confsys.presenter_change_requests change JOIN confsys.submission_revisions replacement ON replacement.id=change.new_revision_id
 WHERE change.submission_id=d.submission_id AND change.state='approved' AND replacement.version>accepted.version);
