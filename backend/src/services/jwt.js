import jwt from 'jsonwebtoken'
import { config } from '../config.js'

// La sesión tiene que sentirse "hasta que cierres sesión vos mismo", no expirar sola a los
// pocos días — por eso un año en vez de algo corto. Sigue siendo un token con vencimiento (no
// infinito) por las dudas de que una key quede filtrada, pero en uso normal nunca lo notás.
export function signSession(userId) {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '365d' })
}

export function verifySession(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret)
    return payload.sub
  } catch {
    return null
  }
}
