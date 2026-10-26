import pg from 'pg'
import { from as copyFrom } from 'pg-copy-streams'
import { Readable } from 'node:stream'

const { Client } = pg

const COPY_START_RE = /^COPY\s+.+?\s+FROM\s+stdin;?\s*$/i

export function dumpContainsCopy(sql) {
  return sql.split('\n').some((line) => COPY_START_RE.test(line.trim()))
}

// Ejecuta un dump de pg_dump en formato texto plano contra `connectionString`.
// Soporta sentencias normales (CREATE TABLE, INSERT, ALTER...) y bloques
// "COPY tabla (cols) FROM stdin; ...datos... \." como los que genera pg_dump
// por defecto para los datos — el driver `pg` normal no puede ejecutar esos
// bloques como texto SQL suelto, necesitan el protocolo COPY vía pg-copy-streams.
//
// Limitación conocida: no interpreta bloques con comillas de dólar ($$...$$)
// que contengan texto parecido a "COPY ... FROM stdin" dentro de un cuerpo de
// función; para dumps de esquemas simples (tablas + datos, sin funciones
// custom) funciona de forma robusta.
export async function runDumpImport(connectionString, sqlText, { onProgress } = {}) {
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } })
  await client.connect()

  const lines = sqlText.split('\n')
  let statementsRun = 0
  let rowsCopied = 0

  const flush = async (buffer) => {
    const stmt = buffer.join('\n').trim()
    if (!stmt) return
    await client.query(stmt)
    statementsRun++
  }

  try {
    let buffer = []
    let i = 0
    while (i < lines.length) {
      const line = lines[i]
      const trimmed = line.trim()

      // Comandos meta de psql (\restrict, \unrestrict, \connect, etc.) que pg_dump
      // incluye en el dump para cuando se restaura vía psql. No son SQL válido
      // para el servidor, así que se ignoran (no aportan nada al ejecutar directo).
      if (trimmed.startsWith('\\')) {
        i++
        continue
      }

      if (COPY_START_RE.test(trimmed)) {
        await flush(buffer)
        buffer = []

        const copyHeader = line.trim().replace(/;$/, '')
        i++
        const dataLines = []
        while (i < lines.length && lines[i] !== '\\.') {
          dataLines.push(lines[i])
          i++
        }
        i++ // saltar la línea "\."

        const dataText = dataLines.length ? dataLines.join('\n') + '\n' : ''
        const copyStream = client.query(copyFrom(copyHeader))
        await new Promise((resolve, reject) => {
          Readable.from(dataText)
            .pipe(copyStream)
            .on('finish', resolve)
            .on('error', reject)
        })
        rowsCopied += dataLines.length
        onProgress?.({ statementsRun, rowsCopied })
        continue
      }
      buffer.push(line)
      i++
    }
    await flush(buffer)
    return { statementsRun, rowsCopied }
  } finally {
    await client.end()
  }
}
