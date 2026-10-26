-- Ejecuta esto en el SQL Editor de Supabase (borrá el editor antes de pegar).
-- Agrega la tabla de analíticas de visitas para sitios publicados.

create table if not exists project_analytics_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  path text not null,
  visitor_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_analytics_project_created on project_analytics_events(project_id, created_at);
