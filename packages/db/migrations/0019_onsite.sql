ALTER TABLE confsys.user_roles DROP CONSTRAINT user_roles_role_check;
ALTER TABLE confsys.user_roles ADD CONSTRAINT user_roles_role_check CHECK(role IN('conference_staff','conference_admin','finance','chair','reviewer','onsite','competition_judge'));
ALTER TABLE confsys.role_invitations DROP CONSTRAINT role_invitations_role_check;
ALTER TABLE confsys.role_invitations ADD CONSTRAINT role_invitations_role_check CHECK(role IN('conference_staff','conference_admin','finance','chair','reviewer','onsite','competition_judge'));
CREATE TABLE confsys.onsite_tokens(registration_id uuid PRIMARY KEY REFERENCES confsys.registrations(id),token_id uuid NOT NULL UNIQUE,token_hash text NOT NULL UNIQUE CHECK(token_hash~'^[a-f0-9]{64}$'),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE confsys.onsite_checkins(id uuid PRIMARY KEY,registration_id uuid NOT NULL REFERENCES confsys.registrations(id),active boolean NOT NULL DEFAULT true,actor_id uuid NOT NULL REFERENCES confsys.users(id),idempotency_key uuid NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX onsite_one_active_checkin ON confsys.onsite_checkins(registration_id) WHERE active;
CREATE TABLE confsys.onsite_checkin_reversals(checkin_id uuid PRIMARY KEY REFERENCES confsys.onsite_checkins(id),actor_id uuid NOT NULL REFERENCES confsys.users(id),reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 300),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE confsys.onsite_redemptions(id uuid PRIMARY KEY,booking_id uuid NOT NULL REFERENCES confsys.activity_bookings(id),quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 20),active boolean NOT NULL DEFAULT true,actor_id uuid NOT NULL REFERENCES confsys.users(id),idempotency_key uuid NOT NULL UNIQUE,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE confsys.onsite_redemption_reversals(redemption_id uuid PRIMARY KEY REFERENCES confsys.onsite_redemptions(id),actor_id uuid NOT NULL REFERENCES confsys.users(id),reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 300),created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT ON confsys.onsite_tokens,confsys.onsite_checkins,confsys.onsite_checkin_reversals,confsys.onsite_redemptions,confsys.onsite_redemption_reversals TO confsys_app;
GRANT UPDATE(token_id,token_hash,created_at) ON confsys.onsite_tokens TO confsys_app;
GRANT UPDATE(active) ON confsys.onsite_checkins,confsys.onsite_redemptions TO confsys_app;
CREATE POLICY registrations_onsite ON confsys.registrations FOR SELECT TO confsys_app USING(current_setting('app.onsite_admin',true)='true');
CREATE POLICY orders_onsite ON confsys.orders FOR SELECT TO confsys_app USING(current_setting('app.onsite_admin',true)='true');
CREATE POLICY activity_bookings_onsite ON confsys.activity_bookings FOR SELECT TO confsys_app USING(current_setting('app.onsite_admin',true)='true');
-- Reuse authoritative aggregate projection if finance module supplies it; otherwise
-- this narrow view exposes only order IDs and paid/refunded totals, not payer data.
-- Main integrate an existing order_finance_totals view instead of duplicating.
CREATE FUNCTION confsys.check_redemption_quantity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE total integer; allowed integer; booking_state text;
BEGIN
 PERFORM singleton FROM confsys.registration_state FOR UPDATE;
 SELECT quantity,state INTO allowed,booking_state FROM confsys.activity_bookings WHERE id=NEW.booking_id;
 SELECT coalesce(sum(quantity),0)::integer INTO total FROM confsys.onsite_redemptions WHERE booking_id=NEW.booking_id AND active;
 IF allowed IS NULL OR booking_state<>'reserved' OR total+NEW.quantity>allowed THEN RAISE EXCEPTION 'Redemption exceeds booking' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER redemption_quantity BEFORE INSERT ON confsys.onsite_redemptions FOR EACH ROW EXECUTE FUNCTION confsys.check_redemption_quantity();
-- Main add RLS to tokens/onsite tables with owner reads via registrations and writes
-- app.onsite_admin=true except own token issuance. Migrator explicit operator policies.

-- Owner-evaluated view exposes only settlement eligibility, never bank data or private allocation rows.
CREATE VIEW confsys.order_settlement_status AS SELECT o.id AS order_id,(o.state='open' AND coalesce((SELECT sum(a.amount) FROM confsys.payment_allocations a JOIN confsys.payments p ON p.id=a.payment_id WHERE a.order_id=o.id AND p.state='verified'),0)-coalesce((SELECT sum(r.amount) FROM confsys.refunds r JOIN confsys.payment_allocations a ON a.id=r.allocation_id WHERE a.order_id=o.id),0)>=o.amount) AS settled FROM confsys.orders o WHERE o.user_id=nullif(current_setting('app.actor_id',true),'')::uuid OR current_setting('app.finance_admin',true)='true' OR current_setting('app.onsite_admin',true)='true';
GRANT SELECT ON confsys.order_settlement_status TO confsys_app;
ALTER TABLE confsys.onsite_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.onsite_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY onsite_tokens_operator ON confsys.onsite_tokens TO confsys_migrator USING(true) WITH CHECK(true);
CREATE POLICY onsite_tokens_read ON confsys.onsite_tokens FOR SELECT TO confsys_app USING(current_setting('app.onsite_admin',true)='true' OR EXISTS(SELECT 1 FROM confsys.registrations r WHERE r.id=registration_id AND r.user_id=nullif(current_setting('app.actor_id',true),'')::uuid));
CREATE POLICY onsite_tokens_write ON confsys.onsite_tokens FOR INSERT TO confsys_app WITH CHECK(current_setting('app.onsite_admin',true)='true' OR EXISTS(SELECT 1 FROM confsys.registrations r WHERE r.id=registration_id AND r.user_id=nullif(current_setting('app.actor_id',true),'')::uuid));
CREATE POLICY onsite_tokens_update ON confsys.onsite_tokens FOR UPDATE TO confsys_app USING(current_setting('app.onsite_admin',true)='true' OR EXISTS(SELECT 1 FROM confsys.registrations r WHERE r.id=registration_id AND r.user_id=nullif(current_setting('app.actor_id',true),'')::uuid)) WITH CHECK(current_setting('app.onsite_admin',true)='true' OR EXISTS(SELECT 1 FROM confsys.registrations r WHERE r.id=registration_id AND r.user_id=nullif(current_setting('app.actor_id',true),'')::uuid));
ALTER TABLE confsys.onsite_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.onsite_checkins FORCE ROW LEVEL SECURITY;
CREATE POLICY onsite_checkins_operator ON confsys.onsite_checkins TO confsys_migrator USING(true) WITH CHECK(true);
CREATE POLICY onsite_checkins_read ON confsys.onsite_checkins FOR SELECT TO confsys_app USING(current_setting('app.onsite_admin',true)='true' OR EXISTS(SELECT 1 FROM confsys.registrations r WHERE r.id=registration_id AND r.user_id=nullif(current_setting('app.actor_id',true),'')::uuid));
CREATE POLICY onsite_checkins_write ON confsys.onsite_checkins FOR INSERT TO confsys_app WITH CHECK(current_setting('app.onsite_admin',true)='true');
CREATE POLICY onsite_checkins_update ON confsys.onsite_checkins FOR UPDATE TO confsys_app USING(current_setting('app.onsite_admin',true)='true') WITH CHECK(current_setting('app.onsite_admin',true)='true');
ALTER TABLE confsys.onsite_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.onsite_redemptions FORCE ROW LEVEL SECURITY;
CREATE POLICY onsite_redemptions_operator ON confsys.onsite_redemptions TO confsys_migrator USING(true) WITH CHECK(true);
CREATE POLICY onsite_redemptions_read ON confsys.onsite_redemptions FOR SELECT TO confsys_app USING(current_setting('app.onsite_admin',true)='true' OR EXISTS(SELECT 1 FROM confsys.activity_bookings b WHERE b.id=booking_id AND b.user_id=nullif(current_setting('app.actor_id',true),'')::uuid));
CREATE POLICY onsite_redemptions_write ON confsys.onsite_redemptions FOR INSERT TO confsys_app WITH CHECK(current_setting('app.onsite_admin',true)='true');
CREATE POLICY onsite_redemptions_update ON confsys.onsite_redemptions FOR UPDATE TO confsys_app USING(current_setting('app.onsite_admin',true)='true') WITH CHECK(current_setting('app.onsite_admin',true)='true');
ALTER TABLE confsys.onsite_checkin_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.onsite_checkin_reversals FORCE ROW LEVEL SECURITY;
CREATE POLICY onsite_checkin_reversals_operator ON confsys.onsite_checkin_reversals TO confsys_migrator USING(true) WITH CHECK(true);
CREATE POLICY onsite_checkin_reversals_read ON confsys.onsite_checkin_reversals FOR SELECT TO confsys_app USING(current_setting('app.onsite_admin',true)='true' OR false);
CREATE POLICY onsite_checkin_reversals_write ON confsys.onsite_checkin_reversals FOR INSERT TO confsys_app WITH CHECK(current_setting('app.onsite_admin',true)='true');
ALTER TABLE confsys.onsite_redemption_reversals ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.onsite_redemption_reversals FORCE ROW LEVEL SECURITY;
CREATE POLICY onsite_redemption_reversals_operator ON confsys.onsite_redemption_reversals TO confsys_migrator USING(true) WITH CHECK(true);
CREATE POLICY onsite_redemption_reversals_read ON confsys.onsite_redemption_reversals FOR SELECT TO confsys_app USING(current_setting('app.onsite_admin',true)='true' OR false);
CREATE POLICY onsite_redemption_reversals_write ON confsys.onsite_redemption_reversals FOR INSERT TO confsys_app WITH CHECK(current_setting('app.onsite_admin',true)='true');

CREATE FUNCTION confsys.prevent_redeemed_booking_cancel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state='cancelled' AND EXISTS(SELECT 1 FROM confsys.onsite_redemptions WHERE booking_id=NEW.id AND active) THEN RAISE EXCEPTION 'Reverse redemption before cancellation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER booking_redemption_guard BEFORE UPDATE ON confsys.activity_bookings FOR EACH ROW EXECUTE FUNCTION confsys.prevent_redeemed_booking_cancel();
