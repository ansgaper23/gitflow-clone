-- Ejecuta esto en el SQL Editor de Supabase (borrá el editor antes de pegar).
-- Agrega soporte para publicar un build estático y conectar un dominio propio.

alter table projects add column if not exists published_at timestamptz;
alter table projects add column if not exists custom_domain text unique;
alter table projects add column if not exists custom_domain_verified_at timestamptz;
