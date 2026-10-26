-- Subdominio editable (slug único) + logo/imagen social por proyecto (metadata, no tocan
-- código del repo del usuario).
alter table projects add column if not exists logo_url text;
alter table projects add column if not exists social_image_url text;

-- Si esto falla con "could not create unique index... duplicate key", significa que hay
-- proyectos con el mismo slug en tu base — hay que resolverlo (renombrar uno) antes de que
-- este índice pueda crearse. Al momento de escribir esta migración se encontró y resolvió un
-- caso así (dos proyectos "una-calculadora" de usuarios distintos apuntando al mismo repo de
-- GitHub); si aparece otro, contactame para resolverlo antes de reintentar.
alter table projects add constraint projects_slug_key unique (slug);
