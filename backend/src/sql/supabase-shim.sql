-- =====================================================================
-- FLOWPRO: SHIM UNIVERSAL DE COMPATIBILIDAD SUPABASE (IDEMPOTENTE)
-- =====================================================================

-- 1. Extensiones requeridas
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 2. Esquemas del ecosistema Supabase
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;

-- 3. Tabla Stub de Usuarios (auth.users)
CREATE TABLE IF NOT EXISTS auth.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID,
    aud VARCHAR(255) DEFAULT 'authenticated',
    role VARCHAR(255) DEFAULT 'authenticated',
    email VARCHAR(255) UNIQUE,
    encrypted_password VARCHAR(255),
    email_confirmed_at TIMESTAMPTZ DEFAULT now(),
    invited_at TIMESTAMPTZ,
    confirmation_token VARCHAR(255),
    confirmation_sent_at TIMESTAMPTZ,
    recovery_token VARCHAR(255),
    recovery_sent_at TIMESTAMPTZ,
    email_change_token_new VARCHAR(255),
    email_change VARCHAR(255),
    email_change_sent_at TIMESTAMPTZ,
    last_sign_in_at TIMESTAMPTZ,
    raw_app_meta_data JSONB DEFAULT '{}'::jsonb,
    raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
    is_super_admin BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    phone VARCHAR(255) UNIQUE,
    phone_confirmed_at TIMESTAMPTZ,
    phone_change VARCHAR(255),
    phone_change_sent_at TIMESTAMPTZ,
    confirmed_at TIMESTAMPTZ,
    email_change_token_current VARCHAR(255),
    email_change_confirm_status SMALLINT,
    banned_until TIMESTAMPTZ,
    reauthentication_token VARCHAR(255),
    reauthentication_sent_at TIMESTAMPTZ,
    is_sso_user BOOLEAN DEFAULT false,
    deleted_at TIMESTAMPTZ
);

-- 4. Funciones Críticas del Esquema AUTH (resuelven auth.jwt(), auth.uid(), etc.)
CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '{}')
  )::jsonb;
$$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'sub')
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'role'),
    'anon'
  )::text;
$$;

CREATE OR REPLACE FUNCTION auth.email()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.email', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '{}')::jsonb ->> 'email')
  )::text;
$$;

-- 5. Tablas Stub de Storage
CREATE TABLE IF NOT EXISTS storage.buckets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    owner UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    public BOOLEAN DEFAULT false,
    avif_autodetection BOOLEAN DEFAULT false,
    file_size_limit BIGINT,
    allowed_mime_types TEXT[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id TEXT REFERENCES storage.buckets(id),
    name TEXT,
    owner UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    last_accessed_at TIMESTAMPTZ DEFAULT now(),
    metadata JSONB DEFAULT '{}'::jsonb,
    path_tokens TEXT[] GENERATED ALWAYS AS (string_to_array(name, '/')) STORED
);

-- 6. Funciones de Storage
CREATE OR REPLACE FUNCTION storage.filename(name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    _parts text[];
BEGIN
    _parts := string_to_array(name, '/');
    RETURN _parts[array_length(_parts, 1)];
END;
$$;

CREATE OR REPLACE FUNCTION storage.extension(name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    _parts text[];
    _filename text;
    _dot_parts text[];
BEGIN
    _parts := string_to_array(name, '/');
    _filename := _parts[array_length(_parts, 1)];
    _dot_parts := string_to_array(_filename, '.');
    IF array_length(_dot_parts, 1) > 1 THEN
        RETURN _dot_parts[array_length(_dot_parts, 1)];
    END IF;
    RETURN '';
END;
$$;

CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    _parts text[];
    _len int;
BEGIN
    _parts := string_to_array(name, '/');
    _len := array_length(_parts, 1);
    IF _len > 1 THEN
        RETURN _parts[1:_len - 1];
    END IF;
    RETURN ARRAY[]::text[];
END;
$$;

CREATE OR REPLACE FUNCTION storage.operation()
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;

-- 7. Concesión condicional de permisos si existen los roles en el VPS
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        GRANT USAGE ON SCHEMA public, auth, storage TO authenticated;
        GRANT SELECT ON auth.users TO authenticated;
        GRANT ALL ON storage.buckets, storage.objects TO authenticated;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        GRANT USAGE ON SCHEMA public, auth, storage TO anon;
        GRANT SELECT ON storage.buckets, storage.objects TO anon;
    END IF;
END $$;
