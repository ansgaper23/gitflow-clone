import { resolveDbConnection } from '../services/dbConnectionResolver.js';
import { runCloudQuery, fetchGlobalTableMetadata, fetchTableColumns, runSql } from '../services/repoDb.js';
import { getOwnedProject } from '../services/projectResolver.js';
import format from 'pg-format';
import { supabase } from '../db/supabaseClient.js';
import { invalidateDbSchemaGraph } from '../services/dbSchemaGraph.js';
import { extractSqlFromPrompt } from '../services/agent.js';

export async function executeProjectSql(req, res) {
  const { id } = req.params;
  const { sql } = req.body || {};
  const startTime = Date.now();

  if (!sql || typeof sql !== 'string' || !sql.trim()) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(400).json({ ok: false, error: "Se requiere un script SQL válido" });
  }

  try {
    const project = await getOwnedProject(req.user.id, id);
    if (!project) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(404).json({ ok: false, error: "Proyecto no encontrado" });
    }

    const conn = await resolveDbConnection(req.user, project.repo_full_name);
    if (!conn) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(400).json({ ok: false, error: "Base de datos no conectada" });
    }

    const cleanSql = extractSqlFromPrompt(sql) || sql.trim();
    const result = await runSql(conn, cleanSql);
    invalidateDbSchemaGraph(id);

    const durationMs = Date.now() - startTime;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({
      ok: true,
      rowCount: result.rowCount ?? (result.rows ? result.rows.length : 0),
      rows: result.rows || [],
      durationMs,
      warning: result.warning
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(400).json({
      ok: false,
      error: err.message || "Error al ejecutar SQL",
      durationMs
    });
  }
}

export async function getCloudOverview(req, res) {
  const { id } = req.params;
  
  try {
    const project = await getOwnedProject(req.user.id, id);
    if (!project) return res.json({ isConnected: false, error: "Project not found" });

    const conn = await resolveDbConnection(req.user, project.repo_full_name);
    if (!conn) return res.json({ isConnected: false, error: "Database unreachable" });

    let tables = [];
    try {
      tables = await fetchGlobalTableMetadata(conn);
    } catch (e) {
      console.error('[Cloud] fetchGlobalTableMetadata error in getCloudOverview:', e);
    }
    const tablesCount = tables.length;
    const topTables = tables.slice(0, 5).map(c => c.table_name || c.name);

    let viewsCount = 0;
    try {
      const viewsRes = await runCloudQuery(conn, "SELECT count(*) as c FROM information_schema.views WHERE table_schema = 'public'");
      viewsCount = parseInt(viewsRes.rows[0].c, 10);
    } catch (e) {}

    let signupsCount = 0;
    try {
      const authRes = await runCloudQuery(conn, "SELECT count(*) as c FROM auth.users");
      signupsCount = parseInt(authRes.rows[0].c, 10);
    } catch (e) {
      try {
        const flowAuthRes = await runCloudQuery(conn, 'SELECT count(*) as c FROM public."_flowpro_users"');
        signupsCount = parseInt(flowAuthRes.rows[0].c, 10);
      } catch (err) {}
    }

    let bucketsCount = 0;
    let buckets = [];
    try {
      const storageRes = await runCloudQuery(conn, "SELECT id FROM storage.buckets");
      buckets = storageRes.rows.map(r => r.id);
      bucketsCount = buckets.length;
    } catch (e) {}

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({
      isConnected: true,
      provider: conn.type,
      tablesCount,
      tables,
      viewsCount,
      topTables,
      signupsCount,
      bucketsCount,
      buckets
    });
  } catch (err) {
    console.error('[Cloud] Error fetching overview:', err);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({ isConnected: false, error: "Database unreachable" });
  }
}

// ---------------------- DATABASE MODULE ----------------------

export async function getTables(req, res) {
  const { id } = req.params;
  try {
    const project = await getOwnedProject(req.user.id, id);
    if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
    const conn = await resolveDbConnection(req.user, project.repo_full_name);
    if (!conn) return res.status(400).json({ ok: false, error: "Database not connected" });

    let tables = await fetchGlobalTableMetadata(conn);
    // Garantía: Cada tabla tiene su arreglo columns poblado y normalizado
    tables = await Promise.all(tables.map(async (t) => {
      let cols = t.columns;
      if (!cols || cols.length === 0) {
        cols = await fetchTableColumns(conn, t.table_name || t.name);
      }
      const normalizedCols = (cols || []).map(c => ({
        name: c.name || c.column_name,
        column_name: c.name || c.column_name,
        type: c.type || c.data_type || 'text',
        data_type: c.type || c.data_type || 'text',
        is_primary: Boolean(c.is_primary || c.is_pk || (c.name || c.column_name) === 'id'),
        is_nullable: c.is_nullable !== false
      }));
      return {
        ...t,
        column_count: normalizedCols.length || t.column_count || 0,
        columns: normalizedCols
      };
    }));

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({ ok: true, tables });
  } catch (error) {
    console.error('Error fetching tables:', error);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ ok: false, error: error.message });
  }
}

