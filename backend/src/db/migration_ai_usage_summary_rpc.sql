-- Agregado por cuenta de IA para el panel "Logs de uso" en /admin: antes esa sección mostraba
-- las últimas N llamadas individuales (una tabla que crecía sola); ahora es una fila fija por
-- cuenta configurada, con el consumo TOTAL acumulado de esa cuenta. Se necesita como función
-- porque PostgREST (la API que usa supabase-js) no soporta GROUP BY directo desde el cliente.
create or replace function ai_usage_summary()
returns table (
  account_id uuid,
  requests bigint,
  input_tokens bigint,
  output_tokens bigint,
  cost_usd numeric,
  errors bigint,
  last_used_at timestamptz
)
language sql
stable
as $$
  select
    account_id,
    count(*)::bigint as requests,
    coalesce(sum(input_tokens), 0)::bigint as input_tokens,
    coalesce(sum(output_tokens), 0)::bigint as output_tokens,
    coalesce(sum(cost_usd), 0)::numeric as cost_usd,
    count(*) filter (where status_code <> 200)::bigint as errors,
    max(created_at) as last_used_at
  from ai_usage_logs
  where account_id is not null
  group by account_id
$$;

grant execute on function ai_usage_summary() to service_role;
