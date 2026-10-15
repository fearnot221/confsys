ALTER TABLE confsys.notification_batches ADD COLUMN kind text NOT NULL DEFAULT 'general' CHECK(kind IN('general','payment_reminder'));
CREATE POLICY notification_batches_finance ON confsys.notification_batches TO confsys_app
 USING(kind='payment_reminder' AND current_setting('app.finance_admin',true)='true' AND nullif(current_setting('app.actor_id',true),'') IS NOT NULL)
 WITH CHECK(kind='payment_reminder' AND current_setting('app.finance_admin',true)='true' AND created_by=nullif(current_setting('app.actor_id',true),'')::uuid);
-- Internal owner-evaluated relation: no runtime grant exposes all order balances.
CREATE VIEW confsys.unpaid_order_balances AS
 SELECT o.id,o.user_id,o.currency,o.amount-coalesce((SELECT sum(a.amount) FROM confsys.payment_allocations a JOIN confsys.payments p ON p.id=a.payment_id WHERE a.order_id=o.id AND p.state='verified'),0)+coalesce((SELECT sum(r.amount) FROM confsys.refunds r JOIN confsys.payment_allocations a ON a.id=r.allocation_id WHERE a.order_id=o.id),0) AS outstanding
 FROM confsys.orders o WHERE o.state='open';
CREATE VIEW confsys.finance_reminder_audience WITH(security_barrier=true) AS
 SELECT u.id,u.email,(SELECT jsonb_agg(jsonb_build_object('currency',d.currency,'amount',d.amount::text) ORDER BY d.currency) FROM (SELECT b.currency,sum(b.outstanding) AS amount FROM confsys.unpaid_order_balances b WHERE b.user_id=u.id AND b.outstanding>0 GROUP BY b.currency) d) AS balances
 FROM confsys.users u WHERE current_setting('app.finance_admin',true)='true' AND EXISTS(SELECT 1 FROM confsys.users actor WHERE actor.id=nullif(current_setting('app.actor_id',true),'')::uuid AND actor.state='active' AND actor.verified_at IS NOT NULL) AND u.state='active' AND u.verified_at IS NOT NULL
 AND EXISTS(SELECT 1 FROM confsys.unpaid_order_balances b WHERE b.user_id=u.id AND b.outstanding>0);
GRANT SELECT ON confsys.finance_reminder_audience TO confsys_app;
CREATE OR REPLACE VIEW confsys.notification_batch_authority WITH(security_barrier=true) AS
 SELECT n.id,b.cancelled_at IS NULL AND u.state='active' AND u.verified_at IS NOT NULL AND u.credential_version=b.issuer_credential_version
 AND (b.kind='general' OR EXISTS(SELECT 1 FROM confsys.unpaid_order_balances q WHERE q.user_id=n.user_id AND q.outstanding>0)) AS active,
 ARRAY(SELECT r.role FROM confsys.user_roles r WHERE r.user_id=b.created_by) AS roles,b.kind
 FROM confsys.notifications n JOIN confsys.notification_batches b ON b.id=n.batch_id JOIN confsys.users u ON u.id=b.created_by WHERE n.status IN('pending','processing');
CREATE OR REPLACE VIEW confsys.notification_batch_status WITH(security_barrier=true) AS
 SELECT n.batch_id,n.status,count(*)::integer AS count FROM confsys.notifications n JOIN confsys.notification_batches b ON b.id=n.batch_id
 WHERE current_setting('app.notifications_manage',true)='true' OR (b.kind='payment_reminder' AND current_setting('app.finance_admin',true)='true')
 GROUP BY n.batch_id,n.status;
CREATE OR REPLACE VIEW confsys.user_notification_feed WITH(security_barrier=true) AS
 SELECT n.id,n.message_subject AS subject,n.message_text AS text,n.status,n.created_at
 FROM confsys.notifications n LEFT JOIN confsys.notification_batches b ON b.id=n.batch_id
 WHERE n.kind='business' AND n.user_id=nullif(current_setting('app.actor_id',true),'')::uuid
 AND n.available_at<=clock_timestamp()
 AND ((b.scheduled_at IS NULL AND coalesce(b.kind,'general')='general') OR n.released_at IS NOT NULL)
 AND (n.batch_id IS NULL OR b.cancelled_at IS NULL OR b.cancelled_at>=n.available_at);
-- singleton has CHECK(singleton), so this column grant permits row locking only.
GRANT SELECT(singleton),UPDATE(singleton) ON confsys.registration_state TO confsys_worker;
