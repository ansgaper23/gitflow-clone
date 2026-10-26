-- Ejecuta esto en el SQL Editor de Supabase (borrá el editor antes de pegar).
-- Fase 2 del panel reseller: claves de activación. A diferencia de "activar plan" (que exige
-- que el cliente ya esté invitado/vinculado al reseller vía reseller_id), acá el reseller paga
-- los créditos al generar la clave y se la pasa a quien quiera por fuera (WhatsApp, etc.) — el
-- que la recibe la canjea él mismo desde la web, con cualquier cuenta, sin necesitar estar
-- vinculado a ese reseller. Ver POST /api/reseller/keys y POST /api/plans/redeem-key.

create table if not exists reseller_plan_keys (
  id uuid primary key default gen_random_uuid(),
  reseller_id uuid not null references users(id) on delete cascade,
  plan_id text not null references plans(id),
  code text unique not null,
  status text not null default 'unused' check (status in ('unused', 'redeemed', 'revoked')),
  redeemed_by uuid references users(id),
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_reseller_plan_keys_reseller on reseller_plan_keys(reseller_id);

alter table reseller_credit_transactions add column if not exists related_key_id uuid references reseller_plan_keys(id);

alter table reseller_credit_transactions drop constraint if exists reseller_credit_transactions_reason_check;

alter table reseller_credit_transactions add constraint reseller_credit_transactions_reason_check check (reason in ('admin_grant', 'activate_plan', 'admin_adjustment', 'generate_key', 'revoke_key_refund'));
