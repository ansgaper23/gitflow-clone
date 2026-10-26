-- Ejecuta este script en el SQL Editor de tu proyecto Supabase.

create extension if not exists "pgcrypto";

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  github_id text unique not null,
  github_login text not null,
  avatar_url text,
  email text,
  github_access_token text not null,
  plan_id text,
  plan_expires_at timestamptz,
  credits_used integer not null default 0,
  is_admin boolean not null default false,
  is_collaborator boolean not null default false,
  supabase_access_token text,
  supabase_refresh_token text,
  supabase_token_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists ai_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('gemini', 'anthropic', 'deepseek', 'orcarouter', 'cloudflare')),
  label text not null,
  api_key text not null,
  model text not null,
  -- Solo para 'anthropic': endpoint compatible alternativo (ej. un proxy propio del usuario).
  -- Vacío/NULL = usa el default del SDK (api.anthropic.com).
  base_url text,
  is_active boolean not null default true,
  priority integer not null default 0,
  -- 'agent' = el agente de código de FlowPro. 'app' = IA embebida dentro de las apps que
  -- construyen los usuarios (ej. un chat/asistente en su propia app), vía routes/appAi.js —
  -- pool separado a propósito para no compartir cuota con el agente de código.
  scope text not null default 'agent' check (scope in ('agent', 'app', 'image')),
  last_used_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_accounts_rotation on ai_accounts(is_active, priority);

-- Log de cada llamada real a un modelo de IA (agente de código o IA dentro de apps), para el
-- panel "Logs de uso" en /admin. Una fila por llamada real a la API del proveedor (no por turno
-- de usuario: un turno con tool-use puede hacer varias llamadas, cada una es su propia fila).
create table if not exists ai_usage_logs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references ai_accounts(id) on delete set null,
  provider text not null,
  model text not null,
  scope text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  status_code integer not null,
  error text,
  latency_ms integer not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_usage_logs_created on ai_usage_logs(created_at desc);

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

create table if not exists repo_db_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  repo_full_name text not null,
  label text not null default 'Base de datos',
  connection_type text not null default 'manual' check (connection_type in ('oauth', 'manual')),
  connection_string text,
  project_ref text,
  project_name text,
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

-- Edge Functions (Supabase): a diferencia del código del sitio (que corre en el navegador del
-- visitante), esto corre en el servidor de Supabase del usuario — ahí sí puede haber secretos
-- reales (claves de Stripe, de un proveedor de email, etc.) sin exponerlos. Mismo flujo de
-- propuesta/aprobación que proposed_db_changes: la IA propone, el usuario aprueba, recién ahí
-- se despliega de verdad vía la Management API de Supabase.
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

-- Registro de qué funciones quedaron desplegadas por proyecto (Supabase también las lista,
-- pero tenerlas acá evita un roundtrip a la Management API solo para mostrarlas en el panel).
create table if not exists project_edge_functions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  slug text not null,
  summary text,
  deployed_at timestamptz not null default now(),
  unique (project_id, slug)
);

-- Secrets de SERVIDOR: nunca se hornean en el build estático (a diferencia de project_secrets,
-- que sí terminan en el bundle público) — solo existen para que las Edge Functions los lean
-- con Deno.env.get(...). Se guardan acá para mostrar cuáles ya están cargados y se empujan a
-- Supabase (Management API) apenas se agregan/cambian.
create table if not exists project_server_secrets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  key text not null,
  value text not null,
  created_at timestamptz not null default now(),
  unique (project_id, key)
);

create table if not exists proposed_asset_changes (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  repo_full_name text not null,
  target text not null check (target in ('github', 'storage')),
  path text not null,
  bucket text,
  filename text not null,
  mime_type text not null,
  size_bytes integer not null,
  file_base64 text not null,
  summary text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'applied')),
  result text,
  commit_url text,
  public_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_asset_changes_conversation on proposed_asset_changes(conversation_id);

create table if not exists plans (
  id text primary key,
  name text not null,
  duration_days integer not null,
  price_cents integer not null,
  currency text not null default 'USD',
  featured boolean not null default false,
  sort_order integer not null default 0
);

insert into plans (id, name, duration_days, price_cents, currency, featured, sort_order) values
  ('1d',  '1 día de acceso',   1,   4990,  'USD', false, 1),
  ('7d',  '7 días de acceso',  7,   8990,  'USD', false, 2),
  ('15d', '15 días de acceso', 15,  11990, 'USD', false, 3),
  ('30d', '30 días de acceso', 30,  19700, 'USD', true,  4),
  ('90d', '3 meses de acceso', 90,  59700, 'USD', false, 5)
on conflict (id) do nothing;

-- Un registro por sesión de Stripe Checkout iniciada, para poder auditar pagos (pendiente vs
-- pagado vs fallido) sin depender únicamente del dashboard de Stripe.
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  plan_id text not null references plans(id),
  stripe_session_id text unique not null,
  stripe_payment_intent_id text,
  amount_cents integer not null,
  currency text not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  payment_method text,
  created_at timestamptz not null default now()
);

create index if not exists idx_payments_user on payments(user_id);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  slug text not null,
  storage_type text not null default 'virtual' check (storage_type in ('virtual', 'github')),
  repo_full_name text not null,
  branch text,
  thumbnail_url text,
  logo_url text,
  social_image_url text,
  published_at timestamptz,
  custom_domain text unique,
  custom_domain_verified_at timestamptz,
  knowledge text,
  created_at timestamptz not null default now(),
  unique (user_id, repo_full_name),
  unique (slug)
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

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  project_id uuid references projects(id) on delete cascade,
  repo_full_name text not null,
  title text not null default 'Nueva conversación',
  created_at timestamptz not null default now()
);

-- Secrets/env vars propios del proyecto (ej. una API key de Stripe que el código generado
-- necesita), para que el usuario los cargue desde la UI en vez de tener que pasárselos a la
-- IA por el chat (que los dejaría escritos en el historial de mensajes). Se inyectan como env
-- vars del preview junto con las de Supabase (ver services/previewEnv.js).
create table if not exists project_secrets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  key text not null,
  value text not null,
  created_at timestamptz not null default now(),
  unique (project_id, key)
);
create index if not exists idx_project_secrets_project on project_secrets(project_id);

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

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  actions jsonb not null default '[]'::jsonb,
  question jsonb,
  created_at timestamptz not null default now()
);

create table if not exists proposed_changes (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  repo_full_name text not null,
  file_path text not null,
  original_content text,
  new_content text not null,
  summary text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'applied')),
  commit_url text,
  created_at timestamptz not null default now()
);

create index if not exists idx_conversations_user on conversations(user_id);
create index if not exists idx_messages_conversation on messages(conversation_id);
create index if not exists idx_changes_conversation on proposed_changes(conversation_id);

-- Un renglón por visita al sitio publicado (subdominio <slug>.flow-pro.online). visitor_hash es
-- un hash de IP+user-agent+día (no la IP cruda) para poder aproximar "visitantes únicos" sin
-- guardar datos personales identificables.
create table if not exists project_analytics_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  path text not null,
  visitor_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_analytics_project_created on project_analytics_events(project_id, created_at);
