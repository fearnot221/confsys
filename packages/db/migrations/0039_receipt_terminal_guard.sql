-- Forward-only protection: a void receipt remains terminal, including after its child is void.
CREATE FUNCTION confsys.receipt_void_is_terminal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,confsys AS $$
BEGIN
 IF OLD.state='void' AND NEW.state<>'void' THEN
  RAISE EXCEPTION 'A void receipt cannot be restored; explicitly reissue with a new number' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER receipt_void_terminal_guard BEFORE UPDATE OF state ON confsys.receipts FOR EACH ROW EXECUTE FUNCTION confsys.receipt_void_is_terminal();
