-- Permite vincular VARIAS cuentas de Supabase por usuario (antes: un solo token OAuth global en
-- "users", compartido por todos sus proyectos) — cada fila de esta tabla es una cuenta de
-- Supabase vinculada, y "repo_db_connections.supabase_account_id" dice CUÁL de ellas usa cada
-- conexión puntual.
create table if not exists supabase_oauth_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  label text not null,
  access_token text not null,
  refresh_token text not null,
  token_expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_supabase_oauth_accounts_user on supabase_oauth_accounts(user_id);

alter table repo_db_connections
  add column if not exists supabase_account_id uuid references supabase_oauth_accounts(id) on delete set null;

-- Migra la única cuenta global que ya tenía cada usuario (si la tenía) a una fila propia, y
-- reapunta sus conexiones oauth existentes a ella — así ninguna conexión ya hecha se rompe.
insert into supabase_oauth_accounts (user_id, label, access_token, refresh_token, token_expires_at, created_at)
select id, 'Cuenta principal', supabase_access_token, supabase_refresh_token, supabase_token_expires_at, now()
from users
where supabase_refresh_token is not null
  and not exists (select 1 from supabase_oauth_accounts a where a.user_id = users.id);

update repo_db_connections c
set supabase_account_id = a.id
from supabase_oauth_accounts a
where c.connection_type = 'oauth'
  and c.supabase_account_id is null
  and a.user_id = c.user_id
  and a.label = 'Cuenta principal';

-- Las columnas viejas en "users" (supabase_access_token/refresh_token/token_expires_at) quedan
-- sin usar desde ahora (el código ya no las lee ni las escribe) — no se borran acá a propósito,
-- por si hace falta revisar/revertir; se pueden dropear en una migración aparte más adelante.
