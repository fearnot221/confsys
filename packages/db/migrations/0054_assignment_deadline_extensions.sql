-- Append-only assignment deadline amendments; original scoring forms remain immutable.
CREATE TABLE confsys.review_deadline_extensions (
 id uuid PRIMARY KEY, assignment_id uuid NOT NULL REFERENCES confsys.review_assignments(id),
 assignment_version integer NOT NULL CHECK(assignment_version>1),
 previous_deadline timestamptz NOT NULL, deadline timestamptz NOT NULL CHECK(deadline>previous_deadline),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 2000),
 created_by uuid NOT NULL REFERENCES confsys.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(assignment_id,assignment_version)
);
GRANT SELECT(id,assignment_id,assignment_version,previous_deadline,deadline,reason,created_at),INSERT ON confsys.review_deadline_extensions TO confsys_app;
ALTER TABLE confsys.review_deadline_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.review_deadline_extensions FORCE ROW LEVEL SECURITY;
CREATE POLICY review_deadline_extensions_manager ON confsys.review_deadline_extensions TO confsys_app
 USING(current_setting('app.reviews_manage',true)='true' AND nullif(current_setting('app.actor_id',true),'') IS NOT NULL)
 WITH CHECK(current_setting('app.reviews_manage',true)='true' AND created_by=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE POLICY review_deadline_extensions_assigned ON confsys.review_deadline_extensions FOR SELECT TO confsys_app
 USING(EXISTS(SELECT 1 FROM confsys.review_assignments a WHERE a.id=assignment_id AND a.reviewer_id=nullif(current_setting('app.actor_id',true),'')::uuid));
CREATE POLICY review_deadline_extensions_operator ON confsys.review_deadline_extensions TO confsys_migrator USING(true) WITH CHECK(true);
CREATE TABLE confsys.competition_deadline_extensions (
 id uuid PRIMARY KEY, assignment_id uuid NOT NULL REFERENCES confsys.competition_assignments(id),
 assignment_version integer NOT NULL CHECK(assignment_version>1),
 previous_deadline timestamptz NOT NULL, deadline timestamptz NOT NULL CHECK(deadline>previous_deadline),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 2000),
 created_by uuid NOT NULL REFERENCES confsys.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(assignment_id,assignment_version)
);
GRANT SELECT(id,assignment_id,assignment_version,previous_deadline,deadline,reason,created_at),INSERT ON confsys.competition_deadline_extensions TO confsys_app;
ALTER TABLE confsys.competition_deadline_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.competition_deadline_extensions FORCE ROW LEVEL SECURITY;
CREATE POLICY competition_deadline_extensions_manager ON confsys.competition_deadline_extensions TO confsys_app
 USING(current_setting('app.competitions_manage',true)='true' AND nullif(current_setting('app.actor_id',true),'') IS NOT NULL)
 WITH CHECK(current_setting('app.competitions_manage',true)='true' AND created_by=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE POLICY competition_deadline_extensions_assigned ON confsys.competition_deadline_extensions FOR SELECT TO confsys_app
 USING(EXISTS(SELECT 1 FROM confsys.competition_assignments a WHERE a.id=assignment_id AND a.judge_id=nullif(current_setting('app.actor_id',true),'')::uuid));
CREATE POLICY competition_deadline_extensions_operator ON confsys.competition_deadline_extensions TO confsys_migrator USING(true) WITH CHECK(true);

CREATE FUNCTION confsys.guard_review_deadline_extension() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,confsys AS $$
DECLARE current_version integer; current_state text; original_deadline timestamptz; effective_deadline timestamptz; amendment_count integer;
BEGIN
 SELECT a.version,a.state,(f.document->>'closesAt')::timestamptz INTO current_version,current_state,original_deadline
 FROM confsys.review_assignments a JOIN confsys.review_forms f ON f.id=a.form_id WHERE a.id=NEW.assignment_id FOR UPDATE OF a;
 SELECT count(*) INTO amendment_count FROM confsys.review_deadline_extensions WHERE assignment_id=NEW.assignment_id;
 SELECT deadline INTO effective_deadline FROM confsys.review_deadline_extensions WHERE assignment_id=NEW.assignment_id ORDER BY assignment_version DESC LIMIT 1;
 -- Service inserts history before incrementing the locked assignment version.
 IF current_version IS NULL OR original_deadline IS NULL OR NEW.assignment_version<>current_version+1 OR current_state NOT IN('invited','accepted')
 OR NEW.previous_deadline<>coalesce(effective_deadline,original_deadline) OR NEW.deadline<=clock_timestamp()
 OR NEW.deadline>clock_timestamp()+interval '365 days' OR amendment_count>=50 THEN
 RAISE EXCEPTION 'Invalid assignment deadline amendment basis' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION confsys.guard_review_deadline_extension() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confsys.guard_review_deadline_extension() TO confsys_app;
CREATE TRIGGER review_deadline_extension_basis BEFORE INSERT ON confsys.review_deadline_extensions FOR EACH ROW EXECUTE FUNCTION confsys.guard_review_deadline_extension();

CREATE FUNCTION confsys.guard_competition_deadline_extension() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,confsys AS $$
DECLARE current_version integer; current_state text; original_deadline timestamptz; effective_deadline timestamptz; amendment_count integer;
BEGIN
 SELECT a.version,a.state,(f.document->>'judgingClosesAt')::timestamptz INTO current_version,current_state,original_deadline
 FROM confsys.competition_assignments a JOIN confsys.competition_rubrics f ON f.id=a.rubric_id WHERE a.id=NEW.assignment_id FOR UPDATE OF a;
 SELECT count(*) INTO amendment_count FROM confsys.competition_deadline_extensions WHERE assignment_id=NEW.assignment_id;
 SELECT deadline INTO effective_deadline FROM confsys.competition_deadline_extensions WHERE assignment_id=NEW.assignment_id ORDER BY assignment_version DESC LIMIT 1;
 -- Service inserts history before incrementing the locked assignment version.
 IF current_version IS NULL OR original_deadline IS NULL OR NEW.assignment_version<>current_version+1 OR current_state NOT IN('assigned')
 OR NEW.previous_deadline<>coalesce(effective_deadline,original_deadline) OR NEW.deadline<=clock_timestamp()
 OR NEW.deadline>clock_timestamp()+interval '365 days' OR amendment_count>=50 THEN
 RAISE EXCEPTION 'Invalid assignment deadline amendment basis' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION confsys.guard_competition_deadline_extension() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confsys.guard_competition_deadline_extension() TO confsys_app;
CREATE TRIGGER competition_deadline_extension_basis BEFORE INSERT ON confsys.competition_deadline_extensions FOR EACH ROW EXECUTE FUNCTION confsys.guard_competition_deadline_extension();