export async function getTableRowsData(req, res) {
  const { id, tableName } = req.params;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25));
  const offset = (page - 1) * limit;

  try {
    const project = await getOwnedProject(req.user.id, id);
    if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
    const conn = await resolveDbConnection(req.user, project.repo_full_name);
    if (!conn) return res.status(400).json({ ok: false, error: "Database not connected" });

    const safeTableName = format.ident(tableName);
    const countRes = await runCloudQuery(conn, `SELECT count(*) as c FROM public.${safeTableName}`);
    const totalCount = parseInt(countRes.rows[0].c, 10);
    const totalPages = Math.ceil(totalCount / limit);

    const [dataRes, columns] = await Promise.all([
      runCloudQuery(conn, `SELECT * FROM public.${safeTableName} LIMIT ${limit} OFFSET ${offset}`),
      fetchTableColumns(conn, tableName)
    ]);

    // Fallback Infalible: Si por cualquier motivo information_schema devolvió vacío pero hay registros,
    // inferir automáticamente las columnas desde las claves de la primera fila
    let effectiveColumns = columns;
    if ((!effectiveColumns || effectiveColumns.length === 0) && dataRes.rows && dataRes.rows.length > 0) {
      effectiveColumns = Object.keys(dataRes.rows[0]).map(k => ({
        name: k,
        column_name: k,
        type: typeof dataRes.rows[0][k] === 'number' ? 'integer' : typeof dataRes.rows[0][k] === 'boolean' ? 'boolean' : 'text',
        data_type: typeof dataRes.rows[0][k] === 'number' ? 'integer' : typeof dataRes.rows[0][k] === 'boolean' ? 'boolean' : 'text',
        is_nullable: true,
        is_primary: k === 'id'
      }));
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({
      ok: true,
      page,
      limit,
      totalCount,
      totalPages,
      columns: effectiveColumns || [],
      rows: dataRes.rows || []
    });
  } catch (err) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ ok: false, error: err.message });
  }
}

export async function insertTableRow(req, res) {
  const { id, tableName } = req.params;
  const payload = req.body;
  try {
    const project = await getOwnedProject(req.user.id, id);
    const conn = await resolveDbConnection(req.user, project.repo_full_name);
    
    const keys = Object.keys(payload);
    const values = Object.values(payload);
    
    // Use pg-format
    const sql = format(`INSERT INTO public.%I (%I) VALUES (%L) RETURNING *`, tableName, keys, values);
    const dataRes = await runCloudQuery(conn, sql);
    invalidateDbSchemaGraph(id);
    
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({ ok: true, row: dataRes.rows[0] });
  } catch (err) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ ok: false, error: err.message });
  }
}

export async function updateTableRow(req, res) {
  const { id, tableName, primaryKey } = req.params;
  const { pkColumn, payload } = req.body;
  try {
    const project = await getOwnedProject(req.user.id, id);
    const conn = await resolveDbConnection(req.user, project.repo_full_name);
    
    // Create SET clause
    const sets = Object.entries(payload).map(([k, v]) => format(`%I = %L`, k, v)).join(', ');
    const sql = format(`UPDATE public.%I SET %s WHERE %I = %L RETURNING *`, tableName, sets, pkColumn, primaryKey);
    
    const dataRes = await runCloudQuery(conn, sql);
    invalidateDbSchemaGraph(id);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({ ok: true, row: dataRes.rows[0] });
  } catch (err) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ ok: false, error: err.message });
  }
}

export async function deleteTableRow(req, res) {
  const { id, tableName, primaryKey } = req.params;
  const { pkColumn } = req.query;
  try {
    const project = await getOwnedProject(req.user.id, id);
    const conn = await resolveDbConnection(req.user, project.repo_full_name);
    
    const sql = format(`DELETE FROM public.%I WHERE %I = %L RETURNING *`, tableName, pkColumn, primaryKey);
    const dataRes = await runCloudQuery(conn, sql);
    invalidateDbSchemaGraph(id);
    
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({ ok: true, row: dataRes.rows[0] });
  } catch (err) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ---------------------- USERS MODULE ----------------------

export async function getUsers(req, res) {
  const { id } = req.params;
  try {
    const project = await getOwnedProject(req.user.id, id);
    if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
    const conn = await resolveDbConnection(req.user, project.repo_full_name);
    if (!conn) return res.status(400).json({ ok: false, error: "Database not connected" });
    
    // Ensure columns exist on auth.users if applicable
    await runCloudQuery(conn, `
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'auth' AND tablename = 'users') THEN
          ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb DEFAULT '{"provider": "email"}'::jsonb;
          ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz;
          ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz DEFAULT now();
        END IF;
      END $$;
    `).catch(() => {});

    let sql = `
      SELECT 
        u.id, 
        u.email, 
        u.created_at, 
        COALESCE(u.last_sign_in_at, u.created_at) as last_sign_in_at, 
        COALESCE(u.email_confirmed_at, u.created_at) as email_confirmed_at,
        u.raw_user_meta_data,
        COALESCE(u.raw_app_meta_data->>'provider', 'email') as provider,
        COALESCE(p.full_name, u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)) as full_name,
        COALESCE(p.avatar_url, u.raw_user_meta_data->>'avatar_url') as avatar_url,
        COALESCE(p.role, u.raw_user_meta_data->>'role', 'user') as role
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.id = u.id
      ORDER BY u.created_at DESC;
    `;
    
    let usersRes;
    try {
      usersRes = await runCloudQuery(conn, sql);
    } catch (err) {
      try {
        usersRes = await runCloudQuery(conn, `
          SELECT 
            id, 
            email, 
            created_at, 
            created_at as last_sign_in_at, 
            created_at as email_confirmed_at, 
            '{}'::jsonb as raw_user_meta_data, 
            'email' as provider,
            null as full_name,
            null as avatar_url,
            'user' as role
          FROM _flowpro_users 
          ORDER BY created_at DESC
        `);
      } catch (err2) {
        try {
          usersRes = await runCloudQuery(conn, `SELECT * FROM public.profiles ORDER BY created_at DESC`);
        } catch (err3) {
          usersRes = { rows: [] };
        }
      }
    }
    
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({ ok: true, users: usersRes.rows });
  } catch (error) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ ok: false, error: error.message });
  }
}

