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
  created_at timestamptz not null default now()
);

create index if not exists idx_payments_user on payments(user_id);
