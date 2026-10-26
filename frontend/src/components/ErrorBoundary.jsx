import { Component } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

// Sin esto, un error de render en cualquier parte del árbol (dato inesperado de un proyecto
// viejo, una respuesta del backend con una forma distinta a la esperada, etc.) tumba TODO
// React y deja la pantalla en negro — sin mensaje, sin forma de recuperarse sin recargar a
// ciegas. Con este boundary, el error queda contenido y el usuario ve qué pasó y puede
// reintentar.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Error de render capturado por ErrorBoundary:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-400">
            <AlertTriangle className="size-7" />
          </span>
          <div className="space-y-1">
            <p className="text-base font-semibold text-text">Algo salió mal</p>
            <p className="max-w-sm text-sm text-muted">
              Esta página tuvo un error inesperado. Probá recargar — si vuelve a pasar, contanos qué estabas haciendo.
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-1.5 rounded-full brand-gradient px-4 py-2 text-sm font-bold text-slate-950"
          >
            <RefreshCw className="size-3.5" />
            Recargar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
