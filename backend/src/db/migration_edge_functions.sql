-- Ejecuta esto en el SQL Editor de Supabase (borrá el editor antes de pegar).
-- Agrega soporte para Edge Functions (backend real) con secrets de servidor.

create table if not exists proposed_edge_functions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  repo_full_name text not null,
  slug text not null,
  code text not null,
  summary text not null,
  verify_jwt boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'applied')),
  result text,
  created_at timestamptz not null default now()
);

create index if not exists idx_edge_functions_conversation on proposed_edge_functions(conversation_id);

create table if not exists project_edge_functions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  slug text not null,
  summary text,
  deployed_at timestamptz not null default now(),
  unique (project_id, slug)
);

create table if not exists project_server_secrets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  key text not null,
  value text not null,
  created_at timestamptz not null default now(),
  unique (project_id, key)
);
