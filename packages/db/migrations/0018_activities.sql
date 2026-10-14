-- Separate activity charges preserve the original registration price and all payment history.
ALTER TABLE confsys.orders DROP CONSTRAINT orders_registration_id_key;
ALTER TABLE confsys.orders ADD COLUMN kind text NOT NULL DEFAULT 'registration' CHECK(kind IN('registration','activity'));
CREATE UNIQUE INDEX orders_registration_charge ON confsys.orders(registration_id) WHERE kind='registration';
CREATE TABLE confsys.activity_versions(id uuid NOT NULL,version integer NOT NULL CHECK(version>0),document jsonb NOT NULL,created_by uuid NOT NULL REFERENCES confsys.users(id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(id,version));
CREATE TABLE confsys.activities(id uuid PRIMARY KEY,version integer NOT NULL,FOREIGN KEY(id,version) REFERENCES confsys.activity_versions(id,version));
CREATE TABLE confsys.activity_bookings(id uuid PRIMARY KEY,registration_id uuid NOT NULL REFERENCES confsys.registrations(id),user_id uuid NOT NULL REFERENCES confsys.users(id),activity_id uuid NOT NULL,activity_version integer NOT NULL,quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 20),meal_type text NOT NULL,state text NOT NULL CHECK(state IN('reserved','cancelled')),order_id uuid NOT NULL UNIQUE REFERENCES confsys.orders(id),snapshot jsonb NOT NULL,idempotency_key uuid NOT NULL,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(activity_id,activity_version) REFERENCES confsys.activity_versions(id,version),UNIQUE(user_id,idempotency_key));
CREATE UNIQUE INDEX bookings_active ON confsys.activity_bookings(registration_id,activity_id) WHERE state='reserved';
GRANT SELECT,INSERT ON confsys.activity_versions,confsys.activities,confsys.activity_bookings TO confsys_app;
GRANT UPDATE(version) ON confsys.activities TO confsys_app;
GRANT UPDATE(state) ON confsys.activity_bookings TO confsys_app;
ALTER TABLE confsys.activity_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.activity_bookings FORCE ROW LEVEL SECURITY;
CREATE POLICY activity_bookings_actor ON confsys.activity_bookings TO confsys_app USING(user_id=nullif(current_setting('app.actor_id',true),'')::uuid OR current_setting('app.registration_admin',true)='true') WITH CHECK(user_id=nullif(current_setting('app.actor_id',true),'')::uuid OR current_setting('app.registration_admin',true)='true');
CREATE POLICY activity_bookings_operator ON confsys.activity_bookings TO confsys_migrator USING(true) WITH CHECK(true);
CREATE VIEW confsys.activity_capacity AS SELECT activity_id,sum(quantity)::integer AS used FROM confsys.activity_bookings WHERE state='reserved' GROUP BY activity_id;
GRANT SELECT ON confsys.activity_capacity TO confsys_app;

-- Direct runtime inserts also serialize the last-seat invariant; public aggregate avoids owner RLS undercount.
CREATE FUNCTION confsys.check_activity_capacity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE doc jsonb; used integer;
BEGIN
 PERFORM singleton FROM confsys.registration_state FOR UPDATE;
 SELECT v.document INTO doc FROM confsys.activities a JOIN confsys.activity_versions v ON v.id=a.id AND v.version=a.version WHERE a.id=NEW.activity_id AND a.version=NEW.activity_version;
 SELECT c.used INTO used FROM confsys.activity_capacity c WHERE c.activity_id=NEW.activity_id;
 IF doc IS NULL OR coalesce(used,0)+NEW.quantity>(doc->>'capacity')::integer THEN RAISE EXCEPTION 'Activity capacity exceeded' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER activity_capacity_check BEFORE INSERT ON confsys.activity_bookings FOR EACH ROW EXECUTE FUNCTION confsys.check_activity_capacity();
