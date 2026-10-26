-- Historial de checkpoints por proyecto, estilo Lovable: cada cambio aplicado (código, DB,
-- archivo) crea uno, y desde el panel de historial en el chat se puede "restaurar" el proyecto
-- al estado de cualquiera de ellos. Para checkpoints de código/archivo guardamos cómo reconstruir
-- ese estado: el SHA del commit (proyectos GitHub) o una foto completa de project_files (proyectos
-- virtuales) — así el restore no depende de reproducir cambios uno por uno, solo aplica el estado
-- final directo. Los checkpoints de cambios de DB no tocan archivos, así que no llevan ninguno de
-- los dos: al restaurar a uno de ellos, se usa el checkpoint de archivos más cercano hacia atrás.
create table if not exists project_checkpoints (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  change_type text not null check (change_type in ('code', 'db', 'asset')),
  summary text not null,
  commit_sha text,
  files_snapshot jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_project_checkpoints_project on project_checkpoints(project_id, created_at desc);
