-- Guarda el registro de acciones (leer archivo, editar, listar, cambio de BD, subida)
-- que la IA hizo en cada turno, para mostrarlo en el chat como un timeline permanente
-- (estilo Lovable), no solo mientras está "pensando".
alter table messages add column if not exists actions jsonb not null default '[]'::jsonb;
