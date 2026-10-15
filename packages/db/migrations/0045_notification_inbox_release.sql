-- Scheduled content is released only by an authorized worker preflight.
-- No historical scheduled release is guessed; immediate notifications retain
-- their existing visibility. Unreleased historical scheduled rows stay hidden.
ALTER TABLE confsys.notifications ADD COLUMN released_at timestamptz;
GRANT UPDATE(released_at) ON confsys.notifications TO confsys_worker;
CREATE OR REPLACE VIEW confsys.user_notification_feed WITH(security_barrier=true) AS
 SELECT n.id,n.message_subject AS subject,n.message_text AS text,n.status,n.created_at
 FROM confsys.notifications n LEFT JOIN confsys.notification_batches b ON b.id=n.batch_id
 WHERE n.kind='business' AND n.user_id=nullif(current_setting('app.actor_id',true),'')::uuid
 AND n.available_at<=clock_timestamp()
 AND (b.scheduled_at IS NULL OR n.released_at IS NOT NULL)
 AND (n.batch_id IS NULL OR b.cancelled_at IS NULL OR b.cancelled_at>=n.available_at);
