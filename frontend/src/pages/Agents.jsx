import { useState, useEffect } from 'react'
import { api } from '../lib/api'

export function Agents() {
  const [agents, setAgents] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingAgent, setEditingAgent] = useState(null)
  
  useEffect(() => {
    loadAgents()
  }, [])
  
  const loadAgents = () => {
    api.listAgents()
      .then(res => setAgents(res.agents))
      .catch(err => alert(err.message))
      .finally(() => setLoading(false))
  }
  
  const handleSave = (e) => {
    e.preventDefault()
    const promise = editingAgent.id 
      ? api.updateAgent(editingAgent.id, editingAgent)
      : api.createAgent(editingAgent)
      
    promise
      .then(() => {
        setEditingAgent(null)
        loadAgents()
      })
      .catch(err => alert(err.message))
  }

  const handleDelete = (id) => {
    if (!confirm('¿Seguro que quieres eliminar este agente?')) return
    api.deleteAgent(id)
      .then(() => loadAgents())
      .catch(err => alert(err.message))
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Agent Builder</h1>
          <p className="text-gray-500 text-sm mt-1">Crea y configura asistentes de IA personalizados.</p>
        </div>
        <button
          onClick={() => setEditingAgent({ name: '', icon: '🤖', description: '', system_prompt: '' })}
          className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 font-medium"
        >
          + Nuevo Agente
        </button>
      </div>

      {loading ? (
        <div className="text-center py-10">Cargando agentes...</div>
      ) : agents.length === 0 && !editingAgent ? (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <span className="text-4xl mb-4 block">🤖</span>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">No tienes agentes personalizados</h3>
          <p className="text-gray-500 mt-2">Crea tu primer agente para automatizar tareas específicas.</p>
        </div>
      ) : null}

      {editingAgent && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
            {editingAgent.id ? 'Editar Agente' : 'Crear Agente'}
          </h2>
          <form onSubmit={handleSave} className="space-y-4">
            <div className="grid grid-cols-6 gap-4">
              <div className="col-span-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Icono</label>
                <input
                  type="text"
                  value={editingAgent.icon}
                  onChange={e => setEditingAgent({ ...editingAgent, icon: e.target.value })}
                  className="w-full text-center border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white text-xl p-2"
                  maxLength="2"
                />
              </div>
              <div className="col-span-5">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre</label>
                <input
                  type="text"
                  required
                  value={editingAgent.name}
                  onChange={e => setEditingAgent({ ...editingAgent, name: e.target.value })}
                  className="w-full border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white p-2"
                  placeholder="Ej. Redactor Pro"
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descripción</label>
              <input
                type="text"
                value={editingAgent.description}
                onChange={e => setEditingAgent({ ...editingAgent, description: e.target.value })}
                className="w-full border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white p-2"
                placeholder="¿Qué hace este agente?"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Instrucciones Base (System Prompt)</label>
              <textarea
                required
                rows="6"
                value={editingAgent.system_prompt}
                onChange={e => setEditingAgent({ ...editingAgent, system_prompt: e.target.value })}
                className="w-full border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white p-2 font-mono text-sm"
                placeholder="Escribe las instrucciones detalladas que definen la personalidad y reglas de este agente..."
              />
            </div>
            
            <div className="flex justify-end space-x-3 mt-6">
              <button
                type="button"
                onClick={() => setEditingAgent(null)}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
              >
                Guardar Agente
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {!editingAgent && agents.map(agent => (
          <div key={agent.id} className="bg-white dark:bg-gray-800 p-5 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-indigo-400 transition-colors flex flex-col">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center space-x-3">
                <span className="text-3xl">{agent.icon}</span>
                <div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white">{agent.name}</h3>
                  <span className="text-xs text-gray-500">ID: {agent.id.slice(0, 8)}...</span>
                </div>
              </div>
              <div className="flex space-x-2">
                <button onClick={() => setEditingAgent(agent)} className="text-gray-500 hover:text-indigo-600">
                  Editar
                </button>
                <button onClick={() => handleDelete(agent.id)} className="text-gray-500 hover:text-red-600">
                  Eliminar
                </button>
              </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 mb-4 flex-1">
              {agent.description}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
