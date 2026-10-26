-- "Skills" al estilo Claude (SKILL.md con frontmatter name/description + instrucciones) que el
-- dueño del proyecto puede subir para ampliar lo que el agente sabe hacer en ESE proyecto
-- puntual — se inyectan en el prompt del sistema junto con el "Conocimiento del proyecto".
create table if not exists project_skills (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  description text,
  content text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_skills_project on project_skills(project_id);
