import React, { useState } from 'react';
import { useCloudUsers, useDeleteCloudUser } from '../../../hooks/useCloudData';
import { Users, Search, Mail, Key, Trash2, Copy, Calendar, ShieldCheck } from 'lucide-react';

export default function UsersView({ projectId }) {
  const { data, isLoading } = useCloudUsers(projectId);
  const deleteMutation = useDeleteCloudUser(projectId);
  const users = data?.users || [];
  
  const [searchTerm, setSearchTerm] = useState('');
  
  const filteredUsers = users.filter(u => 
    (u.email || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
    (u.id || '').includes(searchTerm)
  );

  return (
    <div className="flex flex-col h-full border border-[#23252a] rounded-xl overflow-hidden bg-[#141518]">
      <div className="flex justify-between items-center p-4 border-b border-[#23252a] bg-[#141518]">
        <div>
          <h2 className="text-[#ededed] font-semibold text-lg flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-400" />
            Usuarios Autenticados
          </h2>
          <p className="text-[#8a8f98] text-sm mt-0.5">Gestión de usuarios registrados en tu app.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-[#8a8f98] absolute left-2.5 top-2" />
            <input 
              type="text" 
              placeholder="Buscar por email o UID..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-[#1a1c20] border border-[#23252a] rounded-lg pl-8 pr-3 py-1.5 text-sm text-[#ededed] outline-none focus:border-[#3b82f6]/50 min-w-[250px]" 
            />
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto bg-[#0c0d0e]">
        <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
          <thead className="sticky top-0 bg-[#141518] border-b border-[#23252a] shadow-sm z-10">
            <tr>
              <th className="px-4 py-3 font-medium text-[#8a8f98]">Usuario</th>
              <th className="px-4 py-3 font-medium text-[#8a8f98]">UID</th>
              <th className="px-4 py-3 font-medium text-[#8a8f98]">Proveedor</th>
              <th className="px-4 py-3 font-medium text-[#8a8f98]">Registro</th>
              <th className="px-4 py-3 font-medium text-[#8a8f98]">Último Acceso</th>
              <th className="px-4 py-3 font-medium text-[#8a8f98]">Estado</th>
              <th className="px-4 py-3 font-medium text-[#8a8f98] text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan="7" className="px-4 py-8 text-center">
                  <div className="flex flex-col items-center justify-center space-y-2">
                    <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-[#8a8f98]">Cargando usuarios...</span>
                  </div>
                </td>
              </tr>
            ) : filteredUsers.length === 0 ? (
              <tr>
                <td colSpan="7" className="px-4 py-16 text-center">
                  <div className="flex flex-col items-center justify-center">
                    <div className="w-16 h-16 rounded-full bg-[#1a1c20] flex items-center justify-center mb-4">
                      <Users className="w-8 h-8 text-[#8a8f98]" />
                    </div>
                    <p className="text-[#ededed] font-medium mb-1">Aún no hay usuarios registrados</p>
                    <p className="text-[#8a8f98] text-sm">Los usuarios que se registren mediante el flujo de autenticación de tu app aparecerán aquí en tiempo real.</p>
                  </div>
                </td>
              </tr>
            ) : (
              filteredUsers.map((user) => (
                <tr key={user.id} className="border-b border-[#23252a]/50 hover:bg-[#1a1c20] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white font-medium text-xs shadow-inner">
                        {user.email?.charAt(0).toUpperCase() || 'U'}
                      </div>
                      <span className="text-[#ededed] font-medium">{user.email || 'Sin correo'}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-[#8a8f98] font-mono text-xs">
                      {user.id.substring(0, 8)}...{user.id.substring(user.id.length - 4)}
                      <button className="hover:text-[#ededed]" title="Copiar UID" onClick={() => navigator.clipboard.writeText(user.id)}>
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[#23252a] text-[#8a8f98] border border-[#303339] flex items-center gap-1 w-max">
                      {user.provider === 'email' || !user.provider ? <Mail className="w-3 h-3" /> : <Key className="w-3 h-3" />}
                      {user.provider || 'email'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#8a8f98]">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {new Date(user.created_at).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[#8a8f98]">
                    {user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString() : '-'}
                  </td>
                  <td className="px-4 py-3">
                    {user.email_confirmed_at ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 w-max">
                        <ShieldCheck className="w-3 h-3" /> Confirmado
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 w-max">
                        Pendiente
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button 
                      className="p-1.5 rounded-lg text-[#8a8f98] hover:text-red-400 hover:bg-red-400/10 transition-colors"
                      title="Eliminar usuario"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        if (window.confirm(`¿Eliminar usuario ${user.email}?`)) {
                          deleteMutation.mutate(user.id);
                        }
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {filteredUsers.length > 0 && (
        <div className="p-3 border-t border-[#23252a] bg-[#141518] text-[#8a8f98] text-xs">
          Total: {filteredUsers.length} usuarios
        </div>
      )}
    </div>
  );
}
