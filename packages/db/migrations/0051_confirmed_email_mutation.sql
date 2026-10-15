-- Restore the identity boundary: runtime cannot arbitrarily UPDATE users.email.
REVOKE UPDATE(email) ON confsys.users FROM confsys_app;
CREATE FUNCTION confsys.confirm_email_change(p_user_id uuid,p_token_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,confsys AS $$
DECLARE source_email text; source_version integer; source_verified_at timestamptz; confirmed_at timestamptz; change confsys.auth_tokens%ROWTYPE;
BEGIN
 IF p_user_id IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid THEN RETURN false; END IF;
 -- Match the service's global-access -> user -> token lock order.
 SELECT u.email,u.credential_version,u.verified_at INTO source_email,source_version,source_verified_at FROM confsys.users u
 WHERE u.id=p_user_id AND u.state='active' AND u.verified_at IS NOT NULL FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT t.* INTO change FROM confsys.auth_tokens t
 WHERE t.user_id=p_user_id AND t.token_hash=p_token_hash AND t.purpose='email_change' FOR UPDATE;
 IF NOT FOUND OR change.source_email IS DISTINCT FROM source_email
  OR change.credential_version IS DISTINCT FROM source_version
  OR change.used_at IS NOT NULL OR change.revoked_at IS NOT NULL
  OR change.expires_at<=clock_timestamp() THEN RETURN false; END IF;
 confirmed_at:=clock_timestamp();
 INSERT INTO confsys.verified_email_history(user_id,email,verified_at) VALUES(p_user_id,source_email,source_verified_at) ON CONFLICT DO NOTHING;
 UPDATE confsys.users SET email=change.email,verified_at=confirmed_at,credential_version=credential_version+1 WHERE id=p_user_id;
 INSERT INTO confsys.verified_email_history(user_id,email,verified_at) VALUES(p_user_id,change.email,confirmed_at) ON CONFLICT DO NOTHING;
 UPDATE confsys.auth_tokens SET used_at=confirmed_at WHERE id=change.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION confsys.confirm_email_change(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION confsys.confirm_email_change(uuid,text) TO confsys_app;
