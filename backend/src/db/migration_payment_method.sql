-- Ejecuta esto en el SQL Editor de Supabase (borrá el editor antes de pegar).
-- Agrega el método de pago (o "admin_grant" si el plan se asignó a mano) a cada venta.

alter table payments add column if not exists payment_method text;
