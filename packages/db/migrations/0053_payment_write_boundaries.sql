-- Preserve participant reads/submissions while reserving reconciliation writes.
DROP POLICY payments_actor ON confsys.payments;
CREATE POLICY payments_read ON confsys.payments FOR SELECT TO confsys_app
 USING(payer_id=nullif(current_setting('app.actor_id',true),'')::uuid OR current_setting('app.finance_admin',true)='true');
CREATE POLICY payments_submit ON confsys.payments FOR INSERT TO confsys_app
 WITH CHECK((payer_id=nullif(current_setting('app.actor_id',true),'')::uuid OR current_setting('app.finance_admin',true)='true') AND state='submitted' AND verified_by IS NULL);
CREATE POLICY payments_reconcile ON confsys.payments FOR UPDATE TO confsys_app
 USING(current_setting('app.finance_admin',true)='true')
 WITH CHECK(current_setting('app.finance_admin',true)='true' AND verified_by=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE FUNCTION confsys.payment_verification_transition() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,confsys AS $$
BEGIN
 IF (NEW.state,NEW.verified_by) IS NOT DISTINCT FROM (OLD.state,OLD.verified_by) THEN RETURN NEW; END IF;
 IF OLD.state<>'submitted' OR NEW.state NOT IN ('verified','rejected') OR NEW.verified_by IS NULL THEN
  RAISE EXCEPTION 'Payment verification is terminal' USING ERRCODE='23514',CONSTRAINT='payment_verification_transition';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payment_verification_transition BEFORE UPDATE OF state,verified_by ON confsys.payments FOR EACH ROW EXECUTE FUNCTION confsys.payment_verification_transition();
-- Stable constraint identity lets HTTP translate this known business conflict,
-- without masking arbitrary integrity failures or parsing exception messages.
CREATE OR REPLACE FUNCTION confsys.prevent_redeemed_booking_cancel() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.state='cancelled' AND EXISTS(SELECT 1 FROM confsys.onsite_redemptions WHERE booking_id=NEW.id AND active) THEN
  RAISE EXCEPTION 'Reverse redemption before cancellation' USING ERRCODE='23514',CONSTRAINT='booking_redemption_guard';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION confsys.prevent_redeemed_booking_cancel() FROM PUBLIC;

-- Refunds reduce order settlement, never the original payment gross allocation cap.
CREATE OR REPLACE FUNCTION confsys.check_allocation_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p confsys.payments; o confsys.orders; total numeric; refunded numeric;
BEGIN
 PERFORM singleton FROM confsys.registration_state FOR UPDATE;
 SELECT * INTO p FROM confsys.payments WHERE id=NEW.payment_id;
 SELECT * INTO o FROM confsys.orders WHERE id=NEW.order_id;
 IF p.id IS NULL OR o.id IS NULL OR p.state<>'verified' OR o.state<>'open' OR p.currency<>o.currency THEN RAISE EXCEPTION 'Invalid allocation' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(amount),0) INTO total FROM confsys.payment_allocations WHERE payment_id=p.id;
 IF total+NEW.amount>p.amount THEN RAISE EXCEPTION 'Payment over-allocation' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(amount),0) INTO total FROM confsys.payment_allocations WHERE order_id=o.id;
 SELECT coalesce(sum(r.amount),0) INTO refunded FROM confsys.refunds r JOIN confsys.payment_allocations a ON a.id=r.allocation_id WHERE a.order_id=o.id;
 IF total-refunded+NEW.amount>o.amount THEN RAISE EXCEPTION 'Order over-allocation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
