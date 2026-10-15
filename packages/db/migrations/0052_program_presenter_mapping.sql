-- Pin explicit consent identity at publication time; never infer legacy owners
-- or dynamically change historical personal associations after later approvals.
ALTER TABLE confsys.presenter_change_requests ADD CONSTRAINT presenter_change_target_identity UNIQUE(id,target_user_id,submission_id);
ALTER TABLE confsys.program_publication_slots
 ADD COLUMN presenter_user_id uuid REFERENCES confsys.users(id),
 ADD COLUMN presenter_change_id uuid,
 ADD CONSTRAINT program_presenter_mapping_pair CHECK((presenter_user_id IS NULL)=(presenter_change_id IS NULL)),
 ADD CONSTRAINT program_presenter_mapping_basis FOREIGN KEY(presenter_change_id,presenter_user_id,submission_id) REFERENCES confsys.presenter_change_requests(id,target_user_id,submission_id);
CREATE VIEW confsys.program_revision_presenters WITH(security_barrier=true) AS
 SELECT revision.id AS revision_id,approved.target_user_id AS presenter_user_id,approved.id AS presenter_change_id
 FROM confsys.submission_revisions revision
 JOIN LATERAL (
  SELECT change.id,change.target_user_id,change.target_email
  FROM confsys.presenter_change_requests change JOIN confsys.submission_revisions replacement ON replacement.id=change.new_revision_id
  WHERE change.submission_id=revision.submission_id AND change.state='approved' AND replacement.version<=revision.version
  ORDER BY replacement.version DESC LIMIT 1
 ) approved ON lower(btrim(revision.document->'authors'->((revision.document->>'presenterIndex')::integer)->>'email'))=approved.target_email
 WHERE current_setting('app.program_publish',true)='true'
 AND EXISTS(SELECT 1 FROM confsys.users actor WHERE actor.id=nullif(current_setting('app.actor_id',true),'')::uuid AND actor.state='active' AND actor.verified_at IS NOT NULL);
-- Reuse the one publish resolver to bind inserts to an actual approved basis,
-- rather than duplicating its approval/version/content rules in a second policy.
CREATE FUNCTION confsys.guard_program_presenter_basis() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,confsys AS $$
BEGIN
 IF NEW.presenter_change_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM confsys.program_revision_presenters p WHERE p.revision_id=NEW.revision_id
  AND p.presenter_user_id=NEW.presenter_user_id AND p.presenter_change_id=NEW.presenter_change_id
 ) THEN RAISE EXCEPTION 'Invalid approved presenter basis' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION confsys.guard_program_presenter_basis() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confsys.guard_program_presenter_basis() TO confsys_app;
CREATE TRIGGER program_presenter_basis_guard BEFORE INSERT ON confsys.program_publication_slots
 FOR EACH ROW EXECUTE FUNCTION confsys.guard_program_presenter_basis();
CREATE VIEW confsys.personal_program_slots WITH(security_barrier=true) AS
 SELECT mapping.publication_id,mapping.slot_id
 FROM confsys.program_publication_slots mapping
 WHERE mapping.presenter_user_id=nullif(current_setting('app.actor_id',true),'')::uuid
 OR EXISTS(SELECT 1 FROM confsys.submissions submission WHERE submission.id=mapping.submission_id AND submission.owner_id=nullif(current_setting('app.actor_id',true),'')::uuid);
GRANT SELECT ON confsys.program_revision_presenters,confsys.personal_program_slots TO confsys_app;
-- No runtime UPDATE grants and no presenter SELECT policy on raw mappings or
-- submissions. The personal projection reveals only IDs of public slots.
