CREATE TABLE confsys.payments(id uuid PRIMARY KEY,payer_id uuid NOT NULL REFERENCES confsys.users(id),state text NOT NULL CHECK(state IN('submitted','verified','rejected')),amount bigint NOT NULL CHECK(amount>0 AND amount<=999999999999),currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),reference text NOT NULL,evidence_file_id uuid REFERENCES confsys.file_assets(id),idempotency_key uuid NOT NULL,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),verified_by uuid REFERENCES confsys.users(id),UNIQUE(payer_id,idempotency_key));
CREATE UNIQUE INDEX payments_verified_reference ON confsys.payments(currency,reference) WHERE state='verified';
CREATE TABLE confsys.order_payers(order_id uuid NOT NULL REFERENCES confsys.orders(id),payer_id uuid NOT NULL REFERENCES confsys.users(id),granted_by uuid NOT NULL REFERENCES confsys.users(id),PRIMARY KEY(order_id,payer_id));
CREATE TABLE confsys.payment_allocations(id uuid PRIMARY KEY,payment_id uuid NOT NULL REFERENCES confsys.payments(id),order_id uuid NOT NULL REFERENCES confsys.orders(id),amount bigint NOT NULL CHECK(amount>0 AND amount<=999999999999),created_by uuid NOT NULL REFERENCES confsys.users(id),idempotency_key uuid NOT NULL UNIQUE,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE confsys.refunds(id uuid PRIMARY KEY,allocation_id uuid NOT NULL REFERENCES confsys.payment_allocations(id),amount bigint NOT NULL CHECK(amount>0 AND amount<=999999999999),reference text NOT NULL UNIQUE,reason text NOT NULL,created_by uuid NOT NULL REFERENCES confsys.users(id),idempotency_key uuid NOT NULL UNIQUE,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT ON confsys.payments,confsys.order_payers,confsys.payment_allocations,confsys.refunds TO confsys_app;
GRANT UPDATE(state,verified_by) ON confsys.payments TO confsys_app;
GRANT DELETE ON confsys.order_payers TO confsys_app;
ALTER TABLE confsys.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.payments FORCE ROW LEVEL SECURITY;
CREATE POLICY payments_actor ON confsys.payments TO confsys_app USING(payer_id=nullif(current_setting('app.actor_id',true),'')::uuid OR current_setting('app.finance_admin',true)='true') WITH CHECK(payer_id=nullif(current_setting('app.actor_id',true),'')::uuid OR current_setting('app.finance_admin',true)='true');
CREATE POLICY payments_operator ON confsys.payments TO confsys_migrator USING(true) WITH CHECK(true);
CREATE POLICY orders_finance ON confsys.orders FOR SELECT TO confsys_app USING(current_setting('app.finance_admin',true)='true' OR EXISTS(SELECT 1 FROM confsys.order_payers p WHERE p.order_id=confsys.orders.id AND p.payer_id=nullif(current_setting('app.actor_id',true),'')::uuid));
CREATE POLICY registrations_finance ON confsys.registrations FOR SELECT TO confsys_app USING(current_setting('app.finance_admin',true)='true');
-- Allocation/refund totals are authoritative constraints, including direct runtime SQL.
-- All mutation paths take registration_state before financial rows, sharing registration cancel/config lock order.
CREATE FUNCTION confsys.check_allocation_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p confsys.payments; o confsys.orders; total bigint;
BEGIN
 PERFORM singleton FROM confsys.registration_state FOR UPDATE;
 SELECT * INTO p FROM confsys.payments WHERE id=NEW.payment_id;
 SELECT * INTO o FROM confsys.orders WHERE id=NEW.order_id;
 IF p.id IS NULL OR o.id IS NULL OR p.state<>'verified' OR o.state<>'open' OR p.currency<>o.currency THEN RAISE EXCEPTION 'Invalid allocation' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(amount),0) INTO total FROM confsys.payment_allocations WHERE payment_id=p.id;
 IF total+NEW.amount>p.amount THEN RAISE EXCEPTION 'Payment over-allocation' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(amount),0) INTO total FROM confsys.payment_allocations WHERE order_id=o.id;
 IF total+NEW.amount>o.amount THEN RAISE EXCEPTION 'Order over-allocation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER allocation_balance BEFORE INSERT ON confsys.payment_allocations FOR EACH ROW EXECUTE FUNCTION confsys.check_allocation_balance();
CREATE FUNCTION confsys.check_refund_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE available bigint; total bigint;
BEGIN
 PERFORM singleton FROM confsys.registration_state FOR UPDATE;
 SELECT amount INTO available FROM confsys.payment_allocations WHERE id=NEW.allocation_id;
 SELECT coalesce(sum(amount),0) INTO total FROM confsys.refunds WHERE allocation_id=NEW.allocation_id;
 IF available IS NULL OR total+NEW.amount>available THEN RAISE EXCEPTION 'Refund exceeds allocation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER refund_balance BEFORE INSERT ON confsys.refunds FOR EACH ROW EXECUTE FUNCTION confsys.check_refund_balance();
ALTER TABLE confsys.payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.payment_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY allocations_read ON confsys.payment_allocations FOR SELECT TO confsys_app USING(current_setting('app.finance_admin',true)='true' OR EXISTS(SELECT 1 FROM confsys.payments p WHERE p.id=payment_id) OR EXISTS(SELECT 1 FROM confsys.orders o WHERE o.id=order_id));
CREATE POLICY allocations_insert ON confsys.payment_allocations FOR INSERT TO confsys_app WITH CHECK(current_setting('app.finance_admin',true)='true');
CREATE POLICY allocations_operator ON confsys.payment_allocations TO confsys_migrator USING(true) WITH CHECK(true);
ALTER TABLE confsys.refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.refunds FORCE ROW LEVEL SECURITY;
CREATE POLICY refunds_read ON confsys.refunds FOR SELECT TO confsys_app USING(current_setting('app.finance_admin',true)='true' OR EXISTS(SELECT 1 FROM confsys.payment_allocations a WHERE a.id=allocation_id));
CREATE POLICY refunds_insert ON confsys.refunds FOR INSERT TO confsys_app WITH CHECK(current_setting('app.finance_admin',true)='true');
CREATE POLICY refunds_operator ON confsys.refunds TO confsys_migrator USING(true) WITH CHECK(true);
