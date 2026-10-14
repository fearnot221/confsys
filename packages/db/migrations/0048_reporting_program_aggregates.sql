-- Aggregate-only draft/publication visibility for reporting; no author/contact projection.
CREATE VIEW confsys.reporting_program_totals WITH(security_barrier=true) AS
 SELECT
 (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (SELECT kind,count(*)::integer AS count FROM confsys.program_slots GROUP BY kind ORDER BY kind)x) AS draft,
 (SELECT coalesce(jsonb_agg(x),'[]'::jsonb) FROM (
  SELECT slot->>'kind' AS kind,count(*)::integer AS count
  FROM confsys.program_state s JOIN confsys.program_publications p ON p.id=s.active_publication_id
  CROSS JOIN LATERAL jsonb_array_elements(p.document) session
  CROSS JOIN LATERAL jsonb_array_elements(session->'slots') slot
  WHERE s.singleton=true GROUP BY slot->>'kind' ORDER BY slot->>'kind')x) AS published,
 (SELECT p.published_at FROM confsys.program_state s JOIN confsys.program_publications p ON p.id=s.active_publication_id WHERE s.singleton=true) AS published_at
 WHERE current_setting('app.reporting_admin',true)='true';
GRANT SELECT ON confsys.reporting_program_totals TO confsys_app;
