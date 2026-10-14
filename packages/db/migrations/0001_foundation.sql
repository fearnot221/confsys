-- Infrastructure only. No users, conferences, or synthetic business records.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA confsys FROM PUBLIC;
GRANT USAGE ON SCHEMA confsys TO confsys_app, confsys_worker;
GRANT SELECT ON confsys.schema_migrations TO confsys_app, confsys_worker;
