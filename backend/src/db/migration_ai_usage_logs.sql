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
