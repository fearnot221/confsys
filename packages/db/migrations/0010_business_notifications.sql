-- Immutable historical configuration: legacy revisions predate snapshot support.
-- Existing rows retain an explicit unknown {} snapshot; no historical facts are invented.
ALTER TABLE confsys.submission_revisions ADD COLUMN config_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE confsys.submission_revisions ALTER COLUMN config_snapshot DROP DEFAULT;
ALTER TABLE confsys.notifications ADD COLUMN event_key text UNIQUE, ADD COLUMN message_subject text, ADD COLUMN message_text text;
ALTER TABLE confsys.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE confsys.notifications ADD CONSTRAINT notifications_kind_check CHECK(kind IN('verify','reset','password_changed','role_invitation','business'));
ALTER TABLE confsys.notifications DROP CONSTRAINT notifications_scope_check;
ALTER TABLE confsys.notifications ADD CONSTRAINT notifications_scope_check CHECK((kind='business' AND scope='business') OR (kind<>'business' AND scope='identity'));
ALTER TABLE confsys.notifications DROP CONSTRAINT notifications_reference_check;
ALTER TABLE confsys.notifications ADD CONSTRAINT notifications_reference_check CHECK(
 (kind='role_invitation' AND invitation_id IS NOT NULL AND token_id IS NULL) OR
 (kind IN('password_changed','business') AND token_id IS NULL AND invitation_id IS NULL) OR
 (kind IN('verify','reset') AND token_id IS NOT NULL AND invitation_id IS NULL)
);
ALTER TABLE confsys.notifications ADD CONSTRAINT business_message_bounds CHECK(kind<>'business' OR (event_key IS NOT NULL AND length(event_key) BETWEEN 1 AND 200 AND length(message_subject) BETWEEN 1 AND 200 AND length(message_text) BETWEEN 1 AND 4000));
GRANT INSERT(event_key,message_subject,message_text) ON confsys.notifications TO confsys_app;
CREATE OR REPLACE VIEW confsys.notification_eligibility AS
 SELECT n.id,u.email,
 (n.expires_at>now() AND u.state<>'disabled' AND
  (n.kind='password_changed' OR
   (n.kind='business' AND u.state='active' AND u.verified_at IS NOT NULL) OR
   (n.kind='role_invitation' AND i.user_id=u.id AND i.email=u.email AND u.state='active' AND u.verified_at IS NOT NULL AND i.recipient_credential_version=u.credential_version AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now() AND issuer.state='active' AND issuer.credential_version=i.issuer_credential_version AND EXISTS(SELECT 1 FROM confsys.user_roles r WHERE r.user_id=issuer.id AND r.role='conference_admin')) OR
   (n.kind IN('verify','reset') AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>now() AND t.email=u.email AND t.purpose=n.kind AND ((n.kind='verify' AND u.state='pending') OR (n.kind='reset' AND u.state='active'))))) AS eligible
 FROM confsys.notifications n JOIN confsys.users u ON u.id=n.user_id LEFT JOIN confsys.auth_tokens t ON t.id=n.token_id LEFT JOIN confsys.role_invitations i ON i.id=n.invitation_id LEFT JOIN confsys.users issuer ON issuer.id=i.issuer_id WHERE n.status IN('pending','processing');
