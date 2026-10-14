-- Immutable ownership linkage is separate from the deliberately public program JSON.
CREATE TABLE confsys.program_publication_slots(
 publication_id uuid NOT NULL REFERENCES confsys.program_publications(id),
 slot_id uuid NOT NULL,
 submission_id uuid NOT NULL REFERENCES confsys.submissions(id),
 revision_id uuid NOT NULL,
 PRIMARY KEY(publication_id,slot_id),
 FOREIGN KEY(revision_id,submission_id) REFERENCES confsys.submission_revisions(id,submission_id)
);
GRANT SELECT,INSERT ON confsys.program_publication_slots TO confsys_app;
ALTER TABLE confsys.program_publication_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.program_publication_slots FORCE ROW LEVEL SECURITY;
CREATE POLICY program_publication_slots_owner ON confsys.program_publication_slots FOR SELECT TO confsys_app USING(EXISTS(SELECT 1 FROM confsys.submissions s WHERE s.id=submission_id AND s.owner_id=nullif(current_setting('app.actor_id',true),'')::uuid));
CREATE POLICY program_publication_slots_writer ON confsys.program_publication_slots FOR INSERT TO confsys_app WITH CHECK(current_setting('app.program_publish',true)='true');
CREATE POLICY program_publication_slots_operator ON confsys.program_publication_slots TO confsys_migrator USING(true) WITH CHECK(true);
-- Only an unchanged, still-current source version can safely recover ownership.
-- Older snapshots lack identity linkage and intentionally remain unmatched.
INSERT INTO confsys.program_publication_slots(publication_id,slot_id,submission_id,revision_id)
 SELECT p.id,slot.id,slot.submission_id,slot.revision_id
 FROM confsys.program_state state
 JOIN confsys.program_publications p ON p.id=state.active_publication_id AND p.source_version=state.version
 CROSS JOIN confsys.program_slots slot
 JOIN confsys.submission_revisions revision ON revision.id=slot.revision_id AND revision.submission_id=slot.submission_id
 JOIN confsys.submissions submission ON submission.id=slot.submission_id AND submission.owner_id=revision.owner_id AND submission.owner_id=slot.owner_id
 WHERE slot.submission_id IS NOT NULL AND slot.revision_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.document) session, jsonb_array_elements(session->'slots') published_slot WHERE published_slot->>'id'=slot.id::text);
