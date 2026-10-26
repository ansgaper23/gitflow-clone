-- Permite guardar conexiones con connection_type='vps' ("base de datos automática" en el
-- Postgres propio del VPS, ver services/vpsPostgres.js) — repoDb.js/dbConnectionResolver.js la
-- tratan igual que 'manual' para ejecutar SQL; este valor solo distingue en la UI/al borrar.
alter table repo_db_connections drop constraint if exists repo_db_connections_connection_type_check;
alter table repo_db_connections
  add constraint repo_db_connections_connection_type_check check (connection_type in ('oauth', 'manual', 'vps'));

-- Nombre real de la base/rol creados en el Postgres del VPS (para poder hacer DROP DATABASE +
-- DROP ROLE limpio si se borra la conexión) — null para 'oauth'/'manual'.
alter table repo_db_connections add column if not exists vps_database_name text;
