-- Ejecuta esto en el SQL Editor de Supabase (borrá el editor antes de pegar).
-- Agrega el "conocimiento del proyecto": contexto fijo que la IA lee siempre, sin que el
-- usuario tenga que repetirlo en cada mensaje.

alter table projects add column if not exists knowledge text;
