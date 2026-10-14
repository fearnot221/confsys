-- A worker may lock the singleton coordination row but cannot read bootstrap identity.
REVOKE SELECT ON confsys.access_control FROM confsys_worker;
GRANT SELECT(singleton) ON confsys.access_control TO confsys_worker;
