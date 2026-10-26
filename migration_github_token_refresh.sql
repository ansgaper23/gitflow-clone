-- La app OAuth de GitHub de FlowPro tiene activada la expiración de tokens (8hs) — hasta ahora
-- el backend descartaba el refresh_token que GitHub manda para renovarlos, así que cualquier
-- sesión de más de 8hs (las sesiones de FlowPro duran hasta 365 días) terminaba con
-- "Bad credentials" hasta que el usuario reconectaba a mano. Guardamos lo que GitHub ya manda
-- para poder renovar el access_token solos, en segundo plano, sin que el usuario haga nada.
alter table users add column if not exists github_refresh_token text;
alter table users add column if not exists github_token_expires_at timestamptz;
