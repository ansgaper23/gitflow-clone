import { useEffect, useState } from 'react'

// Cuenta regresiva en vivo de la demo gratis de 30 minutos (backend: isTrialActive/trialExpiresAt
// en middleware/auth.js) — arranca desde trialExpiresAt (ya calculado por el server) y tickea
// cada segundo en el cliente, sin pedirle nada más a la API.
export function useTrialCountdown(trialExpiresAt) {
  const [remainingMs, setRemainingMs] = useState(() =>
    trialExpiresAt ? new Date(trialExpiresAt).getTime() - Date.now() : 0,
  )

  useEffect(() => {
    if (!trialExpiresAt) return
    const tick = () => setRemainingMs(new Date(trialExpiresAt).getTime() - Date.now())
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [trialExpiresAt])

  return Math.max(0, remainingMs)
}

export function formatCountdown(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
