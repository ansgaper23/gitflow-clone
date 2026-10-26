-- Fase 1 del panel reseller (sin Stripe todavía — licencias y créditos se cargan a mano
-- desde /admin). Costo en créditos por plan definido por admin, VARÍA según el plan
-- (decisión de negocio confirmada: no es un valor fijo "1 crédito = 1 mes" para todos).

alter table users add column if not exists reseller_id uuid references users(id);
create index if not exists idx_users_reseller on users(reseller_id);

-- 1 fila por reseller: su licencia (el "pase" que le desbloquea el panel /reseller).
create table if not exists reseller_licenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  tier text not null check (tier in ('basico', 'white_label')),
  status text not null default 'active' check (status in ('active', 'expired', 'revoked')),
  license_key text unique,
  client_limit integer,
  expires_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

-- Saldo de créditos, separado de la licencia a propósito: renovar/cambiar la licencia nunca
-- resetea créditos sin gastar.
create table if not exists reseller_wallets (
  user_id uuid primary key references users(id) on delete cascade,
  balance integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Auditoría de cada movimiento de créditos (carga manual del admin, gasto al activar un plan).
create table if not exists reseller_credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  amount integer not null,
  reason text not null check (reason in ('admin_grant', 'activate_plan', 'admin_adjustment')),
  related_plan_id text references plans(id),
  related_client_id uuid references users(id),
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_reseller_credit_tx_user on reseller_credit_transactions(user_id);

-- Costo en créditos de activar cada plan — global (igual para todos los resellers en Fase 1),
-- lo administra el admin desde /admin. Un plan sin fila acá todavía no está habilitado para
-- que ningún reseller lo active.
create table if not exists reseller_plan_costs (
  plan_id text primary key references plans(id) on delete cascade,
  credit_cost integer not null check (credit_cost > 0)
);

-- Invitaciones: forma en que un cliente se suma a un reseller — el cliente confirma él mismo
-- entrando al link (nunca se vincula una cuenta existente sin que se entere).
create table if not exists reseller_invites (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references users(id) on delete cascade,
  email text not null,
  token text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
create index if not exists idx_reseller_invites_reseller on reseller_invites(reseller_id);

-- Gasto atómico: el chequeo de saldo y el descuento pasan en el MISMO update (WHERE balance >=
-- monto), así dos activaciones simultáneas del mismo reseller nunca pueden dejar el saldo en
-- negativo — a diferencia de hacer "leer saldo, decidir en Node, escribir" desde el backend,
-- que sí tiene ventana de carrera entre el read y el write.
create or replace function reseller_spend_credits(p_user_id uuid, p_amount integer)
returns integer
language plpgsql
as $$
declare
  new_balance integer;
begin
  update reseller_wallets
  set balance = balance - p_amount, updated_at = now()
  where user_id = p_user_id and balance >= p_amount
  returning balance into new_balance;

  if new_balance is null then
    raise exception 'saldo_insuficiente';
  end if;

  return new_balance;
end;
$$;

-- Carga atómica (admin otorga créditos): upsert que SUMA al saldo existente en vez de
-- pisarlo — necesario porque un "upsert" común de Supabase reemplaza el valor, no lo acumula.
create or replace function reseller_grant_credits(p_user_id uuid, p_amount integer)
returns integer
language plpgsql
as $$
declare
  new_balance integer;
begin
  insert into reseller_wallets (user_id, balance, updated_at)
  values (p_user_id, p_amount, now())
  on conflict (user_id) do update
    set balance = reseller_wallets.balance + excluded.balance, updated_at = now()
  returning balance into new_balance;

  return new_balance;
end;
$$;
