-- Ejecuta esto en el SQL Editor de Supabase (tu proyecto de GitFlow, no el de un usuario).
-- Permite que cada usuario conecte la base de datos Postgres/Supabase de sus propios repos,
-- y que el agente proponga cambios SQL (igual que hace con el código) sujetos a aprobación.

create table if not exists repo_db_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  repo_full_name text not null,
  label text not null default 'Base de datos',
  connection_string text not null,
  created_at timestamptz not null default now(),
  unique (user_id, repo_full_name)
);

create table if not exists proposed_db_changes (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  repo_full_name text not null,
  sql text not null,
  summary text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'applied')),
  result text,
  created_at timestamptz not null default now()
);

create index if not exists idx_db_changes_conversation on proposed_db_changes(conversation_id);
