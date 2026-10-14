-- NULL must not satisfy a ready-artifact invariant through SQL three-valued logic.
-- Existing invalid rows cause migration failure; inspect and cancel/recreate those
-- jobs explicitly rather than inventing hashes or marking missing output ready.
ALTER TABLE confsys.document_jobs ADD CONSTRAINT document_jobs_ready_output CHECK(status<>'ready' OR(pdf IS NOT NULL AND sha256 IS NOT NULL AND sha256~'^[a-f0-9]{64}$' AND completed_at IS NOT NULL));
ALTER TABLE confsys.export_jobs ADD CONSTRAINT export_jobs_ready_output CHECK(status<>'ready' OR(csv IS NOT NULL AND sha256 IS NOT NULL AND sha256~'^[a-f0-9]{64}$' AND row_count IS NOT NULL AND row_count>=0 AND snapshot_at IS NOT NULL AND completed_at IS NOT NULL));
ALTER TABLE confsys.export_jobs ADD CONSTRAINT export_jobs_row_count CHECK(row_count IS NULL OR row_count>=0);
ALTER TABLE confsys.export_jobs ADD CONSTRAINT export_jobs_expiry_window CHECK(expires_at>created_at AND expires_at<=created_at+interval '24 hours');
