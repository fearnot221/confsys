-- Narrow existing runtime grants without rewriting an applied migration.
REVOKE UPDATE ON confsys.users, confsys.auth_tokens, confsys.sessions FROM confsys_app;
GRANT UPDATE (password_hash, state, credential_version, verified_at) ON confsys.users TO confsys_app;
GRANT UPDATE (used_at, revoked_at) ON confsys.auth_tokens TO confsys_app;
GRANT UPDATE (last_seen_at, revoked_at) ON confsys.sessions TO confsys_app;
REVOKE UPDATE ON confsys.notifications FROM confsys_worker;
GRANT UPDATE (status, stage, claim_id, lease_until, attempts, next_attempt_at, provider_id, result_code, updated_at)
 ON confsys.notifications TO confsys_worker;
-- A worker needs recipient/token eligibility only for unfinished deliveries.
CREATE OR REPLACE VIEW confsys.notification_eligibility AS
 SELECT n.id, u.email,
 (n.expires_at > now() AND u.state <> 'disabled' AND
   (n.kind = 'password_changed' OR
    (t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at > now() AND t.email = u.email AND t.purpose = n.kind AND
     ((n.kind = 'verify' AND u.state = 'pending') OR (n.kind = 'reset' AND u.state = 'active'))))) AS eligible
 FROM confsys.notifications n JOIN confsys.users u ON u.id = n.user_id
 LEFT JOIN confsys.auth_tokens t ON t.id = n.token_id
 WHERE n.status IN ('pending','processing');
