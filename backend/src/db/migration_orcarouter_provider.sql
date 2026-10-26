-- Permite agregar cuentas de IA con provider='orcarouter' (el nombre por defecto de Postgres
-- para el constraint inline es "<tabla>_<columna>_check").
alter table ai_accounts drop constraint if exists ai_accounts_provider_check;
alter table ai_accounts add constraint ai_accounts_provider_check check (provider in ('gemini', 'anthropic', 'deepseek', 'orcarouter'));
