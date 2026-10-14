-- Installed ONLY by integration tests into confsys_test. Never production migrations.
CREATE SCHEMA phase0_rls;
REVOKE ALL ON SCHEMA phase0_rls FROM PUBLIC;
GRANT USAGE ON SCHEMA phase0_rls TO confsys_app, confsys_worker;
CREATE TABLE phase0_rls.conferences (
 organization_id uuid NOT NULL,
 id uuid NOT NULL,
 PRIMARY KEY (organization_id, id)
);
CREATE TABLE phase0_rls.notes (
 organization_id uuid NOT NULL,
 conference_id uuid NOT NULL,
 id uuid NOT NULL,
 body text NOT NULL,
 PRIMARY KEY (organization_id, conference_id, id),
 FOREIGN KEY (organization_id, conference_id) REFERENCES phase0_rls.conferences(organization_id, id)
);
CREATE TABLE phase0_rls.attachments (
 organization_id uuid NOT NULL,
 conference_id uuid NOT NULL,
 id uuid NOT NULL,
 note_id uuid NOT NULL,
 PRIMARY KEY (organization_id, conference_id, id),
 FOREIGN KEY (organization_id, conference_id, note_id) REFERENCES phase0_rls.notes(organization_id, conference_id, id)
);
ALTER TABLE phase0_rls.conferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE phase0_rls.conferences FORCE ROW LEVEL SECURITY;
ALTER TABLE phase0_rls.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE phase0_rls.notes FORCE ROW LEVEL SECURITY;
ALTER TABLE phase0_rls.attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY scope ON phase0_rls.conferences TO confsys_app, confsys_worker
 USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid AND id = nullif(current_setting('app.conference_id', true), '')::uuid)
 WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid AND id = nullif(current_setting('app.conference_id', true), '')::uuid);
CREATE POLICY scope ON phase0_rls.notes TO confsys_app, confsys_worker
 USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid AND conference_id = nullif(current_setting('app.conference_id', true), '')::uuid)
 WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid AND conference_id = nullif(current_setting('app.conference_id', true), '')::uuid);
ALTER TABLE phase0_rls.attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY scope ON phase0_rls.attachments TO confsys_app, confsys_worker
 USING (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid AND conference_id = nullif(current_setting('app.conference_id', true), '')::uuid)
 WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid AND conference_id = nullif(current_setting('app.conference_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA phase0_rls TO confsys_app, confsys_worker;
