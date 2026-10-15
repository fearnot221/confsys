-- Preserve every prior entry, assignment and final score. Replacement creates a
-- new requested entry with immutable lineage; no historical rows are rewritten.
ALTER TABLE confsys.competition_entries
 DROP CONSTRAINT competition_entries_competition_id_submission_id_key,
 ADD COLUMN predecessor_id uuid,
 ADD COLUMN replacement_reason text NOT NULL DEFAULT '',
 ADD CONSTRAINT competition_entry_revision_unique UNIQUE(competition_id,submission_id,revision_id),
 ADD CONSTRAINT competition_entry_lineage_identity UNIQUE(id,competition_id,submission_id,owner_id),
 ADD CONSTRAINT competition_entry_predecessor_unique UNIQUE(predecessor_id),
 ADD CONSTRAINT competition_entry_predecessor_fk FOREIGN KEY(predecessor_id,competition_id,submission_id,owner_id) REFERENCES confsys.competition_entries(id,competition_id,submission_id,owner_id),
 ADD CONSTRAINT competition_entry_predecessor_check CHECK(predecessor_id IS NULL OR predecessor_id<>id),
 ADD CONSTRAINT competition_entry_replacement_reason CHECK((predecessor_id IS NULL AND replacement_reason='') OR (predecessor_id IS NOT NULL AND length(replacement_reason) BETWEEN 3 AND 2000));
CREATE UNIQUE INDEX competition_entry_single_root ON confsys.competition_entries(competition_id,submission_id) WHERE predecessor_id IS NULL;
-- Existing INSERT grants permit creation. Runtime UPDATE grants deliberately do
-- not include revision_id, predecessor_id, replacement_reason or owner identity.
-- Narrow identity-only projection; competition administrators do not receive
-- consent emails, reasons or unrelated presenter-change requests.
CREATE VIEW confsys.competition_presenter_successors WITH(security_barrier=true) AS
 SELECT prior.id AS prior_revision_id,next.id AS new_revision_id
 FROM confsys.presenter_change_requests change
 JOIN confsys.submission_revisions next ON next.id=change.new_revision_id
 JOIN confsys.submission_revisions prior ON prior.submission_id=change.submission_id AND prior.version<next.version
 WHERE change.state='approved'
 AND (current_setting('app.competitions_manage',true)='true' OR prior.owner_id=nullif(current_setting('app.actor_id',true),'')::uuid)
 AND NOT EXISTS(SELECT 1 FROM confsys.presenter_change_requests later JOIN confsys.submission_revisions r ON r.id=later.new_revision_id WHERE later.submission_id=change.submission_id AND later.state='approved' AND r.version>next.version);
GRANT SELECT ON confsys.competition_presenter_successors TO confsys_app;
-- Judges may read their own predecessor but not a successor that has no new
-- assignment yet. A narrow boolean avoids widening raw entry RLS for that check.
CREATE VIEW confsys.competition_entry_current WITH(security_barrier=true) AS
 SELECT e.id,NOT EXISTS(SELECT 1 FROM confsys.competition_entries child WHERE child.predecessor_id=e.id) AS current
 FROM confsys.competition_entries e
 WHERE current_setting('app.competitions_manage',true)='true'
 OR e.owner_id=nullif(current_setting('app.actor_id',true),'')::uuid
 OR EXISTS(SELECT 1 FROM confsys.competition_assignments a WHERE a.entry_id=e.id AND a.judge_id=nullif(current_setting('app.actor_id',true),'')::uuid);
GRANT SELECT ON confsys.competition_entry_current TO confsys_app;
