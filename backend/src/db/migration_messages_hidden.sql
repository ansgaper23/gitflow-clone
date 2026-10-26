-- Mensajes internos de un turno automático (ver dbImport.js/runAutoConnectLoop) que nunca deben
-- mostrarse en el chat: el prompt gigante de "conectá el código" y el ida-y-vuelta de
-- continuación entre etapas ("seguí con la siguiente etapa") no son conversación real con el
-- usuario, son implementación interna — el chat solo tiene que ver el resultado final.
alter table messages add column if not exists hidden boolean not null default false;
