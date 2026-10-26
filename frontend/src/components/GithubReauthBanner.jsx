import { useEffect, useState } from 'react'
import { Github, AlertTriangle } from 'lucide-react'
import { api } from '../lib/api.js'

// GitHub puede invalidar el token del usuario en cualquier momento (revocado, contraseña
// cambiada, expiración) sin avisarle a FlowPro. Cuando cualquier llamada al backend detecta
// esto (ver api.js: código "github_reauth_required"), se dispara este evento global y el
// banner queda visible en toda la app hasta que el usuario reconecta su cuenta.
export default function GithubReauthBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onReauthRequired = () => setVisible(true)
    window.addEventListener('gitflow:github-reauth-required', onReauthRequired)
    return () => window.removeEventListener('gitflow:github-reauth-required', onReauthRequired)
  }, [])

  if (!visible) return null

  return (
    <div className="flex items-center justify-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
      <AlertTriangle className="size-4 shrink-0" />
      <span>Tu conexión con GitHub expiró o fue revocada. Reconéctala para seguir usando previews y el chat.</span>
      <a
        href={api.githubLinkUrl()}
        className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-500/20"
      >
        <Github className="size-3.5" />
        Reconectar GitHub
      </a>
    </div>
  )
}
