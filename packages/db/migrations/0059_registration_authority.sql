-- Forward-only runtime boundaries. Existing historical snapshots are unchanged.
ALTER TABLE confsys.registration_config_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.registration_config_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY registration_config_public_read ON confsys.registration_config_versions FOR SELECT TO confsys_app USING(true);
CREATE POLICY registration_config_author ON confsys.registration_config_versions FOR INSERT TO confsys_app WITH CHECK(
 current_setting('app.registration_configure',true)='true'
 AND created_by=nullif(current_setting('app.actor_id',true),'')::uuid
);
CREATE POLICY registration_config_operator ON confsys.registration_config_versions TO confsys_migrator USING(true) WITH CHECK(true);

-- Keep the singleton readable/lockable for participants and the reminder worker;
-- guard the meaningful version column independently of row-lock privileges.
CREATE FUNCTION confsys.guard_registration_configuration() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,confsys AS $$
DECLARE next_document jsonb; previous_document jsonb;
BEGIN
 IF current_user<>'confsys_app' OR NEW.version IS NOT DISTINCT FROM OLD.version THEN RETURN NEW; END IF;
 IF current_setting('app.registration_configure',true) IS DISTINCT FROM 'true'
 OR nullif(current_setting('app.actor_id',true),'') IS NULL THEN
  RAISE EXCEPTION 'registration configuration authority required' USING ERRCODE='42501';
 END IF;
 IF NEW.version IS NULL OR NEW.version<>coalesce(OLD.version,0)+1 THEN
  RAISE EXCEPTION 'registration configuration version conflict' USING ERRCODE='23514',CONSTRAINT='registration_configuration_guard';
 END IF;
 SELECT document INTO next_document FROM confsys.registration_config_versions WHERE version=NEW.version;
 SELECT document INTO previous_document FROM confsys.registration_config_versions WHERE version=OLD.version;
 IF next_document IS NULL OR jsonb_typeof(next_document->'tickets') IS DISTINCT FROM 'array'
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(previous_document->'tickets','[]'::jsonb)) p
           WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(next_document->'tickets') n WHERE n->>'id'=p->>'id'))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(next_document->'tickets') n
           JOIN confsys.registration_capacity c ON c.ticket_id=(n->>'id')::uuid WHERE c.used>(n->>'capacity')::integer) THEN
  RAISE EXCEPTION 'registration configuration capacity conflict' USING ERRCODE='23514',CONSTRAINT='registration_configuration_guard';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER registration_configuration_guard BEFORE UPDATE OF version ON confsys.registration_state FOR EACH ROW EXECUTE FUNCTION confsys.guard_registration_configuration();

CREATE FUNCTION confsys.guard_registration_capacity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,confsys AS $$
DECLARE current_version integer; document jsonb; ticket jsonb; used integer; first_waiting uuid;
BEGIN
 -- Migrator remains the explicit restore/fixture operator. Runtime app never bypasses this boundary.
 IF current_user<>'confsys_app' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.state=OLD.state THEN RETURN NEW; END IF;
  IF OLD.state='cancelled' OR NEW.state='waitlisted' THEN
   RAISE EXCEPTION 'invalid registration transition' USING ERRCODE='23514',CONSTRAINT='registration_capacity_guard';
  END IF;
  IF NEW.state='cancelled' THEN RETURN NEW; END IF;
  IF current_setting('app.registration_admin',true) IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'registration promotion authority required' USING ERRCODE='42501';
  END IF;
 END IF;
 -- Serializes direct runtime INSERTs as well as service writes. Aggregate reads
 -- after acquiring this lock must see the preceding transaction's committed seats.
 SELECT version INTO current_version FROM confsys.registration_state FOR UPDATE;
 SELECT v.document INTO document FROM confsys.registration_config_versions v WHERE version=current_version;
 SELECT t INTO ticket FROM jsonb_array_elements(document->'tickets') t WHERE (t->>'id')::uuid=NEW.ticket_id;
 IF ticket IS NULL THEN
  RAISE EXCEPTION 'unknown registration ticket' USING ERRCODE='23514',CONSTRAINT='registration_capacity_guard';
 END IF;
 SELECT coalesce((SELECT c.used FROM confsys.registration_capacity c WHERE c.ticket_id=NEW.ticket_id),0) INTO used;
 IF TG_OP='INSERT' THEN
  IF NEW.config_version<>current_version OR NEW.state='cancelled'
   OR (clock_timestamp()>=(document->>'opensAt')::timestamptz AND clock_timestamp()<(document->>'closesAt')::timestamptz) IS NOT TRUE
   OR (NEW.state='waitlisted' AND (used<(ticket->>'capacity')::integer OR (ticket->>'waitlist')::boolean IS DISTINCT FROM true)) THEN
   RAISE EXCEPTION 'invalid registration admission' USING ERRCODE='23514',CONSTRAINT='registration_capacity_guard';
  END IF;
 ELSE
  SELECT id INTO first_waiting FROM confsys.registrations WHERE ticket_id=NEW.ticket_id AND state='waitlisted' ORDER BY number LIMIT 1;
  IF NEW.id IS DISTINCT FROM first_waiting THEN
   RAISE EXCEPTION 'registration waitlist order conflict' USING ERRCODE='23514',CONSTRAINT='registration_capacity_guard';
  END IF;
 END IF;
 IF NEW.state='confirmed' AND used>=(ticket->>'capacity')::integer THEN
  RAISE EXCEPTION 'registration capacity exhausted' USING ERRCODE='23514',CONSTRAINT='registration_capacity_guard';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER registration_capacity_guard BEFORE INSERT OR UPDATE OF state ON confsys.registrations FOR EACH ROW EXECUTE FUNCTION confsys.guard_registration_capacity();

REVOKE ALL ON FUNCTION confsys.guard_registration_configuration(),confsys.guard_registration_capacity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confsys.guard_registration_configuration(),confsys.guard_registration_capacity() TO confsys_app;
