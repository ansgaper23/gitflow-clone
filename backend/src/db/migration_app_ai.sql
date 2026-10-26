-- Permite que las apps que construyen los usuarios integren una IA (ej. un chat/asistente
-- dentro de la app) sin exponer ninguna API key en el navegador: GitFlow hace de proxy
-- (routes/appAi.js -> services/appAi.js) usando cuentas separadas del agente de código
-- (scope='app' en vez de 'agent'), con su propio límite de uso diario por proyecto.

alter table ai_accounts add column if not exists scope text not null default 'agent' check (scope in ('agent', 'app'));

create table if not exists app_ai_usage (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  day date not null default current_date,
  request_count integer not null default 0,
  unique (project_id, day)
);

create or replace function increment_app_ai_usage(p_project_id uuid)
returns integer
language plpgsql
as $$
declare
  new_count integer;
begin
  insert into app_ai_usage (project_id, day, request_count)
  values (p_project_id, current_date, 1)
  on conflict (project_id, day)
  do update set request_count = app_ai_usage.request_count + 1
  returning request_count into new_count;
  return new_count;
end;
$$;
