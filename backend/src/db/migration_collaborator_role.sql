-- Rol intermedio: puede entrar a /admin y activar/revocar planes de usuarios,
-- pero NO tiene acceso a la gestión de cuentas de IA (eso sigue siendo solo de is_admin).
alter table users add column if not exists is_collaborator boolean not null default false;
