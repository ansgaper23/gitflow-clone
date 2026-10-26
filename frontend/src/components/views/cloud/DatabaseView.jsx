import React, { useState } from 'react';
import { useCloudTables, useCloudTableRows } from '../../../hooks/useCloudData';
import { Database, Search, Plus, RefreshCw, Key, Type, Hash, Calendar, ToggleLeft } from 'lucide-react';

export default function DatabaseView({ projectId }) {
  const { data: tablesData, isLoading: isLoadingTables } = useCloudTables(projectId);
  const [selectedTable, setSelectedTable] = useState(null);
  
  const tables = tablesData?.tables || [];

  return (
    <div className="flex h-full border border-[#23252a] rounded-xl overflow-hidden bg-[#141518]">
      <div className="w-64 border-r border-[#23252a] flex flex-col">
        <div className="p-4 border-b border-[#23252a] flex justify-between items-center bg-[#1a1c20]">
          <h3 className="text-[#ededed] font-medium text-sm">Tablas (public)</h3>
          <button className="text-[#8a8f98] hover:text-[#ededed]" onClick={() => alert('Para crear una tabla, pide al asistente de IA en el Chat que la cree por ti.')} title="Pide al asistente de IA que cree una tabla"><Plus className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {isLoadingTables ? (
            <div className="animate-pulse space-y-2 p-2">
              <div className="h-8 bg-[#1a1c20] rounded-lg"></div>
              <div className="h-8 bg-[#1a1c20] rounded-lg"></div>
            </div>
          ) : tables.length === 0 ? (
            <div className="text-center p-4 text-[#8a8f98] text-xs">No hay tablas</div>
          ) : (
            tables.map(table => (
              <button
                key={table.table_name}
                onClick={() => setSelectedTable(table.table_name)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center justify-between group transition-colors ${
                  selectedTable === table.table_name 
                    ? 'bg-[#23252a] text-[#ededed]' 
                    : 'text-[#8a8f98] hover:bg-[#1a1c20] hover:text-[#ededed]'
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <Database className="w-3.5 h-3.5 opacity-70" />
                  <span className="truncate">{table.table_name}</span>
                </div>
                {table.rls_enabled && (
                  <span className="w-2 h-2 rounded-full bg-emerald-500 opacity-80" title="RLS Activo"></span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
      <div className="flex-1 bg-[#0c0d0e] flex flex-col relative overflow-hidden">
        {selectedTable ? (
          <TableDataExplorer projectId={projectId} tableName={selectedTable} tables={tables} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 rounded-full bg-[#1a1c20] flex items-center justify-center mb-4">
              <Database className="w-8 h-8 text-[#8a8f98]" />
            </div>
            <h3 className="text-[#ededed] font-medium text-lg mb-2">Explorador de Base de Datos</h3>
            <p className="text-[#8a8f98] text-sm max-w-sm mb-6">Selecciona una tabla del panel lateral para ver y editar sus registros, o crea una nueva tabla para tu esquema público.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function TableDataExplorer({ projectId, tableName, tables }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, refetch } = useCloudTableRows(projectId, tableName, page);
  
  const tableDef = tables.find(t => (t.table_name || t.name) === tableName);
  const effectiveColumns = (data?.columns && data.columns.length > 0)
    ? data.columns
    : (tableDef?.columns && tableDef.columns.length > 0)
      ? tableDef.columns
      : (data?.rows && data.rows.length > 0)
        ? Object.keys(data.rows[0]).map(k => ({
            column_name: k,
            data_type: typeof data.rows[0][k] === 'number' ? 'integer' : typeof data.rows[0][k] === 'boolean' ? 'boolean' : 'text',
            is_primary: k === 'id'
          }))
        : [];
  const columns = effectiveColumns;
  
  const getColIcon = (type = '') => {
    const t = String(type || '').toLowerCase();
    if (t.includes('int') || t.includes('numeric') || t.includes('float')) return <Hash className="w-3 h-3" />;
    if (t.includes('time') || t.includes('date')) return <Calendar className="w-3 h-3" />;
    if (t.includes('bool')) return <ToggleLeft className="w-3 h-3" />;
    return <Type className="w-3 h-3" />;
  };

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex justify-between items-center p-4 border-b border-[#23252a] bg-[#141518]">
        <div className="flex items-center gap-3">
          <h2 className="text-[#ededed] font-semibold text-lg">{tableName}</h2>
          {tableDef?.rls_enabled && (
            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">RLS Activo</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-[#8a8f98] absolute left-2.5 top-1.5" />
            <input type="text" placeholder="Buscar registros..." className="bg-[#1a1c20] border border-[#23252a] rounded-lg pl-8 pr-3 py-1.5 text-sm text-[#ededed] outline-none focus:border-[#3b82f6]/50" />
          </div>
          <button onClick={() => refetch()} className="p-1.5 rounded-lg bg-[#1a1c20] border border-[#23252a] text-[#8a8f98] hover:text-[#ededed] hover:bg-[#23252a]">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#ededed] text-[#0c0d0e] font-medium text-sm hover:bg-white">
            <Plus className="w-4 h-4" />
            <span>Insertar</span>
          </button>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto bg-[#0c0d0e]">
        <table className="w-full text-left border-collapse text-sm whitespace-nowrap">
          <thead className="sticky top-0 bg-[#141518] border-b border-[#23252a] shadow-sm z-10">
            <tr>
              {columns.map(col => {
                const colName = col.column_name || col.name;
                return (
                  <th key={colName} className="px-4 py-2 font-medium text-[#8a8f98] border-r border-[#23252a] last:border-0 font-mono text-xs">
                    <div className="flex items-center gap-1.5">
                      {col.is_primary && <Key className="w-3 h-3 text-amber-500" />}
                      {getColIcon(col.data_type || col.type)}
                      <span>{colName}</span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={Math.max(1, columns.length)} className="px-4 py-8 text-center text-[#8a8f98]">
                  Cargando registros...
                </td>
              </tr>
            ) : data?.rows?.length === 0 ? (
              <tr>
                <td colSpan={Math.max(1, columns.length)} className="px-4 py-8 text-center text-[#8a8f98]">
                  La tabla está vacía.
                </td>
              </tr>
            ) : (
              data?.rows?.map((row, i) => (
                <tr key={i} className="border-b border-[#23252a]/50 hover:bg-[#1a1c20] transition-colors font-mono text-[13px]">
                  {columns.map(col => {
                    const colName = col.column_name || col.name;
                    let val = row[colName];
                    if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
                    return (
                      <td key={colName} className="px-4 py-2 text-[#ededed] border-r border-[#23252a]/50 last:border-0 max-w-[200px] truncate">
                        {val === null || val === undefined ? <span className="text-[#8a8f98] italic font-sans text-xs">null</span> : String(val)}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      
      {data?.totalCount > 0 && (
        <div className="flex justify-between items-center p-3 border-t border-[#23252a] bg-[#141518] text-[#8a8f98] text-xs">
          <span>Mostrando {data.rows.length} de {data.totalCount} registros</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-2 py-1 rounded bg-[#1a1c20] border border-[#23252a] disabled:opacity-50">Anterior</button>
            <span className="px-2 py-1">Página {page} de {data.totalPages}</span>
            <button onClick={() => setPage(p => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages} className="px-2 py-1 rounded bg-[#1a1c20] border border-[#23252a] disabled:opacity-50">Siguiente</button>
          </div>
        </div>
      )}
    </div>
  );
}
