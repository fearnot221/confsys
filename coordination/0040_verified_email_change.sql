-- Identity resources remain keyed by stable user ID; no manuscript/profile snapshots are rewritten.
ALTER TABLE confsys.auth_tokens DROP CONSTRAINT auth_tokens_purpose_check;
ALTER TABLE confsys.auth_tokens ADD CONSTRAINT auth_tokens_purpose_check CHECK(purpose IN('verify','reset','email_change'));
ALTER TABLE confsys.auth_tokens ADD COLUMN source_email text,ADD COLUMN credential_version integer;
ALTER TABLE confsys.auth_tokens ADD CONSTRAINT email_change_token_binding CHECK(purpose<>'email_change' OR (
 source_email IS NOT NULL AND credential_version IS NOT NULL AND source_email=lower(btrim(source_email)) AND email=lower(btrim(email)) AND source_email<>email AND expires_at>created_at AND expires_at<=created_at+interval '30 minutes'));
GRANT UPDATE(email) ON confsys.users TO confsys_app;
CREATE TABLE confsys.verified_email_history(
 user_id uuid NOT NULL REFERENCES confsys.users(id) ON DELETE CASCADE,
 email text NOT NULL CHECK(email=lower(btrim(email))),verified_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,email));
INSERT INTO confsys.verified_email_history(user_id,email,verified_at) SELECT id,email,verified_at FROM confsys.users WHERE verified_at IS NOT NULL;
ALTER TABLE confsys.verified_email_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.verified_email_history FORCE ROW LEVEL SECURITY;
CREATE POLICY verified_email_history_operator ON confsys.verified_email_history TO confsys_migrator USING(true) WITH CHECK(true);
CREATE POLICY verified_email_history_owner ON confsys.verified_email_history FOR SELECT TO confsys_app USING(user_id=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE POLICY verified_email_history_append ON confsys.verified_email_history FOR INSERT TO confsys_app WITH CHECK(user_id=nullif(current_setting('app.actor_id',true),'')::uuid AND EXISTS(SELECT 1 FROM confsys.users u WHERE u.id=confsys.verified_email_history.user_id AND u.email=confsys.verified_email_history.email AND u.verified_at IS NOT NULL));
GRANT SELECT,INSERT ON confsys.verified_email_history TO confsys_app;
-- Boolean match only, with current trusted context; never exposes historical addresses.
CREATE VIEW confsys.submission_author_conflicts WITH(security_barrier=true) AS
 SELECT DISTINCT r.id AS revision_id,e.user_id
 FROM confsys.submission_revisions r CROSS JOIN LATERAL jsonb_array_elements(r.document->'authors') author
 JOIN (SELECT user_id,email FROM confsys.verified_email_history UNION SELECT id,email FROM confsys.users WHERE verified_at IS NOT NULL) e ON e.email=lower(btrim(author->>'email'))
 WHERE e.user_id=nullif(current_setting('app.actor_id',true),'')::uuid OR current_setting('app.reviews_manage',true)='true' OR current_setting('app.competitions_manage',true)='true';
GRANT SELECT ON confsys.submission_author_conflicts TO confsys_app;
ALTER TABLE confsys.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE confsys.notifications ADD CONSTRAINT notifications_kind_check CHECK(kind IN('verify','reset','password_changed','role_invitation','business','email_change'));
ALTER TABLE confsys.notifications DROP CONSTRAINT notifications_reference_check;
ALTER TABLE confsys.notifications ADD CONSTRAINT notifications_reference_check CHECK(
 (kind='role_invitation' AND invitation_id IS NOT NULL AND token_id IS NULL) OR
 (kind IN('password_changed','business') AND token_id IS NULL AND invitation_id IS NULL) OR
 (kind IN('verify','reset','email_change') AND token_id IS NOT NULL AND invitation_id IS NULL));
CREATE OR REPLACE VIEW confsys.notification_eligibility AS
 SELECT n.id,CASE WHEN n.kind='email_change' THEN t.email ELSE u.email END AS email,
 (n.expires_at>now() AND u.state<>'disabled' AND
  (n.kind='password_changed' OR
   (n.kind='email_change' AND u.state='active' AND u.verified_at IS NOT NULL AND t.purpose='email_change' AND t.source_email=u.email AND t.credential_version=u.credential_version AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>now()) OR
   (n.kind='business' AND u.state='active' AND u.verified_at IS NOT NULL) OR
   (n.kind='role_invitation' AND i.user_id=u.id AND i.email=u.email AND u.state='active' AND u.verified_at IS NOT NULL AND i.recipient_credential_version=u.credential_version AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at>now() AND issuer.state='active' AND issuer.credential_version=i.issuer_credential_version AND EXISTS(SELECT 1 FROM confsys.user_roles r WHERE r.user_id=issuer.id AND r.role='conference_admin')) OR
   (n.kind IN('verify','reset') AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at>now() AND t.email=u.email AND t.purpose=n.kind AND ((n.kind='verify' AND u.state='pending') OR (n.kind='reset' AND u.state='active'))))) AS eligible
 FROM confsys.notifications n JOIN confsys.users u ON u.id=n.user_id LEFT JOIN confsys.auth_tokens t ON t.id=n.token_id LEFT JOIN confsys.role_invitations i ON i.id=n.invitation_id LEFT JOIN confsys.users issuer ON issuer.id=i.issuer_id WHERE n.status IN('pending','processing');

CREATE OR REPLACE VIEW confsys.competition_judging_eligibility AS
 SELECT a.id,
 (EXISTS(SELECT 1 FROM confsys.submission_registration_policy policy WHERE policy.revision_id=e.revision_id AND policy.eligible) AND e.state='approved' AND s.state<>'withdrawn' AND e.owner_id<>a.judge_id
 AND NOT EXISTS(SELECT 1 FROM confsys.submission_author_conflicts conflict WHERE conflict.revision_id=r.id AND conflict.user_id=a.judge_id)
 AND NOT EXISTS(SELECT 1 FROM confsys.competition_conflicts x WHERE x.entry_id=e.id AND x.judge_id=a.judge_id)
 AND EXISTS(SELECT 1 FROM confsys.published_acceptances p WHERE p.revision_id=e.revision_id AND p.outcome='accept_'||(f.document->>'kind'))
 AND (NOT coalesce((f.document->>'requireRegistration')::boolean,false) OR EXISTS(SELECT 1 FROM confsys.registrations reg WHERE reg.user_id=e.owner_id AND reg.state='confirmed'))
 ) AS eligible
 FROM confsys.competition_assignments a JOIN confsys.competition_entries e ON e.id=a.entry_id JOIN confsys.submissions s ON s.id=e.submission_id JOIN confsys.submission_revisions r ON r.id=e.revision_id JOIN confsys.users u ON u.id=a.judge_id JOIN confsys.competition_rubrics f ON f.id=a.rubric_id
 WHERE a.judge_id=nullif(current_setting('app.actor_id',true),'')::uuid;
GRANT SELECT ON confsys.competition_judging_eligibility TO confsys_app;

