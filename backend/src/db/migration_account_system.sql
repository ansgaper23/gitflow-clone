-- Permite cuentas independientes de GitHub (email/contraseña y Google).
-- GitHub deja de ser obligatorio para tener una cuenta: se conecta aparte,
-- solo cuando el usuario quiere crear/editar un proyecto real.

alter table users alter column github_id drop not null;
alter table users alter column github_login drop not null;
alter table users alter column github_access_token drop not null;

alter table users add column if not exists password_hash text;
alter table users add column if not exists google_id text;
alter table users add column if not exists name text;

create unique index if not exists users_email_unique on users(email);
create unique index if not exists users_google_id_unique on users(google_id);
