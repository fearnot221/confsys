-- Platform identities are explicitly global, never an unscoped tenant repository.
CREATE TABLE confsys.users (
 id uuid PRIMARY KEY, email text NOT NULL UNIQUE,
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','active','disabled')),
 password_hash text, credential_version integer NOT NULL DEFAULT 0,
 verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (email = lower(btrim(email))),
 CHECK ((state = 'pending' AND password_hash IS NULL AND verified_at IS NULL) OR state = 'disabled' OR (state = 'active' AND password_hash IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE TABLE confsys.auth_tokens (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES confsys.users(id),
 email text NOT NULL, purpose text NOT NULL CHECK (purpose IN ('verify','reset')),
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
 used_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON confsys.auth_tokens(user_id, purpose);
CREATE TABLE confsys.sessions (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES confsys.users(id),
 token_hash text NOT NULL UNIQUE, credential_version integer NOT NULL,
 created_at timestamptz NOT NULL, last_seen_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE INDEX ON confsys.sessions(user_id);
CREATE TABLE confsys.auth_audit (
 id uuid PRIMARY KEY, event text NOT NULL, user_id uuid REFERENCES confsys.users(id),
 request_id uuid NOT NULL, event_id uuid, created_at timestamptz NOT NULL DEFAULT now()
);
-- This notification outbox currently permits identity scope only. Tenant notifications
-- require their own explicit scope policy in a later migration, not NULL = allow all.
CREATE TABLE confsys.notifications (
 id uuid PRIMARY KEY, scope text NOT NULL CHECK (scope = 'identity'),
 user_id uuid NOT NULL REFERENCES confsys.users(id), token_id uuid REFERENCES confsys.auth_tokens(id),
 kind text NOT NULL CHECK (kind IN ('verify','reset','password_changed')),
 request_id uuid NOT NULL, expires_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','accepted','failed','unknown','cancelled')),
 stage text CHECK (stage IN ('claimed','sending')), claim_id uuid, lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 provider_id text, result_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((kind = 'password_changed' AND token_id IS NULL) OR (kind <> 'password_changed' AND token_id IS NOT NULL))
);
CREATE INDEX ON confsys.notifications(status, next_attempt_at);
CREATE TABLE confsys.notification_secrets (
 notification_id uuid PRIMARY KEY REFERENCES confsys.notifications(id),
 key_version text NOT NULL, ciphertext text NOT NULL, expires_at timestamptz NOT NULL
);
-- Restricted projection lets the worker check eligibility without password/session/token hashes.
CREATE VIEW confsys.notification_eligibility AS
 SELECT n.id, u.email,
 (n.expires_at > now() AND u.state <> 'disabled' AND
   (n.kind = 'password_changed' OR
    (t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at > now() AND t.email = u.email AND t.purpose = n.kind AND
     ((n.kind = 'verify' AND u.state = 'pending') OR (n.kind = 'reset' AND u.state = 'active'))))) AS eligible
 FROM confsys.notifications n JOIN confsys.users u ON u.id = n.user_id
 LEFT JOIN confsys.auth_tokens t ON t.id = n.token_id;
REVOKE ALL ON ALL TABLES IN SCHEMA confsys FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON confsys.users, confsys.auth_tokens, confsys.sessions TO confsys_app;
GRANT INSERT ON confsys.auth_audit TO confsys_app, confsys_worker;
GRANT INSERT ON confsys.notifications, confsys.notification_secrets TO confsys_app;
GRANT SELECT, UPDATE ON confsys.notifications TO confsys_worker;
GRANT SELECT, DELETE ON confsys.notification_secrets TO confsys_worker;
GRANT SELECT ON confsys.notification_eligibility TO confsys_worker;
