import { promises as dns } from 'node:dns'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import { config } from '../config.js'
import { supabase } from '../db/supabaseClient.js'

const execFileAsync = promisify(execFile)
const NGINX_DOMAIN_MAP_PATH = '/etc/nginx/conf.d/custom-domains-map.conf'

// FlowPro es su propio DNS autoritativo para dominios propios de usuarios (PowerDNS corriendo
// en esta misma VPS, ver /etc/powerdns/pdns.d/pdns-flowpro.conf) — el usuario apunta los
// nameservers de SU dominio acá en vez de solo agregar un registro A/CNAME en su proveedor
// actual. "ns1"/"ns2".flow-pro.online ya resuelven a la IP pública de esta VPS (son registros
// normales dentro del DNS de flow-pro.online, no algo que dependa de esto).
export const NAMESERVERS = ['ns1.flow-pro.online.', 'ns2.flow-pro.online.']

const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i

export function isValidDomain(domain) {
  return typeof domain === 'string' && domain.length <= 253 && DOMAIN_RE.test(domain)
}

function fqdn(domain) {
  return domain.endsWith('.') ? domain : `${domain}.`
}

async function pdnsFetch(path, options = {}) {
  const res = await fetch(`${config.pdnsApiUrl}${path}`, {
    ...options,
    headers: { 'X-API-Key': config.pdnsApiKey, 'Content-Type': 'application/json', ...(options.headers || {}) },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`PowerDNS respondió ${res.status}: ${text.slice(0, 300)}`)
  }
  return res.status === 204 ? null : res.json()
}

// Crea (o reemplaza si ya existía) la zona del dominio del usuario, con NS apuntando a los
// nameservers de FlowPro y A records para el apex y "www" apuntando a esta VPS — todo lo que
// hace falta para que, una vez que el usuario cambie los nameservers en su registrador, el
// dominio resuelva directo al sitio publicado.
export async function createDomainZone(domain) {
  const zone = fqdn(domain)
  const soa = `${NAMESERVERS[0]} hostmaster.flow-pro.online. ${Math.floor(Date.now() / 1000)} 10800 3600 604800 3600`
  await pdnsFetch('/servers/localhost/zones', {
    method: 'POST',
    body: JSON.stringify({
      name: zone,
      kind: 'Native',
      nameservers: [],
      rrsets: [
        { name: zone, type: 'SOA', ttl: 3600, records: [{ content: soa, disabled: false }] },
        { name: zone, type: 'NS', ttl: 3600, records: NAMESERVERS.map((ns) => ({ content: ns, disabled: false })) },
        { name: zone, type: 'A', ttl: 300, records: [{ content: config.vpsPublicIp, disabled: false }] },
        { name: `www.${zone}`, type: 'A', ttl: 300, records: [{ content: config.vpsPublicIp, disabled: false }] },
      ],
    }),
  })
}

// Chequea si el registrador del usuario YA delegó el dominio a nuestros nameservers. A
// propósito NO usa el resolver por default del sistema (el de esta VPS reenvía a un resolver
// que a veces queda con una respuesta vieja en caché bastante más tiempo que el TTL real —
// confirmado en vivo: 1.1.1.1/8.8.8.8 ya veían la delegación nueva mientras el resolver local
// seguía devolviendo los nameservers viejos). Consultando resolvers públicos directo, este
// chequeo refleja la propagación real en vez de la caché particular de este servidor.
const PUBLIC_RESOLVERS = ['1.1.1.1', '8.8.8.8']

export async function checkDelegation(domain) {
  try {
    const resolver = new dns.Resolver()
    resolver.setServers(PUBLIC_RESOLVERS)
    const nsRecords = await resolver.resolveNs(domain)
    const normalized = nsRecords.map((ns) => `${ns.toLowerCase()}.`)
    return NAMESERVERS.every((ns) => normalized.includes(ns))
  } catch {
    return false
  }
}

// Reescribe el mapa que usa el bloque de nginx para dominios propios ($host -> slug del
// proyecto publicado) y recarga nginx — mismo patrón que preview-map.conf, que ya mantiene el
// orquestador para los subdominios de preview. Solo entran dominios YA verificados: antes de
// eso, el tráfico ni siquiera puede llegar acá (el registrador del usuario sigue apuntando a
// sus nameservers viejos), así que no hace falta filtrar nada más.
export async function syncCustomDomainsNginxMap() {
  const { data, error } = await supabase
    .from('projects')
    .select('slug, custom_domain')
    .not('custom_domain', 'is', null)
    .not('custom_domain_verified_at', 'is', null)
  if (error) throw error

  const lines = (data || []).flatMap((p) => [
    `    "${p.custom_domain}" "${p.slug}";`,
    `    "www.${p.custom_domain}" "${p.slug}";`,
  ])
  const content = `map $host $custom_domain_slug {\n    default "";\n${lines.join('\n')}\n}\n`
  await fs.writeFile(NGINX_DOMAIN_MAP_PATH, content)
  await execFileAsync('nginx', ['-s', 'reload'])
}

export async function deleteDomainZone(domain) {
  try {
    await pdnsFetch(`/servers/localhost/zones/${encodeURIComponent(fqdn(domain))}`, { method: 'DELETE' })
  } catch (err) {
    // Si ya no existía (ej. se había borrado a mano), no hace falta que falle el unpublish.
    if (!/respondió 422|respondió 404/.test(err.message)) throw err
  }
}
