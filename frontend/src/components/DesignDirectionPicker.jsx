import { useState } from 'react'
import { Loader2, Palette, X } from 'lucide-react'

// El mockup se renderiza a tamaño de escritorio real (1280x800) y se escala hacia abajo con
// CSS para entrar en la tarjeta, en vez de pedirle a la IA que genere HTML "responsive" —
// así se ve fiel a como quedaría el diseño real en desktop.
const MOCK_WIDTH = 1280
const MOCK_HEIGHT = 800
const THUMB_HEIGHT = 190

function DirectionCard({ direction, choosing, disabled, onChoose }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface/60 transition-[border-color,box-shadow] duration-200 hover:border-primary/50">
      <div className="relative w-full overflow-hidden bg-white" style={{ height: THUMB_HEIGHT }}>
        <iframe
          title={direction.name}
          srcDoc={direction.html}
          sandbox=""
          tabIndex={-1}
          style={{
            width: MOCK_WIDTH,
            height: MOCK_HEIGHT,
            border: 0,
            transform: `scale(${THUMB_HEIGHT / MOCK_HEIGHT})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
          }}
        />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <span className="truncate text-sm font-medium text-text">{direction.name}</span>
        <p className="line-clamp-2 flex-1 text-xs text-muted">{direction.description}</p>
        <button
          type="button"
          onClick={onChoose}
          disabled={disabled}
          className="press mt-2 flex items-center justify-center gap-1.5 rounded-md border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          {choosing && <Loader2 className="size-3.5 animate-spin" />}
          {choosing ? 'Generando…' : 'Elegir esta dirección'}
        </button>
      </div>
    </div>
  )
}

// Se muestra entre "el usuario describió su idea" y "se crea el proyecto real" — nada de lo
// que se ve acá toca un repositorio ni gasta cuota de npm/build, son mockups HTML sueltos.
export default function DesignDirectionPicker({ prompt, directions, creating, onChoose, onSkip }) {
  const [choosingIndex, setChoosingIndex] = useState(null)

  const handleChoose = (direction, index) => {
    if (creating) return
    setChoosingIndex(index)
    onChoose(direction)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-background">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
              <Palette className="size-4 text-primary" /> Elegí una dirección de diseño
            </h2>
            <p className="mt-1 truncate text-xs text-muted">Para: "{prompt}"</p>
          </div>
          <button
            type="button"
            onClick={onSkip}
            disabled={creating}
            className="press flex size-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-white/5 hover:text-text disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 sm:grid-cols-3">
          {directions.map((d, i) => (
            <DirectionCard
              key={i}
              direction={d}
              disabled={creating}
              choosing={creating && choosingIndex === i}
              onChoose={() => handleChoose(d, i)}
            />
          ))}
        </div>
        <div className="flex items-center justify-center border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onSkip}
            disabled={creating}
            className="press text-xs text-muted underline decoration-dotted hover:text-text disabled:opacity-50"
          >
            Omitir, dejá que la IA decida el diseño
          </button>
        </div>
      </div>
    </div>
  )
}