export async function deleteUser(req, res) {
  const { id, userId } = req.params;
  try {
    const project = await getOwnedProject(req.user.id, id);
    if (!project) return res.status(404).json({ ok: false, error: "Project not found" });
    const conn = await resolveDbConnection(req.user, project.repo_full_name);
    if (!conn) return res.status(400).json({ ok: false, error: "Database not connected" });
    
    await runCloudQuery(conn, format(`DELETE FROM auth.users WHERE id = %L`, userId)).catch(() => {});
    await runCloudQuery(conn, format(`DELETE FROM _flowpro_users WHERE id = %L`, userId)).catch(() => {});
    await runCloudQuery(conn, format(`DELETE FROM public.profiles WHERE id = %L`, userId)).catch(() => {});
    
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({ ok: true });
  } catch (error) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ ok: false, error: error.message });
  }
}

// ---------------------- STORAGE MODULE ----------------------

export async function getStorageBuckets(req, res) {
  const { id } = req.params;
  try {
    const project = await getOwnedProject(req.user.id, id);
    const conn = await resolveDbConnection(req.user, project.repo_full_name);
    
    const sql = `
      SELECT id, name, public, created_at, file_size_limit, allowed_mime_types
      FROM storage.buckets
      ORDER BY created_at DESC;
    `;
    const dataRes = await runCloudQuery(conn, sql);
    
    // Enhance with file count and total size
    const buckets = [];
    for (const b of dataRes.rows) {
      try {
        const statsSql = format(`SELECT count(*) as file_count, sum(COALESCE(metadata->>'size', '0')::bigint) as total_size FROM storage.objects WHERE bucket_id = %L`, b.id);
        const stats = await runCloudQuery(conn, statsSql);
        buckets.push({ ...b, file_count: parseInt(stats.rows[0].file_count || 0), total_size: parseInt(stats.rows[0].total_size || 0) });
      } catch (err) {
        buckets.push({ ...b, file_count: 0, total_size: 0 });
      }
    }
    
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({ ok: true, buckets });
  } catch (error) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ ok: false, error: error.message });
  }
}

export async function getStorageFiles(req, res) {
  const { id, bucketId } = req.params;
  try {
    const project = await getOwnedProject(req.user.id, id);
    const conn = await resolveDbConnection(req.user, project.repo_full_name);
    
    const sql = format(`
      SELECT id, bucket_id, name, owner, created_at, updated_at, metadata->>'mimetype' as mime_type, metadata->>'size' as size
      FROM storage.objects
      WHERE bucket_id = %L
      ORDER BY created_at DESC;
    `, bucketId);
    
    const dataRes = await runCloudQuery(conn, sql);
    
    // For oauth we'd ideally construct the supabase url, but we don't know the exact project URL here easily unless we fetch it.
    // We will just return the data, the frontend can build the URL if it knows it.
    
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({ ok: true, files: dataRes.rows });
  } catch (error) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ ok: false, error: error.message });
  }
}

export async function createStorageBucket(req, res) {
  const { id } = req.params;
  const { name, isPublic } = req.body;
  try {
    const project = await getOwnedProject(req.user.id, id);
    const conn = await resolveDbConnection(req.user, project.repo_full_name);
    
    const sql = format(`INSERT INTO storage.buckets (id, name, public) VALUES (%L, %L, %L) RETURNING *`, name, name, isPublic);
    const dataRes = await runCloudQuery(conn, sql);
    
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({ ok: true, bucket: dataRes.rows[0] });
  } catch (error) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ ok: false, error: error.message });
  }
}

export async function deleteStorageFile(req, res) {
  const { id, bucketId, fileName } = req.params;
  try {
    const project = await getOwnedProject(req.user.id, id);
    const conn = await resolveDbConnection(req.user, project.repo_full_name);
    
    const sql = format(`DELETE FROM storage.objects WHERE bucket_id = %L AND name = %L RETURNING *`, bucketId, fileName);
    await runCloudQuery(conn, sql);
    
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({ ok: true });
  } catch (error) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(500).json({ ok: false, error: error.message });
  }
}
