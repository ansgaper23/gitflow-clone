# GitFlow (clon)

Clon funcional de [mygitflow.com](https://mygitflow.com): un agente de IA que se conecta a un
repositorio de GitHub, conversa con el usuario sobre el código, propone cambios y **solo los
aplica cuando el usuario los aprueba explícitamente**.

## Estructura

```
gitflow-clone/
  backend/   API en Express: auth GitHub OAuth, integración con GitHub, agente de IA (Claude), planes
  frontend/  React + Vite + Tailwind: landing, auth, dashboard, chat, cuenta
```

## Puesta en marcha

### 1. Supabase (base de datos)

1. Crea un proyecto gratis en [supabase.com](https://supabase.com).
2. En **SQL Editor**, ejecuta el contenido de `backend/src/db/schema.sql` (crea tablas y planes).
3. En **Project Settings → API**, copia `Project URL` y la `service_role key` (secreta, no la `anon`).

### 2. GitHub OAuth App

1. Ve a [github.com/settings/developers](https://github.com/settings/developers) → **New OAuth App**.
2. Homepage URL: `http://localhost:5173`
3. Authorization callback URL: `http://localhost:8787/api/auth/github/callback`
4. Copia el `Client ID` y genera un `Client Secret`.

### 3. Cuentas de IA (Claude y/o Gemini)

Las API keys de los modelos de IA ya NO van en `.env` — se gestionan desde el panel `/admin`
dentro de la propia app (ver más abajo), en la tabla `ai_accounts`. Necesitas al menos una:

- **Gemini (gratis)**: crea una key en [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (sin tarjeta). Usa el modelo `gemini-flash-lite-latest` para más cuota gratuita en el tier free.
- **Anthropic (Claude)**: crea una key en [console.anthropic.com](https://console.anthropic.com) (requiere saldo).

### 4. Migraciones adicionales

Además de `schema.sql`, ejecuta también en el SQL Editor de Supabase:
- `backend/src/db/migration_ai_accounts.sql` — panel de administración de cuentas de IA
- `backend/src/db/migration_db_connections.sql` — conexión de Supabase/Postgres por repositorio
- `backend/src/db/migration_supabase_oauth.sql` — conexión de 1 clic vía OAuth (opcional, ver paso 5)
- `backend/src/db/migration_asset_uploads.sql` — subir imágenes/PDF al repo o a Supabase Storage

(Si es una instalación nueva, `schema.sql` ya incluye todo esto y puedes saltarte este paso.)

### 5. Supabase OAuth App (opcional — botón "Conectar con Supabase" de 1 clic)

Sin esto, el botón de 1 clic simplemente no aparece y solo queda la opción manual (pegar
connection string), que siempre funciona. Para habilitarlo:

1. En tu organización de [supabase.com](https://supabase.com) → **Organization Settings → OAuth Apps → Add application**.
2. Nombre: `GitFlow`. Redirect URI: `http://localhost:8787/api/auth/supabase/callback`.
3. En **Scopes**, activa al menos `Projects: Read`, `Projects: Write` (para crear proyectos nuevos,
   ver más abajo), `Organizations: Read` (idem), `Database: Write` y `Secrets: Read` (habilita
   subir imágenes a Supabase Storage).
4. Copia el `Client ID` y `Client Secret` a `SUPABASE_OAUTH_CLIENT_ID` / `SUPABASE_OAUTH_CLIENT_SECRET` en `.env`.

Con esto conectado, un usuario hace clic en "Conectar con Supabase" desde el chat, autoriza en
la pantalla de Supabase, elige el proyecto de la lista, y listo — sin copiar ni pegar ninguna key.

### 6. Servicio de vista previa (opcional — panel "Vista previa" en el chat)

Es un pequeño orquestador (Node/Express) que corre en una VPS aparte (no en tu máquina): clona el
repo, instala dependencias y levanta su servidor de desarrollo (Vite/Next/otro) para que se pueda
ver embebido en el chat, estilo Lovable. El código vive en este repo bajo `infra/preview-orchestrator/`
(cópialo a tu VPS) y se deja corriendo ahí como servicio systemd.

**Requisitos de la VPS**: Ubuntu/Debian, Node ≥ 20 instalado, acceso SSH root. 1 vCPU / 1 GB RAM +
swap alcanza para repos chicos-medianos, pero solo soporta **un preview a la vez** (arrancar uno
nuevo apaga el anterior).

**Setup rápido** (sustituye `TU_IP` y ajusta el secreto):
```bash
# En la VPS:
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
sudo bash -c 'echo "/swapfile none swap sw 0 0" >> /etc/fstab'
mkdir -p /opt/gitflow-previews/orchestrator
# copia infra/preview-orchestrator/server.mjs y package.json a esa carpeta, luego:
cd /opt/gitflow-previews/orchestrator && npm install
```
Crea `/opt/gitflow-previews/orchestrator/.env`:
```
ORCH_PORT=4000
PREVIEW_PORT=4100
ORCH_SECRET=<genera uno con: openssl rand -hex 24>
PUBLIC_HOST=TU_IP
```
Y un servicio systemd (`/etc/systemd/system/gitflow-preview.service`) que ejecute
`node server.mjs` con `EnvironmentFile` apuntando a ese `.env`, `Restart=always`. Habilítalo con
`systemctl enable --now gitflow-preview`. Abre los puertos `4000` (API) y `4100` (preview) en el
firewall (`ufw allow 4000/tcp && ufw allow 4100/tcp`).

En `backend/.env`, agrega:
```
PREVIEW_ORCHESTRATOR_URL=http://TU_IP:4000
PREVIEW_ORCHESTRATOR_SECRET=<el mismo ORCH_SECRET de arriba>
```

Sin esto configurado, el botón "Vista previa" del chat simplemente no hace nada (se comporta como
no disponible).

**Limitaciones conocidas de este v1** (documentadas a propósito, no son bugs pendientes):
- Sin Docker: el código del usuario corre como proceso directo en la VPS, sin aislamiento de
  recursos ni sandboxing. Válido para pruebas propias; antes de exponerlo a usuarios no confiables,
  correr cada preview en un contenedor con límites de CPU/memoria.
- El token de GitHub viaja en la URL de clonado por HTTP plano hacia la VPS (sin TLS). Aceptable
  para un setup de pruebas en la misma red/VPN; en producción, servir el orquestador detrás de
  HTTPS.
- Detección de framework simple: busca `vite.config.*` o `next.config.*`; si no encuentra ninguno,
  intenta `npm run dev` con `HOST`/`PORT` por variable de entorno (funciona para Create React App
  y similares, no para todo).

### 8. Backend

```bash
cd backend
cp .env.example .env
# edita .env con los valores de los pasos anteriores
npm install
npm run dev   # http://localhost:8787
```

### 9. Frontend

```bash
cd frontend
npm install
npm run dev   # http://localhost:5173
```

Abre `http://localhost:5173`. El dev server de Vite ya tiene un proxy configurado para
reenviar `/api/*` al backend en `:8787` (ver `frontend/vite.config.js`).

## Flujo de la app

1. **Landing** (`/`) — hero, planes de precio, testimonios.
2. **Auth** (`/auth`) — login/registro vía GitHub OAuth (sin contraseñas).
3. **Dashboard** (`/dashboard`) — lista tus repos de GitHub, y arriba una caja **"¿Qué quieres
   construir?"** estilo Lovable: describes tu idea, opcionalmente marcas "crear también una base
   de datos en Supabase", y GitFlow crea el repo en GitHub, le hace commit a un scaffold inicial
   (Vite + React + Tailwind), aprovisiona el proyecto de Supabase si lo pediste (puede tardar
   1-3 min), y te lleva directo al chat de ese repo — donde el prompt ya se envía solo y la IA
   empieza a construir (con el mismo flujo de aprobación de siempre) mientras arranca el preview.
4. **Chat** (`/chat/:owner/:repo`) — conversas con el agente; cuando propone cambios a un
   archivo aparece una tarjeta con diff y botones **Aprobar y aplicar** / **Rechazar**. Aprobar
   crea un commit real en tu repositorio vía la API de GitHub. Puedes **detener** al agente
   mientras piensa (cancela la llamada al modelo y a GitHub, sin gastar cuota de más).
   - Toggle **Plan / Build** sobre el input: en **Plan**, la IA literalmente no tiene las
     herramientas para proponer cambios (ni de código, ni de base de datos, ni de archivos) —
     solo explora el repo y discute contigo el enfoque en texto, aunque le insistas en que lo
     aplique ya. En **Build** (por defecto) puede proponer cambios como siempre.
   - El panel de **vista previa** (cuando está abierto) tiene un borde arrastrable entre el chat
     y el iframe — el ancho elegido se guarda en `localStorage` y se recuerda entre sesiones.
   - Botón **"Conectar base de datos"** en la cabecera del chat: **"Conectar con Supabase" de 1
     clic** (si configuraste la OAuth App del paso 5) elige el proyecto de una lista tras
     autorizar en Supabase; o, como respaldo, **pega el connection string** manualmente (Project
     Settings → Database → Connection string). Con cualquiera de las dos, el agente puede
     explorar el esquema y proponer cambios SQL (tablas, columnas, datos), igual con aprobación
     manual antes de ejecutarse. Es por repositorio, no global.
   - Botón de **adjuntar (📎)** junto al input: sube un archivo `.sql` (ej. un dump exportado de
     otra plataforma) y queda como cambio de base de datos pendiente de aprobar. Soporta dumps de
     `pg_dump` con sentencias `COPY ... FROM stdin` (formato por defecto), no solo `INSERT`
     sueltos — requiere que la conexión de este repo sea manual (connection string), la vía OAuth
     no soporta `COPY`. Límite: 25 MB por archivo.
   - **Aviso de base equivocada**: al conectar una base, GitFlow busca en el repo (`supabase/config.toml`,
     `.env`, `.env.example`) a qué proyecto de Supabase apunta realmente el código, y si no
     coincide con el que conectaste muestra una advertencia (no bloquea, por si es intencional).
   - El mismo botón 📎 también acepta **imágenes y PDF**: se adjuntan a tu próximo mensaje (se ven
     como una miniatura arriba del input) y la IA decide qué hacer según lo que le pidas — si solo
     preguntas, los analiza (visión / lectura de texto del PDF) y responde directo; si pides
     agregarlo al sitio, propone subirlo con **"Aprobar y subir"** al repositorio de GitHub (ej.
     `public/images/logo.png`) o a un bucket de **Supabase Storage** (si conectaste Supabase por
     OAuth) — la IA elige el destino más apropiado según el proyecto. Límite: 10 MB por archivo.
     La subida a Storage requiere el scope **"Secrets: Read"** en la OAuth App de Supabase (ver
     paso 5) además de los ya configurados, para poder leer la `service_role key` del proyecto.
   - Botón **"Vista previa"** en la cabecera: abre un panel dividido (chat a la izquierda, la app
     corriendo de verdad a la derecha en un iframe), estilo Lovable. "Iniciar preview" clona el
     repo en la VPS configurada (paso 6), instala dependencias y levanta su servidor de desarrollo
     — verás el progreso en vivo mientras instala. Solo un preview corre a la vez en toda la
     instalación; iniciar uno nuevo apaga el anterior. Se apaga solo tras 20 minutos sin uso.
5. **Cuenta** (`/account`) — estado del plan y "compra" de planes (pago simulado, ver abajo).
6. **Admin** (`/admin`, solo para usuarios con `is_admin = true`) — gestiona las cuentas de IA
   (Claude, Gemini…): agregar, activar/desactivar, reordenar prioridad, probar conexión. El
   sistema prueba las cuentas activas en orden y rota a la siguiente si una falla (cuota agotada,
   sin saldo, etc.), con un cooldown de 5 minutos antes de reintentar una que falló.

## Pagos

El endpoint `POST /api/plans/purchase` (`backend/src/routes/plans.js`) activa el plan al
instante sin cobrar nada real — es un stub para poder probar el flujo completo sin depender de
una pasarela de pago. Para cobros reales, sustitúyelo por un checkout de Stripe o Mercado Pago
usando tus propias credenciales (nunca compartas claves secretas de producción en texto plano).

## Notas de seguridad

- El token de acceso de GitHub del usuario se guarda en la tabla `users` para poder leer/escribir
  en sus repos en su nombre. En producción, cífralo en reposo (ej. `pgsodium` de Supabase) en
  lugar de guardarlo en texto plano.
- El agente de IA (`backend/src/services/agent.js`) nunca puede aplicar cambios directamente:
  solo puede leer archivos/esquema y "proponer" un cambio, que queda en estado `pending` hasta
  que el usuario aprueba explícitamente (`/api/changes/:id/approve` o `/api/db-changes/:id/approve`).
- El connection string de Postgres de cada repo (`repo_db_connections.connection_string`) da
  acceso SQL completo a esa base de datos — se guarda en texto plano igual que el resto de
  credenciales de este proyecto. En producción, cífralo en reposo.
- Los tokens OAuth de Supabase (`users.supabase_access_token` / `supabase_refresh_token`) dan
  acceso a la Management API de la cuenta del usuario (listar/leer/escribir en sus proyectos)
  con el alcance de los scopes elegidos al crear la OAuth App. Igual que los demás tokens de este
  proyecto, se guardan en texto plano — cífralos en reposo en producción.
