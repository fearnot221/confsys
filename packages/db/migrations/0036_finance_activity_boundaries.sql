-- Existing rows are retained. Invalid historical ownership fails migration rather
-- than being silently rewritten; inspect and repair through audited operator work.
ALTER TABLE confsys.order_payers ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.order_payers FORCE ROW LEVEL SECURITY;
CREATE POLICY order_payers_operator ON confsys.order_payers TO confsys_migrator USING(true) WITH CHECK(true);
-- Do not query orders in SELECT: orders' delegated-read policy queries this table.
CREATE POLICY order_payers_read ON confsys.order_payers FOR SELECT TO confsys_app USING(
 payer_id=nullif(current_setting('app.actor_id',true),'')::uuid OR
 granted_by=nullif(current_setting('app.actor_id',true),'')::uuid OR
 current_setting('app.finance_admin',true)='true');
CREATE POLICY order_payers_insert ON confsys.order_payers FOR INSERT TO confsys_app WITH CHECK(
 granted_by=nullif(current_setting('app.actor_id',true),'')::uuid AND
 EXISTS(SELECT 1 FROM confsys.orders o WHERE o.id=order_id AND o.user_id=nullif(current_setting('app.actor_id',true),'')::uuid));
CREATE POLICY order_payers_delete ON confsys.order_payers FOR DELETE TO confsys_app USING(
 granted_by=nullif(current_setting('app.actor_id',true),'')::uuid AND
 EXISTS(SELECT 1 FROM confsys.orders o WHERE o.id=order_id AND o.user_id=nullif(current_setting('app.actor_id',true),'')::uuid));
ALTER TABLE confsys.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.order_items FORCE ROW LEVEL SECURITY;
CREATE POLICY order_items_operator ON confsys.order_items TO confsys_migrator USING(true) WITH CHECK(true);
CREATE POLICY order_items_read ON confsys.order_items FOR SELECT TO confsys_app USING(EXISTS(SELECT 1 FROM confsys.orders o WHERE o.id=order_id));
CREATE POLICY order_items_insert ON confsys.order_items FOR INSERT TO confsys_app WITH CHECK(EXISTS(
 SELECT 1 FROM confsys.orders o WHERE o.id=order_id AND
 (o.user_id=nullif(current_setting('app.actor_id',true),'')::uuid OR current_setting('app.registration_admin',true)='true')));
ALTER TABLE confsys.orders ADD CONSTRAINT orders_registration_owner_unique UNIQUE(id,registration_id,user_id);
ALTER TABLE confsys.activity_bookings ADD CONSTRAINT activity_booking_registration_owner FOREIGN KEY(registration_id,user_id) REFERENCES confsys.registrations(id,user_id);
ALTER TABLE confsys.activity_bookings ADD CONSTRAINT activity_booking_order_owner FOREIGN KEY(order_id,registration_id,user_id) REFERENCES confsys.orders(id,registration_id,user_id);
