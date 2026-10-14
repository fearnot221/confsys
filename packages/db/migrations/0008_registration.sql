-- Versioned registration forms/prices; no existing identity data is rewritten.
CREATE TABLE confsys.registration_config_versions(version integer PRIMARY KEY CHECK(version>0),document jsonb NOT NULL,created_by uuid NOT NULL REFERENCES confsys.users(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE confsys.registration_state(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),version integer REFERENCES confsys.registration_config_versions(version));
INSERT INTO confsys.registration_state VALUES(true,null);
CREATE TABLE confsys.registrations(
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES confsys.users(id),number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 config_version integer NOT NULL REFERENCES confsys.registration_config_versions(version),ticket_id uuid NOT NULL,ticket_name text NOT NULL,
 state text NOT NULL CHECK(state IN('confirmed','waitlisted','cancelled')),badge_name text NOT NULL,affiliation text NOT NULL,answers jsonb NOT NULL,consent_snapshot text NOT NULL,
 idempotency_key uuid NOT NULL,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,idempotency_key),UNIQUE(id,user_id)
);
CREATE UNIQUE INDEX registrations_one_active ON confsys.registrations(user_id) WHERE state<>'cancelled';
CREATE INDEX registrations_capacity ON confsys.registrations(ticket_id,state);
CREATE TABLE confsys.orders(id uuid PRIMARY KEY,registration_id uuid NOT NULL UNIQUE,user_id uuid NOT NULL,state text NOT NULL CHECK(state IN('open','cancelled')),amount bigint NOT NULL CHECK(amount>=0 AND amount<=999999999999),currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(registration_id,user_id) REFERENCES confsys.registrations(id,user_id),UNIQUE(id,user_id));
CREATE TABLE confsys.order_items(id uuid PRIMARY KEY,order_id uuid NOT NULL REFERENCES confsys.orders(id),description text NOT NULL,amount bigint NOT NULL CHECK(amount>=0),price_snapshot jsonb NOT NULL);
GRANT SELECT,INSERT ON confsys.registration_config_versions,confsys.registrations,confsys.orders,confsys.order_items TO confsys_app;
GRANT SELECT,UPDATE(version,singleton) ON confsys.registration_state TO confsys_app;
GRANT UPDATE(state,badge_name,affiliation,answers) ON confsys.registrations TO confsys_app;
GRANT UPDATE(state) ON confsys.orders TO confsys_app;
GRANT USAGE ON SEQUENCE confsys.registrations_number_seq TO confsys_app;
-- Explicit resource context is transaction-local, established only after session verification.
ALTER TABLE confsys.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.registrations FORCE ROW LEVEL SECURITY;
CREATE POLICY registrations_actor ON confsys.registrations TO confsys_app USING(user_id=nullif(current_setting('app.actor_id',true),'')::uuid OR current_setting('app.registration_admin',true)='true') WITH CHECK(user_id=nullif(current_setting('app.actor_id',true),'')::uuid OR current_setting('app.registration_admin',true)='true');
ALTER TABLE confsys.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.orders FORCE ROW LEVEL SECURITY;
CREATE POLICY orders_actor ON confsys.orders TO confsys_app USING(user_id=nullif(current_setting('app.actor_id',true),'')::uuid OR current_setting('app.registration_admin',true)='true') WITH CHECK(user_id=nullif(current_setting('app.actor_id',true),'')::uuid OR current_setting('app.registration_admin',true)='true');
-- Capacity counts cannot depend on an owner's RLS-visible subset. This narrow view exposes only aggregate counts.
CREATE VIEW confsys.registration_capacity AS SELECT ticket_id,count(*)::integer AS used FROM confsys.registrations WHERE state='confirmed' GROUP BY ticket_id;
GRANT SELECT ON confsys.registration_capacity TO confsys_app;

CREATE POLICY registrations_operator ON confsys.registrations TO confsys_migrator USING(true) WITH CHECK(true);
CREATE POLICY orders_operator ON confsys.orders TO confsys_migrator USING(true) WITH CHECK(true);
