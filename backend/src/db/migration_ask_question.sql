-- Ejecuta esto en el SQL Editor de Supabase (borrá el editor antes de pegar).
-- Agrega soporte para que la IA muestre una tarjeta de opciones dentro del chat (estilo
-- Lovable) en vez de solo texto plano.

alter table messages add column if not exists question jsonb;
