-- Proposed main migration 0021. Auth notifications and secrets are intentionally absent.
CREATE TABLE confsys.notification_reads (
 notification_id uuid PRIMARY KEY REFERENCES confsys.notifications(id),
 user_id uuid NOT NULL REFERENCES confsys.users(id),
 read_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE confsys.notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.notification_reads FORCE ROW LEVEL SECURITY;
CREATE VIEW confsys.user_notification_feed WITH (security_barrier=true) AS
 SELECT n.id,n.message_subject AS subject,n.message_text AS text,n.status,n.created_at
 FROM confsys.notifications n WHERE n.kind='business' AND n.user_id=nullif(current_setting('app.actor_id',true),'')::uuid;
GRANT SELECT ON confsys.user_notification_feed TO confsys_app;
GRANT SELECT,INSERT ON confsys.notification_reads TO confsys_app;
CREATE POLICY notification_reads_operator ON confsys.notification_reads TO confsys_migrator USING(true) WITH CHECK(true);

CREATE POLICY notification_reads_owner ON confsys.notification_reads TO confsys_app
 USING(user_id=nullif(current_setting('app.actor_id',true),'')::uuid)
 WITH CHECK(user_id=nullif(current_setting('app.actor_id',true),'')::uuid AND EXISTS(SELECT 1 FROM confsys.user_notification_feed f WHERE f.id=notification_id));
