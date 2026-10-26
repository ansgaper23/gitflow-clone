import pg from 'pg'
import crypto from 'node:crypto'
import { config } from '../config.js'
import { supabase } from '../db/supabaseClient.js'

const { Client } = pg

// "Base de datos automática": Postgres propio corriendo en el mismo VPS que el backend (nunca
// expuesto a internet, ver antigravity-bridge/HOST=127.0.0.1 para el mismo patrón con el bridge
// de IA) — tercera alternativa a conectar Supabase (OAuth) o pegar un connection string propio,
// para el usuario que no quiere configurar nada externo. Usa un rol admin dedicado
// ("flowpro_admin", con CREATEDB/CREATEROLE) en vez del superusuario "postgres", para acotar el
// daño si esa credencial se filtrara alguna vez.
//
// El connection string resultante se guarda como connection_type='vps' en repo_db_connections,
// pero repoDb.js (que ejecuta el SQL real) lo trata igual que 'manual' — mismo código, cero
// cambios ahí (ver dbConnectionResolver.js).

// Identificador de rol/base válido en Postgres: minúsculas, empieza con letra, máx 63 chars.
// Se deriva de "owner/repo" (puede tener mayúsculas, guiones, puntos) más un sufijo random para
// evitar colisiones entre dos repos que normalicen al mismo nombre.
function safeIdentifier(repoFullName) {
  const base = repoFullName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  const suffix = crypto.randomBytes(4).toString('hex')
  return `flowpro_${base}_${suffix}`
}

