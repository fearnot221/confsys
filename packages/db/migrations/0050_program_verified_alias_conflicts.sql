-- Verified addresses are collision evidence only, never manuscript/account
-- ownership. Reused historical addresses can conservatively flag a conflict.
-- Existing booking keys and immutable public snapshots are not rewritten.
CREATE VIEW confsys.program_verified_alias_conflicts WITH(security_barrier=true) AS
 WITH verified_addresses AS (
  SELECT user_id,email FROM confsys.verified_email_history
  UNION SELECT id,email FROM confsys.users WHERE verified_at IS NOT NULL
 )
 SELECT a.source_id AS first_source_id,b.source_id AS second_source_id
 FROM confsys.program_person_bookings a JOIN confsys.program_person_bookings b
 ON a.source_id<b.source_id AND a.person_key<>b.person_key
 AND a.starts_at<b.ends_at AND b.starts_at<a.ends_at
 WHERE current_setting('app.program_manage',true)='true'
 AND EXISTS(SELECT 1 FROM confsys.users actor WHERE actor.id=nullif(current_setting('app.actor_id',true),'')::uuid AND actor.state='active' AND actor.verified_at IS NOT NULL)
 AND EXISTS(SELECT 1 FROM verified_addresses x JOIN verified_addresses y ON y.user_id=x.user_id
 WHERE x.email=a.person_key AND y.email=b.person_key);
GRANT SELECT ON confsys.program_verified_alias_conflicts TO confsys_app;
