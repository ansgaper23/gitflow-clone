import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { api, setToken } from '../lib/api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const token = localStorage.getItem('gitflow_token')
    if (!token) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      const me = await api.me()
      setUser(me)
    } catch (err) {
      // Solo un 401 real (token inválido/expirado/revocado) borra la sesión guardada. Un
      // error de red, un timeout, o el backend reiniciando un instante no significa que el
      // usuario se desloguee — el token sigue siendo válido, así que lo dejamos intacto para
      // que el próximo refresh (o F5) lo reintente en vez de mandarlo a iniciar sesión de vuelta.
      if (err.status === 401) {
        setToken(null)
      }
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const login = (token) => {
    setToken(token)
    return refresh()
  }

  const logout = () => {
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider')
  return ctx
}
