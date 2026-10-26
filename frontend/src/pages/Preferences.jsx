import { useState, useEffect } from 'react'
import { Check, Loader2, Paintbrush, Bot, MessageSquare, Smile, Settings } from 'lucide-react'
import AppNav from '../components/AppNav.jsx'
import { useTheme } from '../context/ThemeContext.jsx'

export default function Preferences() {
  const { theme, toggleTheme } = useTheme()
  const [model, setModel] = useState(localStorage.getItem('fp_pref_model') || 'gemini')
  const [tone, setTone] = useState(localStorage.getItem('fp_pref_tone') || 'professional')
  const [useEmojis, setUseEmojis] = useState(localStorage.getItem('fp_pref_emojis') !== 'false')
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    localStorage.setItem('fp_pref_model', model)
    localStorage.setItem('fp_pref_tone', tone)
    localStorage.setItem('fp_pref_emojis', useEmojis ? 'true' : 'false')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="min-h-screen">
      <AppNav />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center gap-3">
          <Settings className="size-6 text-primary" />
          <h1 className="text-2xl font-bold tracking-tight text-brand-gradient">Preferencias</h1>
        </div>
        <p className="mt-2 text-sm text-muted">Configura cómo se ve la interfaz y cómo responde la IA.</p>

        <div className="mt-8 space-y-6">
          {/* Apariencia */}
          <section className="rounded-xl border border-border bg-surface/60 p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <Paintbrush className="size-4 text-primary" /> Apariencia
            </h2>
            <div className="mt-4">
              <p className="text-sm text-muted">Color de fondo / Tema</p>
              <div className="mt-2 flex gap-3">
                <button
                  onClick={() => theme === 'light' ? toggleTheme() : null}
                  className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${theme === 'dark' ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background/50 text-muted hover:border-primary/50'}`}
                >
                  Modo Oscuro
                </button>
                <button
                  onClick={() => theme === 'dark' ? toggleTheme() : null}
                  className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${theme === 'light' ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background/50 text-muted hover:border-primary/50'}`}
                >
                  Modo Claro
                </button>
              </div>
            </div>
          </section>

          {/* Modelos de IA */}
          <section className="rounded-xl border border-border bg-surface/60 p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <Bot className="size-4 text-primary" /> Modelo de IA
            </h2>
            <p className="mt-1 text-xs text-muted">Selecciona qué motor de inteligencia artificial utilizar.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {[
                { id: 'gemini', name: 'Gemini Pro', desc: 'Rápido y equilibrado.' },
                { id: 'claude', name: 'Claude 3.5', desc: 'Excelente para código complejo.' },
                { id: 'gpt4', name: 'GPT-4o', desc: 'El más avanzado de OpenAI.' }
              ].map(m => (
                <button
                  key={m.id}
                  onClick={() => setModel(m.id)}
                  className={`flex flex-col gap-1 rounded-md border p-3 text-left transition-colors ${model === m.id ? 'border-primary bg-primary/10' : 'border-border bg-background/50 hover:border-primary/50'}`}
                >
                  <span className={`text-sm font-medium ${model === m.id ? 'text-primary' : 'text-text'}`}>{m.name}</span>
                  <span className="text-[11px] text-muted">{m.desc}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Tono y Personalidad */}
          <section className="rounded-xl border border-border bg-surface/60 p-5">
            <h2 className="flex items-center gap-2 font-semibold">
              <MessageSquare className="size-4 text-primary" /> Tono y Personalidad
            </h2>
            
            <div className="mt-4">
              <p className="text-sm text-muted">¿Cómo quieres que te responda?</p>
              <div className="mt-2 flex gap-3">
                <button
                  onClick={() => setTone('professional')}
                  className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${tone === 'professional' ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background/50 text-muted hover:border-primary/50'}`}
                >
                  Profesional
                </button>
                <button
                  onClick={() => setTone('basic')}
                  className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${tone === 'basic' ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background/50 text-muted hover:border-primary/50'}`}
                >
                  Básico y simple
                </button>
                <button
                  onClick={() => setTone('friendly')}
                  className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${tone === 'friendly' ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background/50 text-muted hover:border-primary/50'}`}
                >
                  Amigable
                </button>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                onClick={() => setUseEmojis(!useEmojis)}
                className={`relative flex h-5 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors ${useEmojis ? 'bg-primary' : 'bg-border'}`}
              >
                <span className={`absolute size-4 rounded-full bg-white transition-transform ${useEmojis ? 'translate-x-2' : '-translate-x-2'}`} />
              </button>
              <div>
                <p className="text-sm font-medium flex items-center gap-1.5 text-text">
                  <Smile className="size-3.5" /> Utilizar Emojis
                </p>
                <p className="text-xs text-muted">Permite que la IA incluya emojis en sus respuestas.</p>
              </div>
            </div>
          </section>

          <div className="flex justify-end pt-4">
            <button
              onClick={handleSave}
              className="press flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-bold text-slate-950 hover:opacity-90"
            >
              {saved ? <Check className="size-4" /> : null}
              {saved ? 'Guardado' : 'Guardar Preferencias'}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}
