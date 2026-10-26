# Preview orchestrator

Servicio pequeño (Node/Express) que corre en una VPS aparte del backend de GitFlow. Recibe
`{repoFullName, cloneUrl, branch}`, clona el repo, corre `npm install` y levanta su servidor de
desarrollo (Vite/Next/genérico), para que GitFlow lo muestre embebido en un iframe en el chat.

Ver la sección "Servicio de vista previa" del `README.md` raíz del proyecto para la guía de
instalación paso a paso (systemd, firewall, variables de entorno).

## Endpoints

Todos requieren `Authorization: Bearer <ORCH_SECRET>`.

- `POST /start` — `{ repoFullName, cloneUrl, branch? }` → clona/instala/arranca (async; consultar `/status`)
- `GET /status` — estado actual (`idle` | `installing` | `starting` | `running` | `error`) + `logsTail`
- `POST /stop` — apaga el preview activo

## Notas

- Solo soporta **un preview a la vez** (nuevo `/start` mata al anterior). Diseñado así a propósito
  para VPS con pocos recursos.
- Las operaciones de disco (clonar, instalar) se serializan con una cola en memoria (`opChain`)
  para que dos `/start` casi simultáneos no corrompan el checkout de git compitiendo por la misma
  carpeta de trabajo.
- No usa Docker: el código clonado corre como proceso directo del sistema. Ver limitaciones de
  seguridad en el README raíz antes de exponer esto a usuarios no confiables.
