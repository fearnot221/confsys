-- Preserve honest historical evidence. No default for future private-data exports.
ALTER TABLE confsys.export_jobs ADD COLUMN purpose text;
UPDATE confsys.export_jobs SET purpose='Legacy export: purpose not recorded';
ALTER TABLE confsys.export_jobs ALTER COLUMN purpose SET NOT NULL;
ALTER TABLE confsys.export_jobs ADD CONSTRAINT export_purpose_explicit CHECK(purpose=btrim(purpose) AND char_length(purpose) BETWEEN 3 AND 300);
