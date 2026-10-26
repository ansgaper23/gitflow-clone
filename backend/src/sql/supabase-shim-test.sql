-- =============================================================================
-- TEST DE RLS: Demuestra que auth.uid() + request.jwt.claim.sub funciona
-- =============================================================================
-- Ejecutar en cualquier base de proyecto FlowPro (Flow Cloud) tras desplegar
-- los cambios de vpsPostgres.js + dbProxy.js.
--
-- Prerequisito: ejecutar ensureAuthHelpers(connectionString) en esa base
-- para crear el esquema auth si la base ya existía antes de esta actualización.
-- =============================================================================

-- 1. Verificar que auth.uid() existe y funciona
SELECT auth.uid() AS uid_sin_contexto;  -- Debe devolver NULL

-- 2. Simular un usuario autenticado (como lo hace dbProxy.withClient)
BEGIN;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
SELECT auth.uid() AS uid_con_contexto;  -- Debe devolver '11111111-...'
-- Verificar backward-compat
SELECT set_config('app.user_id', '11111111-1111-1111-1111-111111111111', true);
SELECT current_user_id() AS uid_legacy;  -- Debe devolver lo mismo
COMMIT;

-- 3. Crear tabla de prueba con RLS usando auth.uid() (estilo Supabase)
CREATE TABLE IF NOT EXISTS test_rls_orders (
  id serial PRIMARY KEY,
  user_id uuid DEFAULT auth.uid(),
  description text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE test_rls_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_rls_orders FORCE ROW LEVEL SECURITY;

CREATE POLICY "owner_only" ON test_rls_orders
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 4. Insertar datos como usuario A
BEGIN;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
SELECT set_config('app.user_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
INSERT INTO test_rls_orders (description) VALUES ('Pedido de Usuario A - orden 1');
INSERT INTO test_rls_orders (description) VALUES ('Pedido de Usuario A - orden 2');
COMMIT;

-- 5. Insertar datos como usuario B
BEGIN;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);
SELECT set_config('app.user_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);
INSERT INTO test_rls_orders (description) VALUES ('Pedido de Usuario B - orden 1');
COMMIT;

-- 6. Consultar como usuario A → solo debe ver sus 2 pedidos
BEGIN;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
SELECT set_config('app.user_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', true);
SELECT * FROM test_rls_orders;  -- ESPERADO: 2 filas (solo las de A)
COMMIT;

-- 7. Consultar como usuario B → solo debe ver su 1 pedido
BEGIN;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);
SELECT set_config('app.user_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);
SELECT * FROM test_rls_orders;  -- ESPERADO: 1 fila (solo la de B)
COMMIT;

-- 8. Consultar SIN usuario (anon) → no debe ver nada
BEGIN;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('app.user_id', '', true);
SELECT * FROM test_rls_orders;  -- ESPERADO: 0 filas
COMMIT;

-- 9. Intentar insertar como B con user_id de A → debe fallar por WITH CHECK
BEGIN;
SELECT set_config('request.jwt.claim.sub', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);
SELECT set_config('app.user_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', true);
INSERT INTO test_rls_orders (user_id, description)
  VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Intento de suplantación');
-- ESPERADO: ERROR 42501 (new row violates row-level security policy)
ROLLBACK;

-- 10. Limpiar tabla de prueba
DROP TABLE IF EXISTS test_rls_orders;
