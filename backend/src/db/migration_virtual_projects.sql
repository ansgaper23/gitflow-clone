-- Proyectos sin GitHub (estilo Lovable): un usuario logueado por Google/email puede crear
-- un proyecto y chatear/editar/preview sin conectar GitHub. El "repo_full_name" sigue siendo
-- la clave que ya usan conversations/proposed_changes/proposed_db_changes/proposed_asset_changes/
-- repo_db_connections — para un proyecto virtual usamos el valor sintético "virtual/<uuid>",
-- así ninguna de esas tablas necesita cambiar de esquema.

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  slug text not null,
  storage_type text not null default 'virtual' check (storage_type in ('virtual', 'github')),
  repo_full_name text not null,
  branch text,
  created_at timestamptz not null default now(),
  unique (user_id, repo_full_name)
);

create table if not exists project_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  path text not null,
  content text not null default '',
  is_base64 boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, path)
);
create index if not exists idx_project_files_project on project_files(project_id);

alter table conversations add column if not exists project_id uuid references projects(id) on delete cascade;

-- Backfill: un project (storage_type=github) por cada (user_id, repo_full_name) que ya
-- existe hoy en conversations, y enlazamos esas conversaciones.
insert into projects (user_id, name, slug, storage_type, repo_full_name)
select distinct
  c.user_id,
  split_part(c.repo_full_name, '/', 2),
  split_part(c.repo_full_name, '/', 2),
  'github',
  c.repo_full_name
from conversations c
where not exists (
  select 1 from projects p where p.user_id = c.user_id and p.repo_full_name = c.repo_full_name
)
on conflict (user_id, repo_full_name) do nothing;

update conversations c
set project_id = p.id
from projects p
where p.user_id = c.user_id
  and p.repo_full_name = c.repo_full_name
  and c.project_id is null;
