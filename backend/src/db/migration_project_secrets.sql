create table if not exists project_secrets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  key text not null,
  value text not null,
  created_at timestamptz not null default now(),
  unique (project_id, key)
);
create index if not exists idx_project_secrets_project on project_secrets(project_id);
