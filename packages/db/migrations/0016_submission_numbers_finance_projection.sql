ALTER TABLE confsys.submissions ADD COLUMN number bigint GENERATED ALWAYS AS IDENTITY UNIQUE;
GRANT USAGE ON SEQUENCE confsys.submissions_number_seq TO confsys_app;
-- Group payers see only explicit delegated order summaries, never private registration answers.
CREATE VIEW confsys.finance_order_summaries AS
 SELECT o.id,r.number::text AS registration_number,r.badge_name,o.user_id,o.state,o.amount,o.currency,o.created_at
 FROM confsys.orders o JOIN confsys.registrations r ON r.id=o.registration_id
 WHERE current_setting('app.finance_admin',true)='true' OR o.user_id=nullif(current_setting('app.actor_id',true),'')::uuid OR EXISTS(SELECT 1 FROM confsys.order_payers p WHERE p.order_id=o.id AND p.payer_id=nullif(current_setting('app.actor_id',true),'')::uuid);
GRANT SELECT ON confsys.finance_order_summaries TO confsys_app;

CREATE VIEW confsys.published_acceptances AS SELECT d.submission_id,d.revision_id,d.outcome FROM confsys.review_publications p JOIN confsys.review_decisions d ON d.id=p.decision_id WHERE d.outcome IN('accept_oral','accept_poster');
GRANT SELECT ON confsys.published_acceptances TO confsys_app;
