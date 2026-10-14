CREATE TABLE confsys.document_jobs(
 id uuid PRIMARY KEY,kind text NOT NULL CHECK(kind='badges'),requester_id uuid NOT NULL REFERENCES confsys.users(id),
 requester_credential_version integer NOT NULL,
 idempotency_key uuid NOT NULL,request_hash text NOT NULL,snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processing','ready','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),claim_id uuid,lease_until timestamptz,
 result_code text,pdf bytea,sha256 text,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 UNIQUE(requester_id,idempotency_key),CHECK(pdf IS NULL OR octet_length(pdf)<=16777216),
 CHECK(status<>'ready' OR(pdf IS NOT NULL AND sha256~'^[a-f0-9]{64}$' AND completed_at IS NOT NULL))
);
CREATE INDEX document_jobs_pending ON confsys.document_jobs(created_at) WHERE status='pending';
ALTER TABLE confsys.document_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.document_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY document_jobs_operator ON confsys.document_jobs TO confsys_migrator USING(true) WITH CHECK(true);
CREATE POLICY document_jobs_owner ON confsys.document_jobs FOR SELECT TO confsys_app USING(requester_id=nullif(current_setting('app.actor_id',true),'')::uuid AND current_setting('app.onsite_admin',true)='true');
CREATE POLICY document_jobs_create ON confsys.document_jobs FOR INSERT TO confsys_app WITH CHECK(requester_id=nullif(current_setting('app.actor_id',true),'')::uuid AND current_setting('app.onsite_admin',true)='true' AND status='pending' AND attempts=0 AND pdf IS NULL);
CREATE POLICY document_jobs_worker ON confsys.document_jobs TO confsys_worker USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON confsys.document_jobs TO confsys_app;
GRANT SELECT ON confsys.document_jobs TO confsys_worker;
GRANT UPDATE(status,attempts,claim_id,lease_until,result_code,pdf,sha256,completed_at) ON confsys.document_jobs TO confsys_worker;
-- Main add narrow job eligibility view: id, requester_active boolean, roles text[], tokens_current boolean.
-- tokens_current checks every snapshot badge registration confirmed and token_id/hash unchanged;
-- view can read operator-private resources but exposes only these booleans/current role names, no tokens or PII.
-- Worker/API both use @confsys/policy permissionsFor(roles).includes('onsite.read').

CREATE VIEW confsys.document_job_eligibility WITH(security_barrier=true) AS
 SELECT j.id,(u.state='active' AND u.verified_at IS NOT NULL AND u.credential_version=j.requester_credential_version) AS requester_active,
 ARRAY(SELECT r.role FROM confsys.user_roles r WHERE r.user_id=j.requester_id) AS roles,
 NOT EXISTS(SELECT 1 FROM jsonb_array_elements(j.snapshot->'badges') badge LEFT JOIN confsys.registrations reg ON reg.id=(badge->>'registrationId')::uuid LEFT JOIN confsys.onsite_tokens token ON token.registration_id=reg.id WHERE reg.id IS NULL OR reg.state<>'confirmed' OR token.token_id IS DISTINCT FROM (badge->>'tokenId')::uuid OR token.token_hash IS DISTINCT FROM badge->>'tokenHash') AS tokens_current
 FROM confsys.document_jobs j JOIN confsys.users u ON u.id=j.requester_id
 WHERE current_user='confsys_worker' OR j.requester_id=nullif(current_setting('app.actor_id',true),'')::uuid;
GRANT SELECT ON confsys.document_job_eligibility TO confsys_app,confsys_worker;
-- Row locks are needed solely for current-authority fencing; worker cannot change the bootstrap identity.
GRANT SELECT,UPDATE(singleton) ON confsys.access_control TO confsys_worker;
