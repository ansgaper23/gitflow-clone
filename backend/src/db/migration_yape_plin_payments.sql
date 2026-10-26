-- Ejecuta esto en el SQL Editor de Supabase (borrá el editor antes de pegar).
-- Soporte para pagos manuales por Yape/Plin: el usuario paga por fuera (QR o número de
-- teléfono) y pega el número de operación; un admin lo revisa y aprueba desde /admin antes de
-- activar el plan (ver POST /api/plans/yape-checkout y POST /api/admin/payments/:id/approve).

alter table payments drop constraint if exists payments_status_check;
alter table payments add constraint payments_status_check
  check (status in ('pending', 'pending_review', 'paid', 'failed'));

alter table payments add column if not exists operation_number text;
alter table payments add column if not exists reviewed_by uuid references users(id);
alter table payments add column if not exists reviewed_at timestamptz;
