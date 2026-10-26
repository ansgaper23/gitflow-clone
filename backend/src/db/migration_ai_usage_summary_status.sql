-- Agrega el status_code del ÚLTIMO request de cada cuenta a ai_usage_summary() (para pintarlo
-- verde/rojo en /admin) — cambia la forma de la tabla devuelta, así que hay que borrar y recrear
-- la función en vez de "create or replace" (Postgres no permite cambiar RETURNS TABLE en el lugar).
drop function if exists ai_usage_summary();

create function ai_usage_summary()
returns table (
  account_id uuid,
  requests bigint,
  input_tokens bigint,
  output_tokens bigint,
  cost_usd numeric,
  errors bigint,
  last_used_at timestamptz,
  last_status_code integer
)
language sql
stable
as $$
  select
    agg.account_id,
    agg.requests,
    agg.input_tokens,
    agg.output_tokens,
    agg.cost_usd,
    agg.errors,
    agg.last_used_at,
    last_call.status_code as last_status_code
  from (
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
  ) agg
  join lateral (
    select status_code
    from ai_usage_logs l
    where l.account_id = agg.account_id
    order by l.created_at desc
    limit 1
  ) last_call on true
$$;

grant execute on function ai_usage_summary() to service_role;
