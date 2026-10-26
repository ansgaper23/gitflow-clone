-- Alta de cuentas de Antigravity desde /admin sin tocar la CLI a mano por SSH: cada cuenta
-- nueva vive en su propia carpeta $HOME dentro del bridge (ver antigravity-bridge/lib/
-- accountLogins.js) — esta columna guarda CUÁL, para que providers/antigravity.js le diga al
-- bridge qué credencial usar en cada llamada. Null = la cuenta original de producción, que
-- nunca pasó por este alta y sigue usando el $HOME real del proceso sin cambios.
alter table ai_accounts add column if not exists bridge_account_id text;
