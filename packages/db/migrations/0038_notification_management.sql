CREATE TABLE confsys.notification_template_versions(
 id uuid PRIMARY KEY,template_key text NOT NULL CHECK(template_key ~ '^[a-z0-9-]{1,80}$'),
 version integer NOT NULL CHECK(version>0),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 200),message_text text NOT NULL CHECK(length(message_text) BETWEEN 1 AND 4000),
 created_by uuid NOT NULL REFERENCES confsys.users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(template_key,version)
);
ALTER TABLE confsys.notification_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.notification_template_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_templates_manager ON confsys.notification_template_versions TO confsys_app USING(current_setting('app.notifications_manage',true)='true') WITH CHECK(current_setting('app.notifications_manage',true)='true');
CREATE POLICY notification_templates_operator ON confsys.notification_template_versions TO confsys_migrator USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON confsys.notification_template_versions TO confsys_app;
ALTER TABLE confsys.notification_batches ADD COLUMN scheduled_at timestamptz,ADD COLUMN template_version_id uuid REFERENCES confsys.notification_template_versions(id),ADD COLUMN audience jsonb CHECK(audience IS NULL OR jsonb_typeof(audience)='object');
ALTER TABLE confsys.notifications ADD COLUMN available_at timestamptz;
UPDATE confsys.notifications SET available_at=created_at;
ALTER TABLE confsys.notifications ALTER COLUMN available_at SET DEFAULT now(),ALTER COLUMN available_at SET NOT NULL;
-- Worker has no UPDATE grant on immutable initial availability. Retry timing is separate.
CREATE OR REPLACE VIEW confsys.user_notification_feed WITH(security_barrier=true) AS
 SELECT n.id,n.message_subject AS subject,n.message_text AS text,n.status,n.created_at
 FROM confsys.notifications n LEFT JOIN confsys.notification_batches b ON b.id=n.batch_id
 WHERE n.kind='business' AND n.user_id=nullif(current_setting('app.actor_id',true),'')::uuid
 AND n.available_at<=clock_timestamp() AND (n.batch_id IS NULL OR b.cancelled_at IS NULL OR b.cancelled_at>=n.available_at);
CREATE VIEW confsys.notification_audience WITH(security_barrier=true) AS
 SELECT u.id,u.email,
 ARRAY(SELECT r.role FROM confsys.user_roles r WHERE r.user_id=u.id ORDER BY r.role) AS roles,
 (SELECT r.state FROM confsys.registrations r WHERE r.user_id=u.id) AS registration_state,
 ARRAY(SELECT DISTINCT s.state FROM confsys.submissions s WHERE s.owner_id=u.id ORDER BY s.state) AS submission_states,
 ARRAY(SELECT DISTINCT d.outcome FROM confsys.submissions s JOIN confsys.review_publications p ON p.submission_id=s.id JOIN confsys.review_decisions d ON d.id=p.decision_id WHERE s.owner_id=u.id ORDER BY d.outcome) AS published_outcomes
 FROM confsys.users u WHERE current_setting('app.notifications_manage',true)='true' AND u.state='active' AND u.verified_at IS NOT NULL;
CREATE VIEW confsys.notification_batch_deliveries WITH(security_barrier=true) AS
 SELECT n.id,n.batch_id,n.user_id,u.email,n.status,n.result_code,n.provider_id,n.attempts,n.next_attempt_at,n.available_at,n.expires_at,n.created_at
 FROM confsys.notifications n JOIN confsys.users u ON u.id=n.user_id
 WHERE n.kind='business' AND n.batch_id IS NOT NULL AND current_setting('app.notifications_manage',true)='true';
GRANT SELECT ON confsys.notification_audience,confsys.notification_batch_deliveries TO confsys_app;
