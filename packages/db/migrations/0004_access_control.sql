-- Additive local access control. Existing accounts and sessions retain their identity.
CREATE TABLE confsys.user_roles (
 user_id uuid NOT NULL REFERENCES confsys.users(id),
 role text NOT NULL CHECK (role IN ('conference_staff','conference_admin')),
 PRIMARY KEY (user_id, role)
);
CREATE INDEX user_roles_role_idx ON confsys.user_roles(role, user_id);
CREATE TABLE confsys.access_control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 initialized_user_id uuid REFERENCES confsys.users(id),
 initialized_at timestamptz,
 CHECK ((initialized_user_id IS NULL) = (initialized_at IS NULL))
);
INSERT INTO confsys.access_control(singleton) VALUES (true);
ALTER TABLE confsys.sessions ADD COLUMN password_verified_at timestamptz;
-- Old sessions stay valid but require fresh password proof for administration.
ALTER TABLE confsys.auth_audit
 ADD COLUMN actor_id uuid REFERENCES confsys.users(id),
 ADD COLUMN source text NOT NULL DEFAULT 'authentication' CHECK (source IN ('authentication','session','operator_cli')),
 ADD COLUMN reason text CHECK (length(reason) BETWEEN 3 AND 300),
 ADD COLUMN before_value text,
 ADD COLUMN after_value text;
CREATE INDEX auth_audit_page_idx ON confsys.auth_audit(created_at DESC, id DESC);
GRANT SELECT, INSERT, DELETE ON confsys.user_roles TO confsys_app;
GRANT SELECT ON confsys.access_control, confsys.auth_audit TO confsys_app;
-- Allows row locking, without giving the runtime permission to reopen bootstrap.
GRANT UPDATE(singleton) ON confsys.access_control TO confsys_app;
GRANT UPDATE(password_verified_at) ON confsys.sessions TO confsys_app;
-- No UPDATE/DELETE on audit, no worker access to roles or bootstrap.
