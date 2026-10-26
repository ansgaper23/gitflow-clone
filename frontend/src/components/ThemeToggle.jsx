import { Sun, Moon } from 'lucide-react'
import { useTheme } from '../context/ThemeContext.jsx'

export default function ThemeToggle({ className = '' }) {
  const { theme, toggleTheme } = useTheme()
  const isLight = theme === 'light'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isLight ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-white/5 hover:text-text ${className}`}
    >
      {isLight ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </button>
  )
}
