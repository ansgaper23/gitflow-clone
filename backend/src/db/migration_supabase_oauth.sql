-- Ejecuta esto en el SQL Editor de Supabase (tu proyecto de GitFlow).
-- Agrega la conexión de 1 clic vía OAuth de Supabase, como alternativa a pegar
-- el connection string manualmente.

alter table users add column if not exists supabase_access_token text;
alter table users add column if not exists supabase_refresh_token text;
alter table users add column if not exists supabase_token_expires_at timestamptz;

alter table repo_db_connections
  add column if not exists connection_type text not null default 'manual' check (connection_type in ('oauth', 'manual'));
alter table repo_db_connections add column if not exists project_ref text;
alter table repo_db_connections add column if not exists project_name text;
alter table repo_db_connections alter column connection_string drop not null;
