CREATE TABLE confsys.badge_template_versions (
 version integer PRIMARY KEY CHECK(version > 0),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),
 created_by uuid NOT NULL REFERENCES confsys.users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE confsys.badge_template_state (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 current_version integer REFERENCES confsys.badge_template_versions(version)
);
INSERT INTO confsys.badge_template_state(singleton) VALUES(true);
ALTER TABLE confsys.badge_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.badge_template_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE confsys.badge_template_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.badge_template_state FORCE ROW LEVEL SECURITY;
CREATE POLICY badge_template_read ON confsys.badge_template_versions FOR SELECT TO confsys_app USING(current_setting('app.onsite_admin',true)='true');
CREATE POLICY badge_template_insert ON confsys.badge_template_versions FOR INSERT TO confsys_app WITH CHECK(current_setting('app.badge_template_admin',true)='true' AND created_by=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE POLICY badge_template_state_read ON confsys.badge_template_state FOR SELECT TO confsys_app USING(current_setting('app.onsite_admin',true)='true');
CREATE POLICY badge_template_state_update ON confsys.badge_template_state FOR UPDATE TO confsys_app USING(current_setting('app.badge_template_admin',true)='true') WITH CHECK(current_setting('app.badge_template_admin',true)='true');
GRANT SELECT,INSERT ON confsys.badge_template_versions TO confsys_app;
GRANT SELECT,UPDATE(current_version) ON confsys.badge_template_state TO confsys_app;
CREATE POLICY badge_template_versions_operator ON confsys.badge_template_versions TO confsys_migrator USING(true) WITH CHECK(true);
CREATE POLICY badge_template_state_operator ON confsys.badge_template_state TO confsys_migrator USING(true) WITH CHECK(true);
