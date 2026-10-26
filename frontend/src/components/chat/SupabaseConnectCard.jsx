import React, { useState } from 'react'
import { Eye, EyeOff, Database, Key, Server, Loader2, AlertTriangle } from 'lucide-react'

export function SupabaseConnectCard({ projectId, zipExtractPath, onComplete, initialProjectRef, initialAnonKey, initialServiceRoleKey }) {
  const isPreconfigured = Boolean(initialProjectRef && initialAnonKey && initialServiceRoleKey)
  
  const [formData, setFormData] = useState({
    projectRef: initialProjectRef || '',
    dbPassword: '',
    anonKey: initialAnonKey || '',
    serviceRoleKey: initialServiceRoleKey || ''
  })
  
  const [showKeys, setShowKeys] = useState({
    dbPassword: false,
    anonKey: false,
    serviceRoleKey: false
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleChange = (e) => {
    setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const toggleShowKey = (keyName) => {
    setShowKeys(prev => ({ ...prev, [keyName]: !prev[keyName] }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    
    try {
      const payload = {
        projectRef: formData.projectRef.trim(),
        dbPassword: formData.dbPassword.trim(),
        anonKey: formData.anonKey.trim(),
        serviceRoleKey: formData.serviceRoleKey.trim(),
        zipExtractPath
      };

      const res = await fetch(`/api/projects/${projectId}/execute-supabase-migration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al conectar con Supabase')
      
      if (onComplete) onComplete(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const renderInput = (name, label, placeholder, icon, type = 'text', helpText = '') => {
    const isSecret = type === 'password'
    const show = showKeys[name]
    
    return (
      <div className="mb-4">
        <label className="mb-1.5 block text-xs font-medium text-text">{label}</label>
        {helpText && <p className="mb-2 text-[11px] text-muted">{helpText}</p>}
        <div className="relative flex items-center">
          <div className="absolute left-3 text-muted">{icon}</div>
          <input
            type={isSecret && !show ? 'password' : 'text'}
            name={name}
            value={formData[name]}
            onChange={handleChange}
            placeholder={placeholder}
            className="w-full rounded-lg border border-border bg-surface-2 py-2 pl-9 pr-10 text-sm text-text placeholder:text-muted/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/50 transition-colors"
            required
          />
          {isSecret && (
            <button
              type="button"
              onClick={() => toggleShowKey(name)}
              className="absolute right-3 text-muted hover:text-text transition-colors"
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="my-4 overflow-hidden rounded-xl border border-primary/20 bg-surface/50 shadow-lg backdrop-blur-md">
      <div className="border-b border-white/5 bg-primary/10 px-5 py-3 flex items-center gap-2">
        <Database className="size-5 text-primary" />
        <h3 className="font-semibold text-text">Conectar Supabase Cloud (BYODB)</h3>
      </div>
      
      <form onSubmit={handleSubmit} className="p-5">
        <div className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            <p>
              <strong>¡Importante!</strong><br />
              Se detectó un paquete de Lovable. Ingresa las credenciales de tu proyecto para importar la base de datos automáticamente.
            </p>
          </div>
        </div>

        {isPreconfigured && (
          <div className="mb-6 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-primary/80">
            <p className="mb-1 font-semibold">✓ Proyecto vinculado previamente</p>
            <p className="font-mono text-[10px] opacity-70">
              URL: https://{formData.projectRef}.supabase.co<br/>
              URI: postgresql://postgres:[PASSWORD]@db.{formData.projectRef}.supabase.co:5432/postgres
            </p>
          </div>
        )}

        {!isPreconfigured && renderInput(
          'projectRef',
          'Project Reference ID',
          'abcdefghijklmnopqrst',
          <Server className="size-4" />,
          'text',
          'Búscalo en Supabase: Project Settings > General > Reference ID'
        )}

        {renderInput(
          'dbPassword',
          'Database Password',
          'Tu contraseña de base de datos',
          <Key className="size-4" />,
          'password',
          'La contraseña que configuraste al crear el proyecto de Supabase'
        )}

        {!isPreconfigured && renderInput(
          'anonKey',
          'Project API Key (anon / public)',
          'eyJhbGciOi...',
          <Key className="size-4" />,
          'password',
          'Búscalo en Supabase: Project Settings > API > Project API keys'
        )}

        {!isPreconfigured && renderInput(
          'serviceRoleKey',
          'Service Role Key',
          'eyJhbGciOi...',
          <Key className="size-4" />,
          'password',
          'Búscalo en Supabase: Project Settings > API > Project API keys (service_role)'
        )}

        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-400 border border-red-500/20">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 transition-all"
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Migrando Datos...
              </>
            ) : (
              'Ejecutar Migración'
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
