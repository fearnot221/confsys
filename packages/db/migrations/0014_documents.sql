CREATE TABLE confsys.receipts(
 id uuid PRIMARY KEY,
 order_id uuid NOT NULL UNIQUE REFERENCES confsys.orders(id),
 number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 state text NOT NULL CHECK(state IN('issued','void')),
 current_revision integer NOT NULL CHECK(current_revision>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE confsys.receipt_revisions(
 id uuid PRIMARY KEY,
 receipt_id uuid NOT NULL REFERENCES confsys.receipts(id),
 revision integer NOT NULL CHECK(revision>0),
 snapshot jsonb NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 300),
 created_by uuid NOT NULL REFERENCES confsys.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(receipt_id,revision)
);
CREATE TABLE confsys.receipt_voids(
 receipt_id uuid PRIMARY KEY REFERENCES confsys.receipts(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 300),
 actor_id uuid NOT NULL REFERENCES confsys.users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT ON confsys.receipts,confsys.receipt_revisions,confsys.receipt_voids TO confsys_app;
GRANT UPDATE(state,current_revision) ON confsys.receipts TO confsys_app;
GRANT USAGE ON SEQUENCE confsys.receipts_number_seq TO confsys_app;
ALTER TABLE confsys.receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY receipts_actor ON confsys.receipts TO confsys_app USING(current_setting('app.finance_admin',true)='true' OR EXISTS(SELECT 1 FROM confsys.orders o WHERE o.id=order_id AND o.user_id=nullif(current_setting('app.actor_id',true),'')::uuid)) WITH CHECK(current_setting('app.finance_admin',true)='true');
CREATE POLICY receipts_operator ON confsys.receipts TO confsys_migrator USING(true) WITH CHECK(true);
ALTER TABLE confsys.receipt_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.receipt_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY receipt_revisions_actor ON confsys.receipt_revisions TO confsys_app USING(EXISTS(SELECT 1 FROM confsys.receipts r WHERE r.id=receipt_id)) WITH CHECK(current_setting('app.finance_admin',true)='true');
CREATE POLICY receipt_revisions_operator ON confsys.receipt_revisions TO confsys_migrator USING(true) WITH CHECK(true);
ALTER TABLE confsys.receipt_voids ENABLE ROW LEVEL SECURITY;
ALTER TABLE confsys.receipt_voids FORCE ROW LEVEL SECURITY;
CREATE POLICY receipt_voids_actor ON confsys.receipt_voids TO confsys_app USING(EXISTS(SELECT 1 FROM confsys.receipts r WHERE r.id=receipt_id)) WITH CHECK(current_setting('app.finance_admin',true)='true');
CREATE POLICY receipt_voids_operator ON confsys.receipt_voids TO confsys_migrator USING(true) WITH CHECK(true);
