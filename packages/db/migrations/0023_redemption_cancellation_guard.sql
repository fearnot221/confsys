-- The invariant must see redemptions even when a registration administrator is not onsite staff.
-- This trigger returns only the caller's new row; it exposes no cross-user redemption data.
CREATE OR REPLACE FUNCTION confsys.prevent_redeemed_booking_cancel() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.state='cancelled' AND EXISTS(SELECT 1 FROM confsys.onsite_redemptions WHERE booking_id=NEW.id AND active) THEN RAISE EXCEPTION 'Reverse redemption before cancellation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION confsys.prevent_redeemed_booking_cancel() FROM PUBLIC;
