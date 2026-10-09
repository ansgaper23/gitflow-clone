import { resolveDbConnection } from '../services/dbConnectionResolver.js';
import { runCloudQuery } from '../services/repoDb.js';
import { getOwnedProject } from '../services/projectResolver.js';
import format from 'pg-format';
import { supabase } from '../db/supabaseClient.js';

export async function getCloudOverview(req, res) {
  const { id } = req.params;
  
  try {
    const project = await getOwnedProject(req.user.id, id);
    if (!project) return res.json({ isConnected: false, error: "Project not found" });

    const conn = await resolveDbConnection(req.user, project.repo_full_name);
    if (!conn) return res.json({ isConnected: false, error: "Database unreachable" });

    let tables = [];
    try {
      const detailedRes = await runCloudQuery(conn, `
        SELECT 
          c.relname AS table_name,
          n.nspname AS table_schema,
          c.rowsecurity AS rls_enabled,
          COALESCE(c.reltuples::bigint, 0) AS approximate_row_count,
          (
            SELECT count(*) 
            FROM information_schema.columns 
            WHERE table_schema = n.nspname AND table_name = c.relname
          ) AS columns_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' 
          AND c.relkind = 'r'
          AND c.relname != '_flowpro_users'
        ORDER BY c.relname ASC;
      `);
      tables = detailedRes.rows.map(r => ({
        table_name: r.table_name,
        rls_enabled: r.rls_enabled,
        approximate_row_count: parseInt(r.approximate_row_count || 0, 10),
        columns_count: parseInt(r.columns_count || 0, 10)
      }));
    } catch (e) {
      console.error('Detailed query error:', e);
    }
    const tablesCount = tables.length;
    const topTables = tables.slice(0, 5).map(c => c.table_name);

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

    const query = `
      SELECT 
        t.table_name,
        COALESCE(c.reltuples::bigint, 0) AS estimated_rows,
        COALESCE(pt.rowsecurity, false) AS rls_enabled,
        (
          SELECT json_agg(json_build_object(
            'column_name', col.column_name,
            'data_type', col.data_type,
            'is_nullable', col.is_nullable = 'YES',
            'is_primary', EXISTS (
              SELECT 1 FROM information_schema.key_column_usage kcu
              JOIN information_schema.table_constraints tc ON kcu.constraint_name = tc.constraint_name
              WHERE tc.constraint_type = 'PRIMARY KEY' 
                AND kcu.table_schema = 'public' 
                AND kcu.table_name = t.table_name 
                AND kcu.column_name = col.column_name
            )
          ))
          FROM information_schema.columns col
          WHERE col.table_schema = 'public' AND col.table_name = t.table_name
        ) AS columns
      FROM information_schema.tables t
      LEFT JOIN pg_class c ON c.relname = t.table_name
      LEFT JOIN pg_tables pt ON pt.tablename = t.table_name AND pt.schemaname = 'public'
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE' AND t.table_name != '_flowpro_users'
      ORDER BY t.table_name ASC;
    `;
    const result = await runCloudQuery(conn, query);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({ ok: true, tables: result.rows });
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

    const dataRes = await runCloudQuery(conn, `SELECT * FROM public.${safeTableName} LIMIT ${limit} OFFSET ${offset}`);

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.json({
      ok: true,
      page,
      limit,
      totalCount,
      totalPages,
      rows: dataRes.rows
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
    const conn = await resolveDbConnection(req.user, project.repo_full_name);
    
    // Check if auth.users exists
    let sql = `
      SELECT 
        id, 
        email, 
        created_at, 
        last_sign_in_at, 
        email_confirmed_at,
        raw_user_meta_data,
        raw_app_meta_data->>'provider' as provider
      FROM auth.users
      ORDER BY created_at DESC;
    `;
    
    let usersRes;
    try {
      usersRes = await runCloudQuery(conn, sql);
    } catch (err) {
      // Fallback
      try {
         usersRes = await runCloudQuery(conn, `SELECT * FROM public.profiles ORDER BY created_at DESC`);
      } catch (err2) {
         try {
           usersRes = await runCloudQuery(conn, `SELECT * FROM public.users ORDER BY created_at DESC`);
         } catch (err3) {
           // Return empty array instead of throwing to avoid 500 on empty schema
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
    const conn = await resolveDbConnection(req.user, project.repo_full_name);
    
    const sql = format(`DELETE FROM auth.users WHERE id = %L RETURNING *`, userId);
    await runCloudQuery(conn, sql);
    
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