async function withAdminClient(fn) {
  if (!config.vpsPgAdminUrl) {
    throw new Error('VPS_PG_ADMIN_URL no está configurado en este servidor.')
  }
  const client = new Client({ connectionString: config.vpsPgAdminUrl })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

// Crea un rol + base de datos nuevos, dueño de esa base únicamente (no puede ver ni tocar las
// bases de otros proyectos: REVOKE CONNECT ON DATABASE ... FROM PUBLIC cierra la puerta que
// Postgres deja abierta por defecto). Devuelve el connection string ya armado.
export async function provisionVpsDatabase(repoFullName) {
  const name = safeIdentifier(repoFullName)
  const password = crypto.randomBytes(24).toString('hex')

  await withAdminClient(async (admin) => {
    // CREATE ROLE/DATABASE no se pueden correr dentro de una transacción — cada uno es su propio
    // statement, van uno por uno.
    await admin.query(`CREATE ROLE "${name}" WITH LOGIN PASSWORD '${password}'`)
    // Postgres 16+: CREATEROLE ya NO hace a "flowpro_admin" miembro del rol que acaba de crear
    // (antes sí, cambio de seguridad) — sin este GRANT, "CREATE DATABASE ... OWNER" de abajo
    // falla con "must be able to SET ROLE" porque flowpro_admin no puede asumir ese rol todavía.
    await admin.query(`GRANT "${name}" TO flowpro_admin`)
    await admin.query(`GRANT authenticated, anon TO "${name}"`)
    await admin.query(`CREATE DATABASE "${name}" OWNER "${name}"`)
    await admin.query(`REVOKE CONNECT ON DATABASE "${name}" FROM PUBLIC`)
  })

  const connectionString = `postgresql://${name}:${password}@127.0.0.1:5432/${name}`

  // Bootstrap de auth de ESTA base puntual — se crea acá, una sola vez al aprovisionar, igual
  // que Supabase trae su esquema "auth" ya armado desde el vamos. La IA nunca gestiona
  // "_flowpro_users" con propose_db_change (queda fuera de lo que ve, ver repoDb.js); solo la usa
  // indirectamente vía "db.auth.signUp/signIn" (routes/dbProxy.js) y relaciona sus propias tablas
  // a ella con una columna "user_id uuid references _flowpro_users(id)".
  // "current_user_id()" es el equivalente casero de "auth.uid()" de Supabase: el proxy lo llena
  // por request con "set_config('app.user_id', ...)" cuando la sesión trae un JWT válido — las
  // políticas RLS que escriba la IA lo llaman igual que en Supabase.
  const bootstrap = new Client({ connectionString })
  await bootstrap.connect()
  try {
    await bootstrap.query('CREATE EXTENSION IF NOT EXISTS pgcrypto')
    await bootstrap.query(`
      CREATE TABLE _flowpro_users (
        id uuid primary key default gen_random_uuid(),
        email text unique not null,
        password_hash text not null,
        created_at timestamptz not null default now()
      )
    `)
    await bootstrap.query(`
      CREATE FUNCTION current_user_id() RETURNS uuid AS $$
        SELECT nullif(current_setting('app.user_id', true), '')::uuid
      $$ LANGUAGE sql STABLE
    `)
    // Equivalente casero de "auth.email()" de Supabase — usado al traducir políticas RLS
    // migradas desde un pg_dump real de Supabase (ver sqlAuthTranslator.js).
    await bootstrap.query(`
      CREATE FUNCTION current_user_email() RETURNS text AS $$
        SELECT email FROM _flowpro_users WHERE id = current_user_id()
      $$ LANGUAGE sql STABLE
    `)
    // --- Supabase-compatible auth schema & public.profiles with RLS ---
    await setupAuthAndProfiles(bootstrap)
  } finally {
    await bootstrap.end()
  }

  return { connectionString, databaseName: name }
}

export async function setupAuthAndProfiles(client) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS auth`)
  await client.query(`
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$ LANGUAGE sql STABLE
  `)
  await client.query(`
    CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid AS $$
      SELECT nullif(current_setting('app.user_id', true), '')::uuid
    $$ LANGUAGE sql STABLE
  `)
  await client.query(`
    CREATE OR REPLACE FUNCTION current_user_email() RETURNS text AS $$
      SELECT email FROM _flowpro_users WHERE id = current_user_id()
    $$ LANGUAGE sql STABLE
  `)
  await client.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_views WHERE schemaname = 'auth' AND viewname = 'users') THEN
        DROP VIEW auth.users CASCADE;
      END IF;
    END $$;
  `)
  await client.query(`
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text UNIQUE NOT NULL,
      password_hash text,
      raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
      raw_app_meta_data jsonb DEFAULT '{"provider": "email"}'::jsonb,
      last_sign_in_at timestamptz,
      email_confirmed_at timestamptz DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb DEFAULT '{"provider": "email"}'::jsonb;
    ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz;
    ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz DEFAULT now();
  `)
  await client.query(`
    CREATE OR REPLACE FUNCTION auth.email() RETURNS text AS $$
      SELECT email FROM auth.users WHERE id = auth.uid()
    $$ LANGUAGE sql STABLE
  `)
  await client.query(`
    CREATE OR REPLACE FUNCTION sync_flowpro_user_to_auth() RETURNS TRIGGER AS $$
    BEGIN
      IF pg_trigger_depth() <= 1 THEN
        INSERT INTO auth.users (id, email, password_hash, created_at)
        VALUES (NEW.id, NEW.email, NEW.password_hash, NEW.created_at)
        ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, updated_at = now();
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_sync_flowpro_user ON _flowpro_users;
    CREATE TRIGGER trg_sync_flowpro_user
    AFTER INSERT OR UPDATE ON _flowpro_users
    FOR EACH ROW EXECUTE FUNCTION sync_flowpro_user_to_auth();

    CREATE OR REPLACE FUNCTION sync_flowpro_user_delete() RETURNS TRIGGER AS $$
    BEGIN
      DELETE FROM auth.users WHERE id = OLD.id;
      RETURN OLD;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_sync_flowpro_user_del ON _flowpro_users;
    CREATE TRIGGER trg_sync_flowpro_user_del
    AFTER DELETE ON _flowpro_users
    FOR EACH ROW EXECUTE FUNCTION sync_flowpro_user_delete();

    CREATE OR REPLACE FUNCTION sync_auth_user_to_flowpro() RETURNS TRIGGER AS $$
    BEGIN
      IF pg_trigger_depth() <= 1 THEN
        INSERT INTO _flowpro_users (id, email, password_hash, created_at)
        VALUES (NEW.id, NEW.email, COALESCE(NEW.password_hash, ''), NEW.created_at)
        ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_sync_auth_user ON auth.users;
    CREATE TRIGGER trg_sync_auth_user
    AFTER INSERT OR UPDATE ON auth.users
    FOR EACH ROW EXECUTE FUNCTION sync_auth_user_to_flowpro();

    INSERT INTO auth.users (id, email, password_hash, created_at)
    SELECT id, email, password_hash, created_at FROM _flowpro_users
    ON CONFLICT (id) DO NOTHING;
  `)
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      email text,
      full_name text,
      avatar_url text,
      role text DEFAULT 'user',
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );

    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
    CREATE POLICY "Users can view own profile" ON public.profiles
      FOR SELECT USING (auth.uid() = id);

    DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
    CREATE POLICY "Users can update own profile" ON public.profiles
      FOR UPDATE USING (auth.uid() = id);

    DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
    CREATE POLICY "Users can insert own profile" ON public.profiles
      FOR INSERT WITH CHECK (auth.uid() = id);

    CREATE OR REPLACE FUNCTION public.handle_new_user()
    RETURNS trigger AS $$
    BEGIN
      INSERT INTO public.profiles (id, email, full_name, role)
      VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        COALESCE(NEW.raw_user_meta_data->>'role', 'user')
      )
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql SECURITY DEFINER;

    DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
    CREATE TRIGGER on_auth_user_created
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

    INSERT INTO public.profiles (id, email, full_name, role)
    SELECT id, email, split_part(email, '@', 1), 'user'
    FROM auth.users
    ON CONFLICT (id) DO NOTHING;
  `)
  await client.query(`GRANT USAGE ON SCHEMA public, auth TO anon, authenticated`)
  await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated`)
  await client.query(`GRANT ALL ON auth.users TO authenticated`)
  await client.query(`GRANT SELECT ON auth.users TO anon`)
  await client.query(`GRANT ALL ON public.profiles TO authenticated`)
  await client.query(`GRANT SELECT ON public.profiles TO anon`)
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated`)
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated`)
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated`)
}

// Bases de Flow Cloud aprovisionadas ANTES de que existiera "current_user_email()" (ver arriba)
// no la tienen — se llama de forma idempotente antes de correr SQL migrado desde Supabase que
// pueda necesitarla (ver sqlAuthTranslator.js), en vez de asumir que ya existe.
export async function ensureAuthHelpers(connectionString) {
  const client = new Client({ connectionString })
  await client.connect()
  try {
    await setupAuthAndProfiles(client)
  } finally {
    await client.end()
  }
}

// Aprovisiona la base + guarda la fila en "repo_db_connections" en un solo paso — lo usan tanto
// "POST /db-connections/vps" (el usuario la pide a mano desde Integraciones) como la creación de
// proyecto (se aprovisiona sola, por defecto, sin preguntar). El "public_token" es el equivalente
// a la anon key de Supabase: viaja en el build de la app (VITE_DB_PROXY_TOKEN) para que el
// navegador pueda leer/escribir datos reales vía "routes/dbProxy.js" sin exponer el connection
// string real de Postgres.
export async function createVpsConnection(userId, repoFullName, label) {
  const provisioned = await provisionVpsDatabase(repoFullName)
  const publicToken = crypto.randomBytes(24).toString('base64url')
  // Firma los JWT de sesión de "_flowpro_users" de ESTE proyecto — propio y separado del
  // JWT_SECRET de la plataforma (services/jwt.js), para que un token de sesión de un usuario
  // final de una app nunca pueda confundirse con uno de FlowPro, y para poder invalidar todas
  // las sesiones de un proyecto puntual sin afectar a los demás.
  const authSecret = crypto.randomBytes(32).toString('hex')
  const { data, error } = await supabase
    .from('repo_db_connections')
    .insert({
      user_id: userId,
      repo_full_name: repoFullName,
      label: label || 'Base de datos automática',
      connection_type: 'vps',
      connection_string: provisioned.connectionString,
      vps_database_name: provisioned.databaseName,
      public_token: publicToken,
      auth_secret: authSecret,
      project_ref: null,
      project_name: null,
    })
    .select('*')
    .single()
  if (error) {
    // La base ya quedó creada del lado de Postgres pero no pudimos guardar la fila — mejor
    // limpiarla que dejar una base huérfana sin ninguna referencia en FlowPro.
    await dropVpsDatabase(provisioned.databaseName).catch(() => {})
    throw error
  }
  return data
}

// Para cuando se borra la conexión desde /admin o el usuario desconecta el proyecto — evita
// dejar bases y roles huérfanos acumulándose en el Postgres del VPS para siempre.
export async function dropVpsDatabase(databaseName) {
  if (!databaseName) return
  await withAdminClient(async (admin) => {
    // Cortar conexiones activas primero — DROP DATABASE falla si alguien sigue conectado.
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    )
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`)
    await admin.query(`DROP ROLE IF EXISTS "${databaseName}"`)
  })
}
