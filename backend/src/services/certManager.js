import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'

const execFileAsync = promisify(execFile)

const CERTBOT_WEBROOT = '/var/www/certbot'
const SITES_AVAILABLE = '/etc/nginx/sites-available'
const SITES_ENABLED = '/etc/nginx/sites-enabled'
const CERTBOT_EMAIL = 'admin@flow-pro.online'

export function certExists(domain) {
  return fs.existsSync(`/etc/letsencrypt/live/${domain}/fullchain.pem`)
}

// HTTP-01 vía webroot: para cuando esto corre, el dominio ya se confirmó delegado a nuestros
// nameservers (checkDelegation en dnsProvider.js), así que el challenge de Let's Encrypt llega
// derecho al bloque "default_server" de gitflow-custom-domains (ver ese archivo de nginx).
async function runCertbot(domain) {
  const args = [
    'certonly',
    '--webroot',
    '-w',
    CERTBOT_WEBROOT,
    '-d',
    domain,
    '-d',
    `www.${domain}`,
    '--non-interactive',
    '--agree-tos',
    '-m',
    CERTBOT_EMAIL,
    '--no-eff-email',
  ]
  await execFileAsync('certbot', args, { maxBuffer: 10 * 1024 * 1024 })
}

// Un bloque server{} dedicado por dominio (con SU certificado propio) — nginx de código
// abierto no soporta elegir certificado dinámicamente por SNI, así que esta es la forma
// estándar de dar HTTPS real a N dominios distintos: un archivo por dominio, todos incluidos
// vía sites-enabled. El bloque "default_server" (gitflow-custom-domains) sigue ahí como
// respaldo para dominios que todavía no tienen certificado propio.
function writeDomainNginxSite(domain, slug) {
  const content = `# Generado automáticamente al emitir el certificado de ${domain} — no editar a mano,
# se pisa solo si se vuelve a publicar/verificar el dominio.
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${domain} www.${domain};

    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location / {
        root /opt/gitflow-published;
        try_files /${slug}$uri /${slug}/index.html =404;
    }
}
`
  fs.writeFileSync(path.join(SITES_AVAILABLE, `custom-domain-${slug}.conf`), content)
  const linkPath = path.join(SITES_ENABLED, `custom-domain-${slug}.conf`)
  if (!fs.existsSync(linkPath)) fs.symlinkSync(path.join(SITES_AVAILABLE, `custom-domain-${slug}.conf`), linkPath)
}

export function removeDomainNginxSite(slug) {
  const filePath = path.join(SITES_AVAILABLE, `custom-domain-${slug}.conf`)
  const linkPath = path.join(SITES_ENABLED, `custom-domain-${slug}.conf`)
  fs.rmSync(linkPath, { force: true })
  fs.rmSync(filePath, { force: true })
}

async function reloadNginx() {
  await execFileAsync('nginx', ['-t']) // valida ANTES de recargar — si algo quedó mal, esto tira y no se toca nginx en vivo.
  await execFileAsync('nginx', ['-s', 'reload'])
}

// Emite el certificado real (si todavía no existe uno) y activa el bloque de nginx dedicado
// para ese dominio. Falla "en silencio" hacia arriba (el caller decide si loguear/reintentar) —
// no bloquea el resto del flujo de verificación del dominio si esto no sale bien todavía.
export async function issueCertificateForDomain(domain, slug) {
  if (!certExists(domain)) {
    await runCertbot(domain)
  }
  writeDomainNginxSite(domain, slug)
  await reloadNginx()
}
