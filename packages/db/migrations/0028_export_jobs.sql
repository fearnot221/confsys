CREATE TABLE confsys.export_jobs(
 id uuid PRIMARY KEY,kind text NOT NULL CHECK(kind IN('registrations','submissions','emails')),
 requester_id uuid NOT NULL REFERENCES confsys.users(id),requester_credential_version integer NOT NULL,
 idempotency_key uuid NOT NULL,request_hash text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processing','ready','failed','cancelled','expired')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3),claim_id uuid,lease_until timestamptz,
 result_code text,csv bytea,sha256 text,row_count bigint,snapshot_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 UNIQUE(requester_id,idempotency_key),CHECK(csv IS NULL OR octet_length(csv)<=67108864),
 CHECK(status<>'ready' OR(csv IS NOT NULL AND sha256~'^[a-f0-9]{64}$' AND row_count>=0 AND snapshot_at IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE INDEX export_jobs_pending ON confsys.export_jobs(created_at) WHERE status='pending';
ALTER TABLE confsys.export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.export_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY export_jobs_operator ON confsys.export_jobs TO confsys_migrator USING(true) WITH CHECK(true);
CREATE POLICY export_jobs_owner ON confsys.export_jobs FOR SELECT TO confsys_app USING(requester_id=nullif(current_setting('app.actor_id',true),'')::uuid AND current_setting('app.reporting_admin',true)='true');
CREATE POLICY export_jobs_create ON confsys.export_jobs FOR INSERT TO confsys_app WITH CHECK(requester_id=nullif(current_setting('app.actor_id',true),'')::uuid AND current_setting('app.reporting_admin',true)='true' AND status='pending' AND attempts=0 AND csv IS NULL);
CREATE POLICY export_jobs_worker ON confsys.export_jobs TO confsys_worker USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON confsys.export_jobs TO confsys_app;
GRANT SELECT ON confsys.export_jobs TO confsys_worker;
GRANT UPDATE(status,attempts,claim_id,lease_until,result_code,csv,sha256,row_count,snapshot_at,completed_at) ON confsys.export_jobs TO confsys_worker;
CREATE VIEW confsys.export_job_eligibility WITH(security_barrier=true) AS
 SELECT j.id,(u.state='active' AND u.verified_at IS NOT NULL AND u.credential_version=j.requester_credential_version AND j.expires_at>clock_timestamp()) AS requester_active,
 ARRAY(SELECT r.role FROM confsys.user_roles r WHERE r.user_id=j.requester_id) AS roles
 FROM confsys.export_jobs j JOIN confsys.users u ON u.id=j.requester_id
 WHERE current_user='confsys_worker' OR j.requester_id=nullif(current_setting('app.actor_id',true),'')::uuid;
GRANT SELECT ON confsys.export_job_eligibility TO confsys_app,confsys_worker;
-- Private data projections require an actual claimed job, never a caller's actor ID.
CREATE VIEW confsys.export_source_job WITH(security_barrier=true) AS
 SELECT j.id,j.kind FROM confsys.export_jobs j JOIN confsys.users u ON u.id=j.requester_id
 WHERE current_user='confsys_worker' AND j.id=nullif(current_setting('app.export_job_id',true),'')::uuid AND j.claim_id=nullif(current_setting('app.export_claim_id',true),'')::uuid AND j.status='processing' AND j.lease_until>clock_timestamp() AND j.expires_at>clock_timestamp() AND u.state='active' AND u.verified_at IS NOT NULL AND u.credential_version=j.requester_credential_version;
CREATE VIEW confsys.export_registrations WITH(security_barrier=true) AS
 SELECT r.id,r.number::text,r.state,u.email,r.badge_name,r.affiliation,r.ticket_name
 FROM confsys.registrations r JOIN confsys.users u ON u.id=r.user_id
 WHERE EXISTS(SELECT 1 FROM confsys.export_source_job WHERE kind='registrations');
CREATE VIEW confsys.export_submissions WITH(security_barrier=true) AS
 SELECT s.id,s.number::text,s.state,u.email,s.document->>'title' AS title,s.document->>'trackId' AS track,s.version,s.submitted_version
 FROM confsys.submissions s JOIN confsys.users u ON u.id=s.owner_id
 WHERE EXISTS(SELECT 1 FROM confsys.export_source_job WHERE kind='submissions');
CREATE VIEW confsys.export_emails WITH(security_barrier=true) AS
 SELECT u.id,u.email FROM confsys.users u WHERE u.state='active' AND u.verified_at IS NOT NULL AND EXISTS(SELECT 1 FROM confsys.export_source_job WHERE kind='emails');
GRANT SELECT ON confsys.export_registrations,confsys.export_submissions,confsys.export_emails TO confsys_worker;
CREATE VIEW confsys.reporting_notification_totals WITH(security_barrier=true) AS
 SELECT status,count(*)::integer AS count FROM confsys.notifications WHERE kind='business' AND current_setting('app.reporting_admin',true)='true' GROUP BY status;
GRANT SELECT ON confsys.reporting_notification_totals TO confsys_app;
