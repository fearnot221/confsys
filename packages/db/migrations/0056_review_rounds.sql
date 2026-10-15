-- Existing assignments and decisions belong to the original first round.
ALTER TABLE confsys.review_assignments ADD COLUMN round integer NOT NULL DEFAULT 1 CHECK(round BETWEEN 1 AND 20);
ALTER TABLE confsys.review_decisions ADD COLUMN round integer NOT NULL DEFAULT 1 CHECK(round BETWEEN 1 AND 20);
ALTER TABLE confsys.review_assignments DROP CONSTRAINT review_assignments_revision_id_reviewer_id_key;
ALTER TABLE confsys.review_assignments ADD CONSTRAINT review_assignments_round_reviewer UNIQUE(revision_id,round,reviewer_id);
-- No UPDATE grant on round: each assignment/decision permanently identifies its basis.
CREATE FUNCTION confsys.guard_review_round_assignment() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,confsys AS $$
DECLARE latest integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('review-round:'||NEW.revision_id::text,0));
 SELECT coalesce(max(round),0) INTO latest FROM confsys.review_assignments WHERE revision_id=NEW.revision_id;
 IF (latest=0 AND NEW.round<>1) OR NEW.round<latest OR NEW.round>latest+1 OR (NEW.round>latest AND EXISTS(SELECT 1 FROM confsys.review_assignments WHERE revision_id=NEW.revision_id AND state IN('invited','accepted'))) THEN
 RAISE EXCEPTION 'Invalid review round transition' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION confsys.guard_review_round_assignment() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confsys.guard_review_round_assignment() TO confsys_app;
CREATE TRIGGER review_round_assignment_basis BEFORE INSERT ON confsys.review_assignments FOR EACH ROW EXECUTE FUNCTION confsys.guard_review_round_assignment();
CREATE FUNCTION confsys.guard_review_decision_round() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,confsys AS $$
BEGIN
 IF NEW.round>1 AND NOT EXISTS(SELECT 1 FROM confsys.review_assignments WHERE revision_id=NEW.revision_id AND round=NEW.round) THEN
 RAISE EXCEPTION 'Unknown decision review round' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION confsys.guard_review_decision_round() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confsys.guard_review_decision_round() TO confsys_app;
CREATE TRIGGER review_decision_round_basis BEFORE INSERT ON confsys.review_decisions FOR EACH ROW EXECUTE FUNCTION confsys.guard_review_decision_round();
CREATE OR REPLACE VIEW confsys.review_author_results AS
 SELECT s.id AS submission_id,d.outcome,d.author_message,d.revision_deadline,p.published_at,
 ARRAY(SELECT jsonb_array_elements_text(snapshot.author_comments)) AS author_comments,d.revision_id,d.round
 FROM confsys.submissions s JOIN confsys.review_publications p ON p.submission_id=s.id JOIN confsys.review_decisions d ON d.id=p.decision_id JOIN confsys.review_publication_snapshots snapshot ON snapshot.decision_id=d.id
 WHERE s.owner_id=nullif(current_setting('app.actor_id',true),'')::uuid;
