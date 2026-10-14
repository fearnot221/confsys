-- Additive: only already verified local accounts may receive invitations.
CREATE TABLE confsys.role_invitations (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES confsys.users(id),
 email text NOT NULL CHECK (email=lower(btrim(email))),
 role text NOT NULL CHECK (role IN ('conference_staff','conference_admin')),
 issuer_id uuid NOT NULL REFERENCES confsys.users(id),
 issuer_credential_version integer NOT NULL,
 recipient_credential_version integer NOT NULL,
 token_hash text NOT NULL UNIQUE,
 idempotency_key uuid NOT NULL,
 reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 300),
 UNIQUE (issuer_id,idempotency_key),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 accepted_at timestamptz, revoked_at timestamptz,
 CHECK (expires_at > created_at),
 CHECK (NOT (accepted_at IS NOT NULL AND revoked_at IS NOT NULL)),
 CHECK (issuer_id <> user_id)
);
CREATE INDEX role_invitations_recipient ON confsys.role_invitations(user_id,role);
GRANT SELECT,INSERT ON confsys.role_invitations TO confsys_app;
GRANT UPDATE(accepted_at,revoked_at) ON confsys.role_invitations TO confsys_app;
ALTER TABLE confsys.notifications ADD COLUMN invitation_id uuid REFERENCES confsys.role_invitations(id);
ALTER TABLE confsys.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE confsys.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('verify','reset','password_changed','role_invitation'));
ALTER TABLE confsys.notifications DROP CONSTRAINT notifications_check;
ALTER TABLE confsys.notifications ADD CONSTRAINT notifications_reference_check CHECK (
 (kind='role_invitation' AND invitation_id IS NOT NULL AND token_id IS NULL) OR
 (kind='password_changed' AND token_id IS NULL AND invitation_id IS NULL) OR
 (kind IN ('verify','reset') AND token_id IS NOT NULL AND invitation_id IS NULL)
);
CREATE OR REPLACE VIEW confsys.notification_eligibility AS
 SELECT n.id,u.email,
 (n.expires_at > now() AND u.state <> 'disabled' AND
  (n.kind='password_changed' OR
   (n.kind='role_invitation' AND i.user_id=u.id AND i.email=u.email AND u.state='active' AND u.verified_at IS NOT NULL
    AND i.recipient_credential_version=u.credential_version AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now()
    AND issuer.state='active' AND issuer.credential_version=i.issuer_credential_version
    AND EXISTS (SELECT 1 FROM confsys.user_roles r WHERE r.user_id=issuer.id AND r.role='conference_admin')) OR
   (n.kind IN ('verify','reset') AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>now() AND t.email=u.email AND t.purpose=n.kind
    AND ((n.kind='verify' AND u.state='pending') OR (n.kind='reset' AND u.state='active'))))) AS eligible
 FROM confsys.notifications n JOIN confsys.users u ON u.id=n.user_id
 LEFT JOIN confsys.auth_tokens t ON t.id=n.token_id
 LEFT JOIN confsys.role_invitations i ON i.id=n.invitation_id
 LEFT JOIN confsys.users issuer ON issuer.id=i.issuer_id
 WHERE n.status IN ('pending','processing');
