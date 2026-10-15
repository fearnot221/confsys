-- Preserve conference-wide finance cancellation, binding issuer only at insertion.
DROP POLICY notification_batches_finance ON confsys.notification_batches;
CREATE POLICY notification_batches_finance_read ON confsys.notification_batches FOR SELECT TO confsys_app
 USING(kind='payment_reminder' AND current_setting('app.finance_admin',true)='true' AND nullif(current_setting('app.actor_id',true),'') IS NOT NULL);
CREATE POLICY notification_batches_finance_create ON confsys.notification_batches FOR INSERT TO confsys_app
 WITH CHECK(kind='payment_reminder' AND current_setting('app.finance_admin',true)='true' AND created_by=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE POLICY notification_batches_finance_cancel ON confsys.notification_batches FOR UPDATE TO confsys_app
 USING(kind='payment_reminder' AND current_setting('app.finance_admin',true)='true' AND nullif(current_setting('app.actor_id',true),'') IS NOT NULL)
 WITH CHECK(kind='payment_reminder' AND current_setting('app.finance_admin',true)='true' AND nullif(current_setting('app.actor_id',true),'') IS NOT NULL);
-- Existing column grant permits only cancelled_at, never kind, issuer or content.
