-- Permite apuntar una cuenta "anthropic" a un endpoint compatible distinto de api.anthropic.com
-- (ej. un proxy propio del usuario). Vacío/NULL = usa el default del SDK (api.anthropic.com).
alter table ai_accounts add column if not exists base_url text;
