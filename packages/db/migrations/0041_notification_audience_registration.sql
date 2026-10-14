-- Registration history can contain multiple cancelled attempts. Prefer current noncancelled registration, otherwise latest cancelled attempt.
CREATE OR REPLACE VIEW confsys.notification_audience WITH(security_barrier=true) AS
 SELECT u.id,u.email,
 ARRAY(SELECT r.role FROM confsys.user_roles r WHERE r.user_id=u.id ORDER BY r.role) AS roles,
 (SELECT r.state FROM confsys.registrations r WHERE r.user_id=u.id ORDER BY (r.state='cancelled'),r.created_at DESC,r.id DESC LIMIT 1) AS registration_state,
 ARRAY(SELECT DISTINCT s.state FROM confsys.submissions s WHERE s.owner_id=u.id ORDER BY s.state) AS submission_states,
 ARRAY(SELECT DISTINCT d.outcome FROM confsys.submissions s JOIN confsys.review_publications p ON p.submission_id=s.id JOIN confsys.review_decisions d ON d.id=p.decision_id WHERE s.owner_id=u.id ORDER BY d.outcome) AS published_outcomes
 FROM confsys.users u WHERE current_setting('app.notifications_manage',true)='true' AND u.state='active' AND u.verified_at IS NOT NULL;
