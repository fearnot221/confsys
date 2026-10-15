ALTER TABLE confsys.registrations ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
GRANT UPDATE(version) ON confsys.registrations TO confsys_app;
CREATE TABLE confsys.registration_price_snapshots(registration_id uuid PRIMARY KEY REFERENCES confsys.registrations(id) ON DELETE CASCADE,amount bigint NOT NULL CHECK(amount>=0 AND amount<=999999999999),currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),document jsonb NOT NULL);
CREATE TABLE confsys.registration_changes(id uuid PRIMARY KEY,registration_id uuid NOT NULL REFERENCES confsys.registrations(id) ON DELETE CASCADE,version integer NOT NULL CHECK(version>0),before_document jsonb NOT NULL,after_document jsonb NOT NULL,reason text NOT NULL,actor_id uuid NOT NULL REFERENCES confsys.users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(registration_id,version));
GRANT SELECT,INSERT ON confsys.registration_price_snapshots,confsys.registration_changes TO confsys_app;
ALTER TABLE confsys.registration_price_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.registration_price_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY registration_price_actor ON confsys.registration_price_snapshots TO confsys_app USING(EXISTS(SELECT 1 FROM confsys.registrations r WHERE r.id=registration_id)) WITH CHECK(EXISTS(SELECT 1 FROM confsys.registrations r WHERE r.id=registration_id));
CREATE POLICY registration_price_operator ON confsys.registration_price_snapshots TO confsys_migrator USING(true) WITH CHECK(true);
ALTER TABLE confsys.registration_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.registration_changes FORCE ROW LEVEL SECURITY;
CREATE POLICY registration_changes_actor ON confsys.registration_changes TO confsys_app USING(EXISTS(SELECT 1 FROM confsys.registrations r WHERE r.id=registration_id)) WITH CHECK(EXISTS(SELECT 1 FROM confsys.registrations r WHERE r.id=registration_id));
CREATE POLICY registration_changes_operator ON confsys.registration_changes TO confsys_migrator USING(true) WITH CHECK(true);
-- Existing confirmed charges have authoritative order snapshots. No historical total is recomputed.
INSERT INTO confsys.registration_price_snapshots SELECT o.registration_id,o.amount,o.currency,jsonb_build_object('legacyOrderId',o.id,'description',r.ticket_name) FROM confsys.orders o JOIN confsys.registrations r ON r.id=o.registration_id WHERE o.kind='registration';
-- Waitlisted requests have no order: recover only a uniquely matching rate in their immutable form version.
-- Missing/ambiguous old rate leaves no snapshot and promotion fails closed pending operator investigation.
INSERT INTO confsys.registration_price_snapshots
 SELECT r.id,(rates.matches->0->>'amount')::bigint,v.document->>'currency',jsonb_build_object('version',r.config_version,'ticket',ticket,'currency',v.document->>'currency')
 FROM confsys.registrations r JOIN confsys.registration_config_versions v ON v.version=r.config_version
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(v.document->'tickets','[]')) ticket
 CROSS JOIN LATERAL (SELECT jsonb_agg(rate) matches FROM jsonb_array_elements(ticket->'rates') rate WHERE r.created_at>=(rate->>'startsAt')::timestamptz AND r.created_at<(rate->>'endsAt')::timestamptz) rates
 WHERE r.state='waitlisted' AND ticket->>'id'=r.ticket_id::text AND jsonb_array_length(rates.matches)=1 ON CONFLICT DO NOTHING;
CREATE VIEW confsys.competition_registration_eligibility AS SELECT DISTINCT r.user_id,true AS eligible FROM confsys.registrations r WHERE r.state='confirmed' AND (r.user_id=nullif(current_setting('app.actor_id',true),'')::uuid OR current_setting('app.competitions_manage',true)='true');
GRANT SELECT ON confsys.competition_registration_eligibility TO confsys_app;

CREATE VIEW confsys.competition_entry_counts AS SELECT competition_id,count(*)::integer AS total FROM confsys.competition_entries GROUP BY competition_id;
GRANT SELECT ON confsys.competition_entry_counts TO confsys_app;
