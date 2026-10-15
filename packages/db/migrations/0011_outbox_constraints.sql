-- ON CONFLICT inference requires SELECT on the key; no recipient/message read grant.
GRANT SELECT(event_key) ON confsys.notifications TO confsys_app;
ALTER TABLE confsys.notifications DROP CONSTRAINT business_message_bounds;
ALTER TABLE confsys.notifications ADD CONSTRAINT business_message_bounds CHECK(kind<>'business' OR (event_key IS NOT NULL AND message_subject IS NOT NULL AND message_text IS NOT NULL AND length(event_key) BETWEEN 1 AND 200 AND length(message_subject) BETWEEN 1 AND 200 AND length(message_text) BETWEEN 1 AND 4000));
