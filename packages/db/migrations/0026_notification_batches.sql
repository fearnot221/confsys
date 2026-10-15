CREATE TABLE confsys.notification_batches(
 id uuid PRIMARY KEY,created_by uuid NOT NULL REFERENCES confsys.users(id),
 issuer_credential_version integer NOT NULL,
 idempotency_key uuid NOT NULL UNIQUE,request_hash text NOT NULL,
 subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 200),
 message_text text NOT NULL CHECK(length(message_text) BETWEEN 1 AND 4000),
 recipient_ids uuid[] NOT NULL CHECK(cardinality(recipient_ids) BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(),cancelled_at timestamptz
);
ALTER TABLE confsys.notification_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.notification_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_batches_manager ON confsys.notification_batches TO confsys_app USING(current_setting('app.notifications_manage',true)='true') WITH CHECK(current_setting('app.notifications_manage',true)='true');
CREATE POLICY notification_batches_operator ON confsys.notification_batches TO confsys_migrator USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON confsys.notification_batches TO confsys_app;
GRANT UPDATE(cancelled_at) ON confsys.notification_batches TO confsys_app;
ALTER TABLE confsys.notifications ADD COLUMN batch_id uuid REFERENCES confsys.notification_batches(id);
ALTER TABLE confsys.notifications ADD CONSTRAINT notification_batch_business CHECK(batch_id IS NULL OR kind='business');
GRANT INSERT(batch_id) ON confsys.notifications TO confsys_app;
CREATE VIEW confsys.notification_batch_authority WITH(security_barrier=true) AS
 SELECT n.id,b.cancelled_at IS NULL AND u.state='active' AND u.verified_at IS NOT NULL AND u.credential_version=b.issuer_credential_version AS active,
 ARRAY(SELECT r.role FROM confsys.user_roles r WHERE r.user_id=b.created_by) AS roles
 FROM confsys.notifications n JOIN confsys.notification_batches b ON b.id=n.batch_id JOIN confsys.users u ON u.id=b.created_by WHERE n.status IN('pending','processing');
GRANT SELECT ON confsys.notification_batch_authority TO confsys_worker;
CREATE VIEW confsys.notification_batch_status WITH(security_barrier=true) AS
 SELECT n.batch_id,n.status,count(*)::integer AS count FROM confsys.notifications n
 WHERE n.batch_id IS NOT NULL AND current_setting('app.notifications_manage',true)='true'
 GROUP BY n.batch_id,n.status;
GRANT SELECT ON confsys.notification_batch_status TO confsys_app;
