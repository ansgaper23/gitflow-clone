import { getAnonKey, getServiceRoleKey } from './supabaseStorage.js'
import { computeAdminSecret } from './dbProxy.js'
import { config } from '../config.js'
import jwt from 'jsonwebtoken'

// Arma las env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) que el scaffold de FlowPro
// espera en src/lib/supabase.js, para que la app clonada en el preview no truene al arrancar.
//
// Solo es posible derivar credenciales REALES de una conexión tipo "oauth" (tenemos projectRef +
// Management API). Una conexión "manual" solo trae un connection string de Postgres, sin URL
// pública ni anon key, y muchos repos ni siquiera tienen conexión enlazada en FlowPro aunque su
// código sí importe @supabase/supabase-js (createClient revienta el render entero si url/key
// vienen vacíos). Para esos casos devolvemos credenciales "placeholder" con formato válido: no
// sirven para consultar datos reales, pero evitan el crash de arranque y dejan ver el resto de la UI.
const PLACEHOLDER_ENV = {
  VITE_SUPABASE_URL: 'https://placeholder.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'placeholder-anon-key-not-a-real-credential',
}

export async function buildPreviewEnvVars(dbConnection) {
  // "Base de datos automática" (Postgres crudo en la VPS): no tiene una API REST propia como
  // Supabase, así que el frontend habla con ella a través de nuestro proxy (routes/dbProxy.js)
  // en vez de supabase-js — ver src/lib/db.js en scaffold.js, el cliente que usa estas dos vars.
    if (dbConnection?.isVps && dbConnection.publicToken) {
    const adminSecret = computeAdminSecret(dbConnection.publicToken)
    
    // Generar JWT Service Role e inyectar variables de entorno de Supabase estándar
    // para proyectos importados que usan @supabase/supabase-js puro en Node 20 / SSR
    const serviceRoleJwt = jwt.sign(
      { role: 'service_role', iss: 'flowpro-auth' },
      config.jwtSecret,
      { expiresIn: '10y' }
    )
    
    const anonJwt = jwt.sign(
      { role: 'anon', iss: 'flowpro-auth' },
      config.jwtSecret,
      { expiresIn: '10y' }
    )

    return {
      VITE_DB_PROXY_URL: `${config.backendUrl}/api/db-proxy`,
      VITE_DB_PROXY_TOKEN: dbConnection.publicToken,
      VITE_STORAGE_PROXY_URL: `${config.backendUrl}/api/storage-proxy`,
      VITE_STORAGE_PROXY_TOKEN: dbConnection.publicToken,
      DB_ADMIN_PROXY_URL: `${config.backendUrl}/api/db-admin-proxy/${dbConnection.publicToken}`,
      DB_ADMIN_PROXY_SECRET: adminSecret,
      
      // Variables estandarizadas de Supabase apuntando a FlowPro
      SUPABASE_URL: config.backendUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleJwt,
      VITE_SUPABASE_URL: config.backendUrl,
      VITE_SUPABASE_ANON_KEY: anonJwt
    }
  }
  if (!dbConnection || dbConnection.type !== 'oauth') return PLACEHOLDER_ENV
  try {
    const projectUrl = `https://${dbConnection.projectRef}.supabase.co`
    const anonKey = await getAnonKey(dbConnection.accessToken, dbConnection.projectRef)
    const envVars = {
      VITE_SUPABASE_URL: projectUrl,
      VITE_SUPABASE_ANON_KEY: anonKey,
      // Mismo valor, otro nombre: Supabase renombró "anon key" a "publishable key" en su
      // dashboard/SDK más nuevo, y el scaffold que genera Lovable (y por lo tanto todo proyecto
      // migrado desde ahí) usa ESTE nombre, no VITE_SUPABASE_ANON_KEY. Sin esto, un repo
      // migrado que lea VITE_SUPABASE_PUBLISHABLE_KEY no encuentra nada en process.env y Vite
      // cae al valor VIEJO que haya quedado hardcodeado en un ".env" commiteado del proyecto
      // (el de Lovable original) — confirmado en un caso real: la URL nueva sí llegaba bien
      // (mismo nombre en los dos lados), pero la key seguía siendo la vieja, y Supabase
      // rechazaba el login con "Invalid API key" por la combinación URL nueva + key vieja.
      VITE_SUPABASE_PUBLISHABLE_KEY: anonKey,
    }
    // Server-only (SIN prefijo VITE_ — Vite nunca bundlea estas al cliente, a diferencia de las
    // de arriba): algunos proyectos migrados (típicamente los que traen su propio servidor
    // SSR/API routes, no el scaffold simple de FlowPro) tienen un cliente de Supabase aparte
    // para código de servidor que necesita saltarse RLS (ej. "src/integrations/.../client.
    // server.ts" con createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)) — sin esto, esos
    // archivos revientan la preview entera ("supabaseKey is required") apenas se ejecuta esa
    // ruta, aunque el resto del proyecto esté perfecto. Mismo permiso que ya usa
    // supabaseStorage.js para subir a Storage, no es un scope nuevo.
    envVars.SUPABASE_URL = projectUrl
    envVars.SUPABASE_ANON_KEY = anonKey
    envVars.SUPABASE_PUBLISHABLE_KEY = anonKey
    try {
      envVars.SUPABASE_SERVICE_ROLE_KEY = await getServiceRoleKey(dbConnection.accessToken, dbConnection.projectRef)
    } catch {
      // Best-effort — si no se puede leer (falta el scope, etc.), el resto del preview sigue
      // andando igual, solo con el server-side client sin poder inicializarse.
    }
    return envVars
  } catch {
    // Si falla (ej. falta el scope "Secrets: Read"), mejor placeholder que dejar el preview roto.
    return PLACEHOLDER_ENV
  }
}
