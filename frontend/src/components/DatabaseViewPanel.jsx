import { useEffect, useState, useRef, useMemo } from 'react'
import {
  Table2, Loader2, AlertTriangle, RefreshCw, Database, Plus, Trash2,
  Check, X, Search, Sparkles, Key, Hash, Calendar, ToggleLeft, Type,
  Zap, Play, CheckCircle2, ChevronLeft, ArrowUpDown, Download, Filter,
  ShieldCheck, Layers, Columns3, ChevronRight
} from 'lucide-react'
import { api } from '../lib/api.js'

export default function DatabaseViewPanel({ 
  projectId, 
  repoFullName, 
  onSendPrompt, 
  initialSqlOpen = false,
  initialTable = null 
}) {
  const [tables, setTables] = useState(null)
  const [error, setError] = useState(null)
  const [selectedTable, setSelectedTable] = useState(initialTable)
  const [rows, setRows] = useState(null)
  const [loadingRows, setLoadingRows] = useState(false)
  const [rowsError, setRowsError] = useState(null)

  // Búsqueda y filtrado reactivo
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilterBar, setShowFilterBar] = useState(false)

  // Ordenamiento por columna
  const [sortColumn, setSortColumn] = useState(null)
  const [sortDirection, setSortDirection] = useState('asc') // 'asc' | 'desc'

  // Paginación
  const [pageSize, setPageSize] = useState(25)
  const [currentPage, setCurrentPage] = useState(1)

  // Selección de filas con checkboxes
  const [selectedRowIds, setSelectedRowIds] = useState(new Set())

  // Estado de edición inline de celda
  const [editingCell, setEditingCell] = useState(null) // { rowIndex, column }
  const [editValue, setEditValue] = useState('')
  const [savingRow, setSavingRow] = useState(null) // rowIndex
  const inputRef = useRef(null)

  // Modal para Insertar Fila
  const [showInsertModal, setShowInsertModal] = useState(false)
  const [newRowData, setNewRowData] = useState({})

  // Modal para Crear Tabla con IA
  const [showAiTableModal, setShowAiTableModal] = useState(false)
  const [aiTablePrompt, setAiTablePrompt] = useState('')

  // Modal para Ejecutar SQL Directo (Consola SQL)
  const [showSqlModal, setShowSqlModal] = useState(initialSqlOpen)
  const [sqlScript, setSqlScript] = useState('')
  const [executingSql, setExecutingSql] = useState(false)
  const [sqlResult, setSqlResult] = useState(null)

  const handleExecuteSql = async (e) => {
    if (e) e.preventDefault()
    if (!sqlScript.trim() || executingSql) return
    setExecutingSql(true)
    setSqlResult(null)
    const t0 = Date.now()
    try {
      if (projectId) {
        const res = await api.executeCloudSql(projectId, sqlScript.trim())
        setSqlResult(res)
        if (res.ok) {
          fetchTables()
          if (selectedTable) {
            loadRows(selectedTable)
          }
        }
      } else {
        setSqlResult({ ok: false, error: 'No se encontró un proyecto activo para ejecutar SQL.' })
      }
    } catch (err) {
      const durationMs = Date.now() - t0
      setSqlResult({
        ok: false,
        error: err.detail ? `${err.message}: ${err.detail}` : err.message,
        durationMs
      })
    } finally {
      setExecutingSql(false)
    }
  }

  const fetchTables = async () => {
    setTables(null)
    setError(null)
    try {
      if (projectId) {
        const data = await api.cloudTables(projectId)
        const tList = (data.tables || []).map((t) => ({
          name: t.table_name || t.name,
          table_name: t.table_name || t.name,
          row_count: Number(t.row_count ?? t.approximate_row_count ?? 0),
          column_count: Number(t.column_count ?? (t.columns?.length || 0)),
          columns: t.columns || [],
          rls_enabled: Boolean(t.rls_enabled)
        }))
        setTables(tList)
      } else if (repoFullName) {
        const data = await api.dbTables(repoFullName)
        const tList = (data.tables || []).map((t) => ({
          name: t.table_name || t.name,
          table_name: t.table_name || t.name,
          row_count: Number(t.row_count ?? 0),
          column_count: Number(t.column_count ?? (t.columns?.length || 0)),
          columns: t.columns || [],
          rls_enabled: Boolean(t.rls_enabled)
        }))
        setTables(tList)
      }
    } catch (err) {
      setError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    }
  }

  useEffect(() => {
    fetchTables()
  }, [projectId, repoFullName])

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingCell])

  const [loadedColumns, setLoadedColumns] = useState([])
  const [hiddenColumns, setHiddenColumns] = useState(new Set())
  const [showColumnsPopover, setShowColumnsPopover] = useState(false)
  const columnsPopoverRef = useRef(null)

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (columnsPopoverRef.current && !columnsPopoverRef.current.contains(e.target)) {
        setShowColumnsPopover(false)
      }
    }
    if (showColumnsPopover) {
      document.addEventListener('mousedown', handleOutsideClick)
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick)
    }
  }, [showColumnsPopover])

  const loadRows = async (tableName) => {
    setSelectedTable(tableName)
    setRowsError(null)
    setLoadingRows(true)
    setEditingCell(null)
    setShowInsertModal(false)
    setNewRowData({})
    setSearchQuery('')
    setCurrentPage(1)
    setSelectedRowIds(new Set())
    setLoadedColumns([])
    try {
      if (projectId) {
        const data = await api.cloudTableRows(projectId, tableName, 1, 100)
        setRows(data.rows || [])
        if (data.columns && Array.isArray(data.columns) && data.columns.length > 0) {
          setLoadedColumns(data.columns)
        }
        if (data.totalCount !== undefined || data.pagination?.totalCount !== undefined) {
          const totalRecords = Number(data.totalCount ?? data.pagination?.totalCount)
          setTables((prev) => (prev || []).map((t) => {
            if ((t.name || t.table_name) === tableName) {
              return { ...t, row_count: totalRecords }
            }
            return t
          }))
        }
      } else if (repoFullName) {
        const data = await api.dbTableRows(repoFullName, tableName, 100)
        setRows(data.rows || [])
        if (data.columns && Array.isArray(data.columns) && data.columns.length > 0) {
          setLoadedColumns(data.columns)
        }
      }
    } catch (err) {
      setRowsError(err.detail ? `${err.message}: ${err.detail}` : err.message)
    } finally {
      setLoadingRows(false)
    }
  }

  const activeTableObj = useMemo(() => {
    if (!selectedTable || !tables) return null
    return tables.find((t) => (t.name || t.table_name) === selectedTable)
  }, [selectedTable, tables])

  // Normalización universal de definición de columna
  const normalizeColDef = (c) => {
    if (typeof c === 'string') {
      return {
        name: c,
        column_name: c,
        type: 'text',
        data_type: 'text',
        is_primary: c === 'id',
        is_nullable: true
      }
    }
    const name = c.name || c.column_name || ''
    const type = c.type || c.data_type || 'text'
    const is_primary = Boolean(c.is_primary || c.is_pk || c.primaryKey || name === 'id')
    return {
      name,
      column_name: name,
      type,
      data_type: type,
      is_primary,
      is_nullable: c.is_nullable !== false
    }
  }

  // Doble Fallback Infalible de Columnas:
  // 1. Columnas devueltas por el endpoint de filas (rowsResponse.columns)
  // 2. Columnas del listado de tablas (activeTableObj.columns)
  // 3. Fallback automático desde rows: Object.keys(rows[0])
  const effectiveColumns = useMemo(() => {
    if (loadedColumns && loadedColumns.length > 0) {
      return loadedColumns.map(normalizeColDef).filter((c) => Boolean(c.name))
    }
    if (activeTableObj?.columns && activeTableObj.columns.length > 0) {
      return activeTableObj.columns.map(normalizeColDef).filter((c) => Boolean(c.name))
    }
    if (rows && rows.length > 0 && typeof rows[0] === 'object') {
      return Object.keys(rows[0]).map((k) => ({
        name: k,
        column_name: k,
        type: typeof rows[0][k] === 'number' ? 'integer' : typeof rows[0][k] === 'boolean' ? 'boolean' : 'text',
        data_type: typeof rows[0][k] === 'number' ? 'integer' : typeof rows[0][k] === 'boolean' ? 'boolean' : 'text',
        is_primary: k === 'id',
        is_nullable: true
      }))
    }
    return []
  }, [loadedColumns, activeTableObj, rows])

  // Alias retrocompatible de columnsDef
  const columnsDef = effectiveColumns

  // Columnas visibles tras aplicar ocultamiento
  const visibleColumns = useMemo(() => {
    return effectiveColumns.filter((c) => !hiddenColumns.has(c.name))
  }, [effectiveColumns, hiddenColumns])

  const columns = useMemo(() => visibleColumns.map((c) => c.name), [visibleColumns])

  // Detección dinámica de Primary Key
  const pkColumn = useMemo(() => {
    const pkDef = effectiveColumns.find((c) => c.is_primary) || effectiveColumns.find((c) => c.name === 'id') || effectiveColumns[0]
    return pkDef?.name || 'id'
  }, [effectiveColumns])

  // Guardado de edición inline
  const saveEdit = async (rowIndex, column, row) => {
    if (editValue === String(row[column] ?? '')) {
      setEditingCell(null)
      return
    }

    setSavingRow(rowIndex)
    try {
      const data = { [column]: editValue === '' ? null : editValue }
      let updatedRow = null
      if (projectId) {
        const res = await api.updateCloudTableRow(projectId, selectedTable, pkColumn, row[pkColumn], data)
        updatedRow = res.row
      } else {
        const res = await api.updateDbTableRow(repoFullName, selectedTable, pkColumn, row[pkColumn], data)
        updatedRow = res.row
      }

      const newRows = [...rows]
      newRows[rowIndex] = { ...row, ...(updatedRow || data) }
      setRows(newRows)
    } catch (err) {
      alert(`Error al actualizar celda: ${err.detail ? `${err.message}: ${err.detail}` : err.message}`)
    } finally {
      setSavingRow(null)
      setEditingCell(null)
    }
  }

  // Eliminación de fila
  const deleteRow = async (rowIndex, row) => {
    if (!confirm(`¿Eliminar esta fila de ${selectedTable}? (${pkColumn} = ${row[pkColumn]})`)) return
    setSavingRow(rowIndex)
    try {
      if (projectId) {
        await api.deleteCloudTableRow(projectId, selectedTable, pkColumn, row[pkColumn])
      } else {
        await api.deleteDbTableRow(repoFullName, selectedTable, pkColumn, row[pkColumn])
      }
      setRows(rows.filter((_, i) => i !== rowIndex))
      setTables((prev) => (prev || []).map((t) => {
        if ((t.name || t.table_name) === selectedTable) {
          return { ...t, row_count: Math.max(0, (t.row_count ?? 1) - 1) }
        }
        return t
      }))
    } catch (err) {
      alert(`Error al borrar: ${err.detail ? `${err.message}: ${err.detail}` : err.message}`)
    } finally {
      setSavingRow(null)
    }
  }

  // Eliminación de múltiples filas seleccionadas
  const deleteSelectedRows = async () => {
    if (selectedRowIds.size === 0) return
    if (!confirm(`¿Eliminar ${selectedRowIds.size} fila(s) seleccionada(s) de ${selectedTable}?`)) return
    setLoadingRows(true)
    try {
      for (const idVal of selectedRowIds) {
        if (projectId) {
          await api.deleteCloudTableRow(projectId, selectedTable, pkColumn, idVal)
        } else {
          await api.deleteDbTableRow(repoFullName, selectedTable, pkColumn, idVal)
        }
      }
      setRows((prev) => (prev || []).filter((r) => !selectedRowIds.has(r[pkColumn])))
      setSelectedRowIds(new Set())
      setTables((prev) => (prev || []).map((t) => {
        if ((t.name || t.table_name) === selectedTable) {
          return { ...t, row_count: Math.max(0, (t.row_count ?? selectedRowIds.size) - selectedRowIds.size) }
        }
        return t
      }))
    } catch (err) {
      alert(`Error al borrar filas seleccionadas: ${err.message}`)
    } finally {
      setLoadingRows(false)
    }
  }

  // Inserción de nueva fila
  const saveNewRow = async (e) => {
    e.preventDefault()
    setSavingRow('new')
    try {
      const data = {}
      for (const [k, v] of Object.entries(newRowData)) {
        if (v !== '' && v !== undefined) data[k] = v
      }

      let insertedRow = null
      if (projectId) {
        const res = await api.insertCloudTableRow(projectId, selectedTable, data)
        insertedRow = res.row
      } else {
        const res = await api.insertDbTableRow(repoFullName, selectedTable, data)
        insertedRow = res.row
      }

      setRows([insertedRow, ...(rows || [])])
      setTables((prev) => (prev || []).map((t) => {
        if ((t.name || t.table_name) === selectedTable) {
          return { ...t, row_count: (t.row_count ?? 0) + 1 }
        }
        return t
      }))
      setShowInsertModal(false)
      setNewRowData({})
    } catch (err) {
      alert(`Error al insertar fila: ${err.detail ? `${err.message}: ${err.detail}` : err.message}`)
    } finally {
      setSavingRow(null)
    }
  }

  // Creación de tabla con Agente IA
  const handleCreateAiTable = (e) => {
    e.preventDefault()
    if (!aiTablePrompt.trim()) return
    const prompt = `Crea la siguiente tabla en PostgreSQL para el esquema public: ${aiTablePrompt.trim()}. Configura sus columnas, tipos de datos idóneos, primary key y habilita Row Level Security (RLS) con políticas para authenticated y anon.`
    onSendPrompt?.(prompt)
    setShowAiTableModal(false)
    setAiTablePrompt('')
  }

  // Exportar a CSV nativo
  const handleExportCsv = () => {
    if (!rows || rows.length === 0) {
      alert('No hay registros cargados para exportar.')
      return
    }
    const headerLine = columns.join(',')
    const dataLines = rows.map((r) =>
      columns
        .map((c) => {
          const val = r[c]
          if (val === null || val === undefined) return ''
          const str = String(val).replace(/"/g, '""')
          return `"${str}"`
        })
        .join(',')
    )
    const csvContent = `${headerLine}\n${dataLines.join('\n')}`
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${selectedTable}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Toggle de ordenamiento
  const handleToggleSort = (colName) => {
    if (sortColumn === colName) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(colName)
      setSortDirection('asc')
    }
  }

  // Filtrado y ordenamiento de filas
  const processedRows = useMemo(() => {
    if (!rows) return []
    let list = rows
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((r) =>
        Object.values(r).some((val) => String(val ?? '').toLowerCase().includes(q))
      )
    }
    if (sortColumn) {
      list = [...list].sort((a, b) => {
        const valA = a[sortColumn]
        const valB = b[sortColumn]
        if (valA === valB) return 0
        if (valA === null || valA === undefined) return 1
        if (valB === null || valB === undefined) return -1
        if (typeof valA === 'number' && typeof valB === 'number') {
          return sortDirection === 'asc' ? valA - valB : valB - valA
        }
        return sortDirection === 'asc'
          ? String(valA).localeCompare(String(valB))
          : String(valB).localeCompare(String(valA))
      })
    }
    return list
  }, [rows, searchQuery, sortColumn, sortDirection])

  // Paginación de filas
  const paginatedRows = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize
    return processedRows.slice(startIndex, startIndex + pageSize)
  }, [processedRows, currentPage, pageSize])

  const totalPages = Math.max(1, Math.ceil(processedRows.length / pageSize))

  // Toggle checkbox de fila
  const toggleRowSelect = (pkVal) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev)
      if (next.has(pkVal)) next.delete(pkVal)
      else next.add(pkVal)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedRowIds.size === paginatedRows.length && paginatedRows.length > 0) {
      setSelectedRowIds(new Set())
    } else {
      const allIds = new Set(paginatedRows.map((r) => r[pkColumn]))
      setSelectedRowIds(allIds)
    }
  }

  const getColIcon = (type) => {
    const t = String(type || '').toLowerCase()
    if (t.includes('int') || t.includes('numeric') || t.includes('float') || t.includes('real'))
      return <Hash className="size-3 text-amber-400" />
    if (t.includes('time') || t.includes('date'))
      return <Calendar className="size-3 text-sky-400" />
    if (t.includes('bool'))
      return <ToggleLeft className="size-3 text-emerald-400" />
    return <Type className="size-3 text-muted" />
  }

  const totalRecordsSum = useMemo(() => {
    if (!tables) return 0
    return tables.reduce((acc, t) => acc + (t.row_count || 0), 0)
  }, [tables])

  // ==========================================================================
  // VISTA A: CUADRÍCULA DE TABLAS (selectedTable === null)
  // ==========================================================================
  if (!selectedTable) {
    return (
      <div className="flex flex-col h-full w-full bg-[#0e0f12] text-[#ededed] p-2 space-y-6 overflow-y-auto">
        {/* Cabecera Superior */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Database</h1>
            <p className="text-sm text-zinc-400 mt-1">
              View and manage the data stored in your app.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => {
                setShowSqlModal(true)
                setSqlResult(null)
              }}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-300 text-xs font-semibold shadow-sm transition-all"
            >
              <Zap className="size-3.5 text-amber-400" />
              <span>⚡ SQL Editor</span>
            </button>

            <button
              onClick={() => onSendPrompt?.('Muéstrame las políticas RLS actuales de todas las tablas y ayúdame a configurarlas con seguridad.')}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-white/10 text-zinc-300 hover:text-white text-xs font-semibold shadow-sm transition-all"
            >
              <ShieldCheck className="size-3.5 text-emerald-400" />
              <span>🛡️ RLS policies</span>
            </button>

            <button
              onClick={() => setShowAiTableModal(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md transition-all"
            >
              <Plus className="size-3.5" />
              <span>+ Nueva Tabla</span>
            </button>

            <button
              onClick={fetchTables}
              className="p-2 rounded-xl bg-zinc-900 border border-white/10 hover:bg-zinc-800 text-zinc-400 hover:text-white transition-all"
              title="Refrescar tablas"
            >
              <RefreshCw className="size-4" />
            </button>
          </div>
        </div>

        {/* Tarjeta de métricas resumidas */}
        <div className="bg-zinc-900/60 border border-white/10 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div>
              <div className="text-xs uppercase tracking-wider text-zinc-500 font-medium">Total Tablas</div>
              <div className="text-xl font-bold text-white mt-0.5">{tables?.length ?? 0} tablas</div>
            </div>
            <div className="h-8 w-px bg-white/10 hidden sm:block"></div>
            <div>
              <div className="text-xs uppercase tracking-wider text-zinc-500 font-medium">Total Registros</div>
              <div className="text-xl font-bold text-white mt-0.5">{totalRecordsSum} filas</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              PostgreSQL Conectado • Esquema public
            </span>
          </div>
        </div>

        {/* Mensajes de carga o error */}
        {!tables && !error && (
          <div className="p-12 flex flex-col items-center justify-center gap-3 text-center">
            <Loader2 className="size-7 animate-spin text-blue-500" />
            <span className="text-xs text-zinc-400">Consultando tablas de PostgreSQL…</span>
          </div>
        )}

        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs flex items-center gap-3">
            <AlertTriangle className="size-5 shrink-0 text-red-400" />
            <span>Error al conectar con la base de datos: {error}</span>
          </div>
        )}

        {tables && tables.length === 0 && (
          <div className="py-16 text-center border border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center gap-3">
            <div className="p-4 rounded-2xl bg-zinc-900 text-zinc-500">
              <Database className="size-8" />
            </div>
            <h3 className="text-base font-semibold text-white">No hay tablas en tu base de datos</h3>
            <p className="text-xs text-zinc-400 max-w-sm">
              Crea tu primera tabla con el Agente de IA o ejecuta un script SQL para estructurar los datos de tu app.
            </p>
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => setShowAiTableModal(true)}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors"
              >
                + Crear Tabla con IA
              </button>
              <button
                onClick={() => setShowSqlModal(true)}
                className="px-4 py-2 rounded-xl bg-zinc-900 border border-white/10 text-zinc-300 hover:text-white text-xs font-medium transition-colors"
              >
                ⚡ Abrir SQL Editor
              </button>
            </div>
          </div>
        )}

        {/* Grid de 2 columnas de Tablas (Estándar Lovable) */}
        {tables && tables.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {tables.map((t) => (
              <div
                key={t.name}
                onClick={() => loadRows(t.name)}
                className="p-4 rounded-xl bg-zinc-900/70 border border-white/10 hover:border-white/25 hover:bg-zinc-900 transition-all cursor-pointer flex items-center justify-between group shadow-sm"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="p-2.5 rounded-lg bg-zinc-800/80 border border-white/10 text-zinc-300 group-hover:text-blue-400 group-hover:border-blue-500/30 transition-colors shrink-0">
                    <Table2 className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white group-hover:text-blue-400 transition-colors truncate">
                      {t.name}
                    </div>
                    <div className="text-xs text-zinc-400 font-mono mt-0.5">
                      {t.row_count ?? 0} rows • {t.column_count ?? t.columns?.length ?? 0} cols
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {t.rls_enabled && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      RLS
                    </span>
                  )}
                  <ChevronLeft className="size-4 text-zinc-500 rotate-180 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal SQL Editor */}
        {renderSqlModal()}
        {/* Modal Crear Tabla con IA */}
        {renderAiTableModal()}
      </div>
    )
  }

  // ==========================================================================
  // VISTA B: EXPLORADOR DE TABLA A ANCHO COMPLETO (selectedTable !== null)
  // ==========================================================================
  return (
    <div className="flex flex-col h-full w-full bg-[#0a0e18] text-[#ededed]">
      {/* 1. Barra de Navegación y Encabezado de Tabla */}
      <div className="border-b border-white/[0.08] bg-[#0c101b]/90 px-6 py-4 backdrop-blur-md">
        {/* Enlace de regreso a la cuadrícula de tablas */}
        <button
          onClick={() => {
            setSelectedTable(null)
            setRows(null)
            setSearchQuery('')
          }}
          className="flex items-center gap-1 text-xs font-semibold text-zinc-400 hover:text-white transition-colors mb-2.5 group w-fit"
        >
          <ChevronLeft className="size-4 group-hover:-translate-x-0.5 transition-transform" />
          <span>Database</span>
        </button>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                Viewing table <span className="font-mono text-blue-400">{selectedTable}</span>
              </h1>
              {activeTableObj?.rls_enabled ? (
                <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
                  RLS policies
                </span>
              ) : (
                <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-[11px] font-medium text-amber-400">
                  Sin RLS
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Viewing records in the {selectedTable} table. Double click a value to edit in-line.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => onSendPrompt?.(`Explícame las políticas RLS actuales de la tabla "${selectedTable}" y ayúdame a configurarlas con seguridad.`)}
              className="flex items-center gap-1.5 border border-white/15 bg-zinc-900 hover:bg-zinc-800 text-xs px-3 py-1.5 rounded-lg text-zinc-300 hover:text-white font-medium transition-colors"
            >
              <ShieldCheck className="size-3.5 text-emerald-400" />
              <span>🛡️ RLS policies</span>
            </button>
            <span className="text-xs font-mono text-zinc-400 bg-white/5 border border-white/10 px-2.5 py-1.5 rounded-lg">
              PK: <span className="text-amber-400">{pkColumn}</span>
            </span>
            <span className="text-xs font-mono text-zinc-400 bg-white/5 border border-white/10 px-2.5 py-1.5 rounded-lg">
              {activeTableObj?.row_count ?? rows?.length ?? 0} filas
            </span>
          </div>
        </div>
      </div>

      {/* 2. Barra de Acciones Limpia (Lovable Standard) */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-2.5 border-b border-white/[0.08] bg-[#0c101b]/50">
        <div className="flex items-center gap-2">
          {/* Botón Filtro */}
          <div className="relative flex items-center">
            <button
              onClick={() => setShowFilterBar(!showFilterBar)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                showFilterBar || searchQuery
                  ? 'bg-blue-600/20 border-blue-500/30 text-blue-300'
                  : 'bg-zinc-900 border-white/15 text-zinc-300 hover:text-white hover:bg-zinc-800'
              }`}
            >
              <Filter className="size-3.5" />
              <span>Filter</span>
              {searchQuery && <span className="size-1.5 rounded-full bg-blue-400"></span>}
            </button>

            {/* Input desplegable o reactivo de búsqueda */}
            {(showFilterBar || searchQuery) && (
              <div className="ml-2 relative flex items-center">
                <Search className="size-3 text-zinc-400 absolute left-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    setCurrentPage(1)
                  }}
                  placeholder="Buscar en registros…"
                  className="w-56 rounded-lg border border-white/15 bg-zinc-900 pl-8 pr-7 py-1 text-xs text-white placeholder:text-zinc-500 outline-none focus:border-blue-500 font-mono"
                  autoFocus
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 text-zinc-400 hover:text-white"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Botón Agregar Fila */}
          <button
            onClick={() => setShowInsertModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 border border-white/15 hover:bg-zinc-800 text-zinc-300 hover:text-white text-xs font-medium shadow-sm transition-colors"
          >
            <Plus className="size-3.5" />
            <span>+ Add row</span>
          </button>

          {/* Botón Eliminar seleccionados */}
          {selectedRowIds.size > 0 && (
            <button
              onClick={deleteSelectedRows}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-300 text-xs font-medium transition-colors"
            >
              <Trash2 className="size-3.5" />
              <span>Delete ({selectedRowIds.size})</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Exportar CSV */}
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/15 text-zinc-300 hover:text-white text-xs font-medium transition-colors"
            title="Descargar tabla en formato CSV"
          >
            <Download className="size-3.5" />
            <span>Export CSV</span>
          </button>

          {/* Selector de Columnas Popover */}
          <div className="relative" ref={columnsPopoverRef}>
            <button
              onClick={() => setShowColumnsPopover(!showColumnsPopover)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/15 text-zinc-300 hover:text-white text-xs font-medium transition-colors"
              title="Mostrar u ocultar columnas"
            >
              <Columns3 className="size-3.5 text-zinc-400" />
              <span>Columns</span>
              {hiddenColumns.size > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-blue-500/20 text-blue-400 text-[10px] font-mono">
                  {effectiveColumns.length - hiddenColumns.size}/{effectiveColumns.length}
                </span>
              )}
            </button>

            {showColumnsPopover && (
              <div className="absolute right-0 mt-1.5 w-56 rounded-xl border border-white/15 bg-zinc-900 p-2 shadow-2xl z-50 text-xs">
                <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-white/10 text-zinc-400 font-medium">
                  <span>Columnas ({visibleColumns.length}/{effectiveColumns.length})</span>
                  <button
                    onClick={() => {
                      if (hiddenColumns.size > 0) setHiddenColumns(new Set())
                      else setHiddenColumns(new Set(effectiveColumns.map(c => c.name).filter(n => n !== pkColumn)))
                    }}
                    className="text-[11px] text-blue-400 hover:underline"
                  >
                    {hiddenColumns.size > 0 ? 'Ver todas' : 'Ocultar'}
                  </button>
                </div>
                <div className="max-h-60 overflow-y-auto space-y-1">
                  {effectiveColumns.map((col) => {
                    const isChecked = !hiddenColumns.has(col.name)
                    return (
                      <label
                        key={col.name}
                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 cursor-pointer select-none text-zinc-200"
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={col.name === pkColumn}
                          onChange={() => {
                            if (col.name === pkColumn) return
                            setHiddenColumns((prev) => {
                              const next = new Set(prev)
                              if (next.has(col.name)) next.delete(col.name)
                              else next.add(col.name)
                              return next
                            })
                          }}
                          className="rounded border-white/20 bg-transparent text-blue-600 focus:ring-0 cursor-pointer"
                        />
                        <span className="font-mono text-xs truncate flex-1">{col.name}</span>
                        {col.is_primary && <Key className="size-3 text-amber-400 shrink-0" />}
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* SQL en vivo */}
          <button
            onClick={() => {
              setShowSqlModal(true)
              setSqlResult(null)
              setSqlScript(`SELECT * FROM public."${selectedTable}" LIMIT 25;`)
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-300 text-xs font-medium transition-colors"
          >
            <Zap className="size-3.5 text-amber-400" />
            <span>⚡ SQL</span>
          </button>

          {/* Refresh */}
          <button
            onClick={() => loadRows(selectedTable)}
            className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-white/15 text-zinc-400 hover:text-white transition-colors"
            title="Recargar registros"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>

      {/* 3. Contenedor de la Tabla Espaciosa a Ancho Completo */}
      <div className="flex-1 overflow-auto bg-[#080b12]">
        {loadingRows && (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-zinc-400">
            <Loader2 className="size-6 animate-spin text-blue-500" />
            <span className="text-xs">Cargando registros de {selectedTable}…</span>
          </div>
        )}

        {rowsError && (
          <div className="m-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs flex items-center gap-3">
            <AlertTriangle className="size-5 shrink-0 text-red-400" />
            <span>{rowsError}</span>
          </div>
        )}

        {!loadingRows && !rowsError && processedRows.length === 0 && (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-zinc-500">
            <Table2 className="size-8 opacity-40" />
            <span className="text-xs font-medium">
              {searchQuery ? 'No se encontraron registros que coincidan con la búsqueda.' : 'Esta tabla está vacía.'}
            </span>
            {!searchQuery && (
              <button
                onClick={() => setShowInsertModal(true)}
                className="mt-2 text-xs text-blue-400 hover:underline font-medium"
              >
                + Insertar la primera fila
              </button>
            )}
          </div>
        )}

        {!loadingRows && !rowsError && processedRows.length > 0 && (
          <table className="w-full text-left border-collapse text-xs whitespace-nowrap">
            <thead className="sticky top-0 z-10 bg-[#0d111d] border-b border-white/[0.08] shadow-sm">
              <tr>
                {/* Checkbox seleccionar todo con ancho estricto w-10 */}
                <th className="w-10 min-w-[40px] max-w-[40px] border-r border-white/10 px-3 py-2.5 text-center">
                  <input
                    type="checkbox"
                    checked={selectedRowIds.size === paginatedRows.length && paginatedRows.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-white/20 bg-transparent text-blue-600 focus:ring-0 cursor-pointer"
                  />
                </th>

                {/* Cabeceras de Columna con Ícono de Ordenamiento ↕ */}
                {visibleColumns.map((col) => (
                  <th
                    key={col.name}
                    onClick={() => handleToggleSort(col.name)}
                    className="text-xs font-medium text-zinc-400 px-4 py-2.5 border-b border-r border-white/10 select-none cursor-pointer hover:text-zinc-200 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs truncate font-medium text-zinc-300 flex items-center gap-1.5">
                        {col.is_primary && <Key className="size-3 text-amber-400 shrink-0" title="Primary Key" />}
                        {col.name}
                      </span>
                      <ArrowUpDown className={`size-3 shrink-0 ml-1 opacity-60 ${sortColumn === col.name ? 'text-blue-400 opacity-100' : 'text-zinc-500'}`} />
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-white/[0.04]">
              {paginatedRows.map((r, rowIndex) => {
                const pkVal = r[pkColumn] ?? rowIndex
                const isRowSelected = selectedRowIds.has(pkVal)
                const absRowIndex = (currentPage - 1) * pageSize + rowIndex

                return (
                  <tr
                    key={pkVal}
                    className={`group transition-colors ${
                      isRowSelected ? 'bg-blue-600/10' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    {/* Checkbox de fila con ancho estricto w-10 */}
                    <td className="w-10 min-w-[40px] max-w-[40px] border-r border-white/10 px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={isRowSelected}
                        onChange={() => toggleRowSelect(pkVal)}
                        className="rounded border-white/20 bg-transparent text-blue-600 focus:ring-0 cursor-pointer"
                      />
                    </td>

                    {/* Celdas con Edición Inline al Doble Clic */}
                    {visibleColumns.map((col) => {
                      const c = col.name
                      const isEditing = editingCell?.rowIndex === absRowIndex && editingCell?.column === c
                      const val = r[c]
                      const isPk = c === pkColumn

                      return (
                        <td
                          key={`${absRowIndex}-${c}`}
                          onDoubleClick={() => {
                            if (savingRow || isPk) return
                            setEditingCell({ rowIndex: absRowIndex, column: c })
                            setEditValue(val === null || val === undefined ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val))
                          }}
                          className={`font-mono text-[13px] text-zinc-200 px-4 py-2.5 whitespace-nowrap max-w-md truncate border-r border-white/5 relative ${
                            val === null ? 'text-zinc-500' : ''
                          } ${isEditing ? 'bg-blue-600/20 ring-1 ring-inset ring-blue-500 p-0' : ''}`}
                        >
                          {isEditing ? (
                            <input
                              ref={inputRef}
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') setEditingCell(null)
                                else if (e.key === 'Enter') saveEdit(absRowIndex, c, r)
                              }}
                              onBlur={() => saveEdit(absRowIndex, c, r)}
                              className="w-full bg-zinc-950 px-3 py-1.5 outline-none text-white border border-blue-500 font-mono text-[13px]"
                            />
                          ) : (
                            <div className="truncate" title={typeof val === 'object' ? JSON.stringify(val) : String(val)}>
                              {val === null || val === undefined ? (
                                <span className="opacity-40 italic font-sans text-xs text-zinc-500">NULL</span>
                              ) : typeof val === 'boolean' ? (
                                val ? (
                                  <span className="text-emerald-400 font-semibold">true</span>
                                ) : (
                                  <span className="text-red-400 font-semibold">false</span>
                                )
                              ) : typeof val === 'object' ? (
                                <span className="text-cyan-300 font-mono">{JSON.stringify(val)}</span>
                              ) : (
                                String(val)
                              )}
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 4. Pie de Tabla con Selector de Filas por Página y Paginación Estilo Lovable */}
      <div className="flex flex-wrap items-center justify-between border-t border-white/[0.08] bg-[#0c101b] px-6 py-2.5 text-xs text-zinc-400 gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span>Filas por página</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value))
                setCurrentPage(1)
              }}
              className="bg-zinc-900 border border-white/15 rounded px-2 py-1 text-xs text-zinc-300 font-mono outline-none cursor-pointer hover:border-white/30"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </div>
          <span className="text-zinc-600">•</span>
          <span className="text-zinc-400 font-mono text-xs">
            {processedRows.length === 0
              ? '0 elementos'
              : `${(currentPage - 1) * pageSize + 1} - ${Math.min(
                  currentPage * pageSize,
                  processedRows.length
                )} de ${processedRows.length} elementos`}
          </span>
          <span className="hidden sm:inline text-zinc-600">•</span>
          <span className="hidden sm:inline text-zinc-500">
            Doble clic en celda para editar in-line
          </span>
        </div>

        {/* Paginación a la derecha: 1 de X páginas  <  > */}
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-zinc-400">
            {currentPage} de {totalPages || 1} página{totalPages > 1 ? 's' : ''}
          </span>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="p-1 rounded bg-zinc-900 border border-white/10 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-300 hover:text-white transition-colors"
              title="Página anterior"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="p-1 rounded bg-zinc-900 border border-white/10 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-300 hover:text-white transition-colors"
              title="Página siguiente"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Modal para Insertar Fila */}
      {showInsertModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form onSubmit={saveNewRow} className="w-full max-w-lg rounded-xl border border-white/10 bg-[#121624] p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-white mb-1">Insertar nueva fila en {selectedTable}</h3>
            <p className="text-xs text-zinc-400 mb-4">Ingresa los valores. Los campos vacíos tomarán el valor por defecto o NULL.</p>

            <div className="max-h-80 overflow-y-auto space-y-2.5 pr-1 mb-4 font-mono">
              {columnsDef.map((col) => {
                const isAutoPk = col.is_primary && (col.type.includes('serial') || col.type.includes('uuid'))
                return (
                  <div key={col.name} className="flex flex-col gap-1">
                    <label className="text-[11px] text-zinc-400 flex items-center justify-between">
                      <span className="flex items-center gap-1 font-semibold text-white">
                        {col.is_primary && <Key className="size-3 text-amber-400" />}
                        {col.name}
                      </span>
                      <span className="text-[10px] text-zinc-500">{col.type}</span>
                    </label>
                    <input
                      type="text"
                      placeholder={isAutoPk ? '(Generado automáticamente por PostgreSQL)' : 'NULL'}
                      value={newRowData[col.name] ?? ''}
                      onChange={(e) => setNewRowData({ ...newRowData, [col.name]: e.target.value })}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white placeholder:text-zinc-600 outline-none focus:border-blue-500"
                    />
                  </div>
                )
              })}
            </div>

            <div className="flex justify-end gap-2 border-t border-white/10 pt-3">
              <button
                type="button"
                onClick={() => setShowInsertModal(false)}
                className="px-3 py-1.5 rounded-lg border border-white/10 text-xs text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingRow === 'new'}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-semibold text-white transition-colors"
              >
                {savingRow === 'new' && <Loader2 className="size-3 animate-spin" />}
                <span>Guardar Fila</span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal SQL Editor */}
      {renderSqlModal()}
      {/* Modal Crear Tabla con IA */}
      {renderAiTableModal()}
    </div>
  )

  // ==========================================================================
  // MODALES COMPARTIDOS
  // ==========================================================================
  function renderSqlModal() {
    if (!showSqlModal) return null
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
        <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0f121d] p-5 shadow-2xl flex flex-col max-h-[85vh]">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400">
                <Zap className="size-4" />
              </div>
              <h3 className="text-sm font-semibold text-white">Consola SQL Directa</h3>
            </div>
            <button
              onClick={() => setShowSqlModal(false)}
              className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10"
            >
              <X className="size-4" />
            </button>
          </div>

          <form onSubmit={handleExecuteSql} className="flex flex-col flex-1 mt-4 min-h-0">
            <textarea
              value={sqlScript}
              onChange={(e) => setSqlScript(e.target.value)}
              placeholder="SELECT * FROM public.recipes LIMIT 10;&#10;-- Puedes ejecutar sentencias DDL, DML o transacciones PL/pgSQL (DO $$ ... END $$;)"
              rows={7}
              className="w-full rounded-xl border border-white/10 bg-zinc-950 p-3 font-mono text-xs text-white placeholder:text-zinc-600 outline-none focus:border-amber-400/50 resize-y"
            />

            <div className="flex items-center justify-between mt-3">
              <span className="text-[11px] text-zinc-500">Ejecución directa contra PostgreSQL con RLS</span>
              <button
                type="submit"
                disabled={executingSql || !sqlScript.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-semibold text-xs transition-colors"
              >
                {executingSql ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5 fill-black" />}
                <span>Ejecutar SQL</span>
              </button>
            </div>
          </form>

          {sqlResult && (
            <div className={`mt-3 p-3 rounded-xl border text-xs font-mono max-h-40 overflow-y-auto ${
              sqlResult.ok
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                : 'bg-red-500/10 border-red-500/20 text-red-300'
            }`}>
              {sqlResult.ok ? (
                <div>
                  <div className="flex items-center gap-1.5 font-semibold text-emerald-400 mb-1">
                    <CheckCircle2 className="size-3.5" />
                    <span>Ejecutado con éxito ({sqlResult.durationMs ?? 0}ms)</span>
                  </div>
                  {sqlResult.rows && sqlResult.rows.length > 0 && (
                    <div className="text-[11px] text-zinc-300 mt-1">
                      {sqlResult.rows.length} fila(s) retornada(s):
                      <pre className="mt-1 p-2 rounded bg-black/40 overflow-x-auto text-[10px]">
                        {JSON.stringify(sqlResult.rows.slice(0, 10), null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div className="font-semibold text-red-400 mb-0.5">Error de PostgreSQL:</div>
                  <div>{sqlResult.error}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  function renderAiTableModal() {
    if (!showAiTableModal) return null
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
        <form onSubmit={handleCreateAiTable} className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f121d] p-5 shadow-2xl">
          <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400">
                <Sparkles className="size-4" />
              </div>
              <h3 className="text-sm font-semibold text-white">Crear Tabla con Agente IA</h3>
            </div>
            <button
              type="button"
              onClick={() => setShowAiTableModal(false)}
              className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10"
            >
              <X className="size-4" />
            </button>
          </div>

          <p className="text-xs text-zinc-400 mb-3">
            Describe en lenguaje natural la tabla que necesitas. El Agente generará la migración SQL con columnas, claves foráneas y políticas RLS.
          </p>

          <textarea
            value={aiTablePrompt}
            onChange={(e) => setAiTablePrompt(e.target.value)}
            placeholder="Ej: Tabla de recetas con título, ingredientes (JSONB), tiempo de cocción en minutos, dificultad y relación con el usuario creador..."
            rows={4}
            className="w-full rounded-xl border border-white/10 bg-zinc-950 p-3 text-xs text-white placeholder:text-zinc-600 outline-none focus:border-blue-500 resize-none mb-4"
          />

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAiTableModal(false)}
              className="px-3.5 py-2 rounded-xl border border-white/10 text-xs text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!aiTablePrompt.trim()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-semibold text-white transition-colors"
            >
              <Sparkles className="size-3.5" />
              <span>Generar con IA</span>
            </button>
          </div>
        </form>
      </div>
    )
  }
}
