import { getActiveAccounts, RUNNERS } from './aiAccounts.js'

// Recorte de seguridad para la llamada a Gemini en sí: un dump gigante igual no entra entero
// en ningún contexto, y no hace falta el archivo completo para sacar la forma de los datos
// (tablas/columnas/ejemplos) — con las primeras ~40k chars alcanza de sobra en la práctica.
const MAX_SQL_CHARS = 40000

const SYSTEM_PROMPT = `Te paso un dump SQL (puede venir de pg_dump, mysqldump, etc.). Devolvé un resumen breve y estructurado en español, en texto plano (sin markdown pesado, sin bloques de código): qué tablas hay, sus columnas principales con el tipo si se puede inferir, y 1-2 filas de ejemplo con datos reales si el dump trae INSERTs. Sé conciso — el objetivo es que otra IA entienda la forma de los datos sin tener que leer el dump completo. Si el archivo no es un dump SQL reconocible, decilo en una línea en vez de inventar una estructura.`

// Extrae/resume un dump SQL con Gemini específicamente (no con la cuenta de mayor prioridad
// de turno) para que el resumen quede en el historial de la conversación — así, cuando el
// usuario le pida a la IA que use esos datos para escribir código, la cuenta que atienda ESE
// turno (DeepSeek normalmente, según la rotación) ya lo tiene como contexto, sin cargar el
// dump entero de nuevo. Devuelve null si no hay ninguna cuenta Gemini activa (no rompe el
// import: el flujo sigue funcionando igual que antes, solo sin el resumen).
export async function summarizeSqlDump(sqlText) {
  const accounts = (await getActiveAccounts('agent')).filter((a) => a.provider === 'gemini')
  if (accounts.length === 0) return null

  const trimmed = sqlText.length > MAX_SQL_CHARS ? `${sqlText.slice(0, MAX_SQL_CHARS)}\n...(recortado)` : sqlText

  for (const account of accounts) {
    const runner = RUNNERS[account.provider]
    if (!runner) continue
    try {
      const result = await runner({
        apiKey: account.api_key,
        model: account.model,
        system: SYSTEM_PROMPT,
        tools: [],
        history: [],
        userMessage: trimmed,
        executeTool: async () => 'n/a',
      })
      return result.text || null
    } catch {
      continue
    }
  }
  return null
}
