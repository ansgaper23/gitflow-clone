-- Antigravity y Claude Code (los dos motores de antigravity-bridge) consumen cuota de
-- suscripciones personales, no facturación por token de una API — un costo en USD (que sí
-- reporta Claude Code de forma directa) es más útil que tokens crudos para saber cuánto se está
-- gastando. Nullable: sigue siendo null para los proveedores que no lo reportan (todo lo demás).
alter table ai_usage_logs add column if not exists cost_usd numeric(10, 6);
