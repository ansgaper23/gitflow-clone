import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, Check, ChevronDown, ExternalLink, X } from 'lucide-react'
import { api } from '../lib/api.js'

// Selector de página estilo Lovable: un pill con la ruta actual que abre un desplegable con
// las páginas detectadas en el código (aunque no estén linkeadas desde ningún lado) y un campo
// para escribir cualquier ruta a mano.
export default function PathBar({ projectId, currentPath, onNavigate, previewUrl, previewToken }) {
  const [open, setOpen] = useState(false)
  const [pages, setPages] = useState(null)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  // Al abrir, el input muestra currentPath ya seleccionado (para poder escribir encima), pero
  // ESE texto no debe filtrar la lista todavía — si currentPath no es "/", filtrar por él de
  // entrada ocultaría el resto de las páginas antes de que el usuario toque una tecla. Recién
  // filtra una vez que edita el campo de verdad.
  const [touched, setTouched] = useState(false)
  const [menuPos, setMenuPos] = useState(null) // { top, left } en coordenadas de viewport
  const containerRef = useRef(null)
  const menuRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!open || pages || error) return
    let cancelled = false
    api
      .listProjectPages(projectId)
      .then((data) => {
        if (!cancelled) setPages(data.paths || [])
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [open, pages, error, projectId])

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e) => {
      if (containerRef.current?.contains(e.target)) return
      if (menuRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const openMenu = () => {
    // La barra tiene scroll horizontal (overflow-x-auto) — eso hace que el navegador recorte
    // también en vertical cualquier cosa que se salga de su caja, incluido este desplegable si
    // quedara adentro. Por eso se renderiza en un portal a document.body, posicionado a mano
    // con las coordenadas del botón, para escapar ese recorte.
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      const width = 288 // w-72
      const left = Math.min(rect.left, window.innerWidth - width - 8)
      setMenuPos({ top: rect.bottom + 4, left: Math.max(8, left) })
    }
    setQuery(currentPath)
    setTouched(false)
    setOpen(true)
    // el input recién existe después de este render — seleccionar el texto (como en la imagen
    // de referencia) para que el usuario pueda escribir encima sin borrar a mano.
    requestAnimationFrame(() => inputRef.current?.select())
  }

  const goTo = (path) => {
    onNavigate(path)
    setOpen(false)
    setQuery('')
  }

  const submitQuery = (e) => {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    goTo(trimmed.startsWith('/') ? trimmed : `/${trimmed}`)
  }

  const filterText = touched ? query : ''
  const filtered = (pages || []).filter((p) => p.toLowerCase().includes(filterText.toLowerCase()))

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="press flex items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1 text-[11px] font-mono text-muted hover:text-text"
      >
        <span className="max-w-[9rem] truncate">{currentPath}</span>
        <ChevronDown className={`size-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open &&
        menuPos &&
        createPortal(
          <div
            ref={menuRef}
            style={{ top: menuPos.top, left: menuPos.left }}
            className="animate-materialize-in fixed z-50 w-72 rounded-lg border border-border bg-surface p-2 shadow-xl [--materialize-origin:top_left]"
          >
            <div className="flex items-center gap-1.5">
              <form
                onSubmit={submitQuery}
                className="flex flex-1 items-center gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1.5"
              >
                <Search className="size-3.5 shrink-0 text-muted" />
                <input
                  ref={inputRef}
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setTouched(true)
                  }}
                  placeholder="Buscar página o escribir ruta"
                  className="w-full bg-transparent text-xs outline-none placeholder:text-muted"
                />
              </form>
              <button
                type="button"
                onClick={() => setOpen(false)}
                title="Cerrar"
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-white/5 hover:text-text"
              >
                <X className="size-3.5" />
              </button>
            </div>

            <div className="mt-1.5 max-h-56 overflow-y-auto">
              {error && <p className="px-1 py-1.5 text-[11px] text-red-300">{error}</p>}
              {!error && !pages && <p className="px-1 py-1.5 text-[11px] text-muted">Buscando páginas…</p>}
              {pages && filtered.length === 0 && (
                <p className="px-1 py-1.5 text-[11px] text-muted">Sin coincidencias. Escribí una ruta y presioná Enter.</p>
              )}
              {filtered.map((p) => (
                <div
                  key={p}
                  onClick={() => goTo(p)}
                  className="group flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-white/5"
                >
                  <Check className={`size-3 shrink-0 ${p === currentPath ? 'text-primary' : 'text-transparent'}`} />
                  <span className="flex-1 truncate font-mono">{p}</span>
                  {previewUrl && (
                    <a
                      href={previewToken ? `${previewUrl}${p}?_pt=${encodeURIComponent(previewToken)}` : `${previewUrl}${p}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title="Abrir en pestaña nueva"
                      className="flex size-5 shrink-0 items-center justify-center rounded text-muted opacity-0 hover:bg-white/10 hover:text-text group-hover:opacity-100"
                    >
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
