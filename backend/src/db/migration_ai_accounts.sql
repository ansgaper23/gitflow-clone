-- Ejecuta esto en el SQL Editor de Supabase (tu proyecto ya tiene las tablas de schema.sql).
-- Añade el panel de administración de cuentas de IA y rotación entre proveedores.

alter table users add column if not exists is_admin boolean not null default false;

create table if not exists ai_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('gemini', 'anthropic')),
  label text not null,
  api_key text not null,
  model text not null,
  is_active boolean not null default true,
  priority integer not null default 0,
  last_used_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_accounts_rotation on ai_accounts(is_active, priority);

-- Hazte admin a ti mismo (ajusta el WHERE si ya tienes más de un usuario registrado):
update users set is_admin = true;
