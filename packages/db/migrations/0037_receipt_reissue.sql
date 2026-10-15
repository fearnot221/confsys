ALTER TABLE confsys.receipts DROP CONSTRAINT receipts_order_id_key;
ALTER TABLE confsys.receipts ADD CONSTRAINT receipts_id_order_unique UNIQUE(id,order_id);
ALTER TABLE confsys.receipts ADD COLUMN reissue_of uuid UNIQUE;
ALTER TABLE confsys.receipts ADD COLUMN reissue_reason text;
ALTER TABLE confsys.receipts ADD CONSTRAINT receipt_reissue_source FOREIGN KEY(reissue_of,order_id) REFERENCES confsys.receipts(id,order_id);
ALTER TABLE confsys.receipts ADD CONSTRAINT receipt_reissue_reason CHECK((reissue_of IS NULL AND reissue_reason IS NULL) OR (reissue_of IS NOT NULL AND reissue_reason IS NOT NULL AND reissue_of<>id AND length(reissue_reason) BETWEEN 3 AND 300));
CREATE UNIQUE INDEX receipts_one_issued_order ON confsys.receipts(order_id) WHERE state='issued';
CREATE UNIQUE INDEX receipts_one_original_order ON confsys.receipts(order_id) WHERE reissue_of IS NULL;
CREATE FUNCTION confsys.protect_receipt_lineage() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,confsys AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.order_id,NEW.reissue_of,NEW.reissue_reason) IS DISTINCT FROM (OLD.order_id,OLD.reissue_of,OLD.reissue_reason) THEN
   RAISE EXCEPTION 'Receipt lineage is immutable' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.reissue_of IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM confsys.receipts r WHERE r.id=NEW.reissue_of AND r.order_id=NEW.order_id AND r.state='void') THEN
   RAISE EXCEPTION 'Receipt reissue requires a void source for same order' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER receipt_lineage_guard BEFORE INSERT OR UPDATE OF order_id,reissue_of,reissue_reason ON confsys.receipts FOR EACH ROW EXECUTE FUNCTION confsys.protect_receipt_lineage();
