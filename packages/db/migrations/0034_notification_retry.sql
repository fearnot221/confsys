ALTER TABLE confsys.notification_batches ADD COLUMN retry_of uuid UNIQUE REFERENCES confsys.notification_batches(id);
GRANT INSERT(retry_of) ON confsys.notification_batches TO confsys_app;
-- No raw token/message access or broad UPDATE on notifications is granted.
CREATE VIEW confsys.notification_batch_retry_source WITH(security_barrier=true) AS
 SELECT n.id,n.batch_id,n.user_id,n.status,n.result_code,
 n.expires_at>clock_timestamp() AND u.state='active' AND u.verified_at IS NOT NULL AS recipient_eligible
 FROM confsys.notifications n JOIN confsys.users u ON u.id=n.user_id
 WHERE n.batch_id IS NOT NULL AND current_setting('app.notifications_manage',true)='true';
GRANT SELECT ON confsys.notification_batch_retry_source TO confsys_app;
