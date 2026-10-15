-- Asset metadata is private unless a trusted service establishes transaction-local context.
-- Only active published media IDs are visible to this narrow owner-evaluated projection.
CREATE VIEW confsys.active_public_media_ids WITH(security_barrier=true) AS
 SELECT r.file_id FROM confsys.file_references r JOIN confsys.site_state s ON s.active_publication_id=r.resource_id WHERE r.resource_type='site_publication';
GRANT SELECT ON confsys.active_public_media_ids TO confsys_app;
ALTER TABLE confsys.file_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.file_assets FORCE ROW LEVEL SECURITY;
CREATE POLICY file_assets_operator ON confsys.file_assets TO confsys_migrator USING(true) WITH CHECK(true);
CREATE POLICY file_assets_read ON confsys.file_assets FOR SELECT TO confsys_app USING(
 owner_id=nullif(current_setting('app.actor_id',true),'')::uuid
 OR(purpose='site_media' AND current_setting('app.files_media_manager',true)='true')
 OR id=nullif(current_setting('app.authorized_file_id',true),'')::uuid
 OR(id=nullif(current_setting('app.public_media_file_id',true),'')::uuid AND purpose='site_media' AND status='ready' AND id IN(SELECT file_id FROM confsys.active_public_media_ids))
 OR(id=nullif(current_setting('app.upload_file_id',true),'')::uuid AND storage_key=nullif(current_setting('app.upload_storage_key',true),'')::uuid AND status IN('uploading','quarantined','rejected'))
);
CREATE POLICY file_assets_create ON confsys.file_assets FOR INSERT TO confsys_app WITH CHECK(owner_id=nullif(current_setting('app.actor_id',true),'')::uuid AND status='uploading' AND(purpose<>'site_media' OR current_setting('app.files_media_manager',true)='true'));
CREATE POLICY file_assets_update ON confsys.file_assets FOR UPDATE TO confsys_app USING(owner_id=nullif(current_setting('app.actor_id',true),'')::uuid OR(purpose='site_media' AND current_setting('app.files_media_manager',true)='true')) WITH CHECK(owner_id=nullif(current_setting('app.actor_id',true),'')::uuid OR(purpose='site_media' AND current_setting('app.files_media_manager',true)='true'));
-- A transfer that loses its session can still fail closed. No arbitrary file ID or ready asset qualifies.
CREATE POLICY file_assets_finish_transfer ON confsys.file_assets FOR UPDATE TO confsys_app USING(id=nullif(current_setting('app.upload_file_id',true),'')::uuid AND storage_key=nullif(current_setting('app.upload_storage_key',true),'')::uuid AND status='uploading') WITH CHECK(id=nullif(current_setting('app.upload_file_id',true),'')::uuid AND storage_key=nullif(current_setting('app.upload_storage_key',true),'')::uuid AND status IN('quarantined','rejected'));
ALTER TABLE confsys.file_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.file_references FORCE ROW LEVEL SECURITY;
CREATE POLICY file_references_operator ON confsys.file_references TO confsys_migrator USING(true) WITH CHECK(true);
CREATE POLICY file_references_read ON confsys.file_references FOR SELECT TO confsys_app USING(EXISTS(SELECT 1 FROM confsys.file_assets a WHERE a.id=file_id));
CREATE POLICY file_references_create ON confsys.file_references FOR INSERT TO confsys_app WITH CHECK(EXISTS(SELECT 1 FROM confsys.file_assets a WHERE a.id=file_id AND a.status='ready' AND(a.owner_id=nullif(current_setting('app.actor_id',true),'')::uuid OR(resource_type='site_publication' AND a.purpose='site_media' AND current_setting('app.files_media_manager',true)='true'))));
-- Fixed, bounded cleanup scope; no parameters/ready assets/deletions, safe search_path.
CREATE FUNCTION confsys.reject_stale_uploads() RETURNS TABLE(id uuid,storage_key uuid) LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,confsys AS $$
 WITH stale AS(SELECT a.id FROM confsys.file_assets a WHERE a.status='uploading' AND a.created_at<now()-interval '1 hour' AND NOT EXISTS(SELECT 1 FROM confsys.file_references r WHERE r.file_id=a.id) ORDER BY a.created_at LIMIT 1000 FOR UPDATE OF a SKIP LOCKED) UPDATE confsys.file_assets a SET status='rejected' FROM stale WHERE a.id=stale.id RETURNING a.id,a.storage_key
$$;
REVOKE ALL ON FUNCTION confsys.reject_stale_uploads() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confsys.reject_stale_uploads() TO confsys_app;
