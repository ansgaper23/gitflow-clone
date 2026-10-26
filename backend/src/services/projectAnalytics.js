import crypto from 'crypto'
import { supabase } from '../db/supabaseClient.js'

// No guardamos la IP cruda: la hasheamos junto con el user-agent y el día para poder aproximar
// "visitantes únicos" sin quedarnos con un dato personal identificable.
function hashVisitor(ip, userAgent, day) {
  return crypto.createHash('sha256').update(`${ip}|${userAgent}|${day}`).digest('hex').slice(0, 32)
}

export async function recordPageview(projectId, path, ip, userAgent) {
  const day = new Date().toISOString().slice(0, 10)
  const visitorHash = hashVisitor(ip || '', userAgent || '', day)
  const safePath = typeof path === 'string' && path.startsWith('/') ? path.slice(0, 500) : '/'
  const { error } = await supabase
    .from('project_analytics_events')
    .insert({ project_id: projectId, path: safePath, visitor_hash: visitorHash })
  if (error) throw error
}

export async function getAnalyticsSummary(projectId, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('project_analytics_events')
    .select('path, visitor_hash, created_at')
    .eq('project_id', projectId)
    .gte('created_at', since)
  if (error) throw error

  const dayBuckets = new Map()
  const pathCounts = new Map()
  const uniqueTotal = new Set()

  for (const row of data) {
    const day = row.created_at.slice(0, 10)
    if (!dayBuckets.has(day)) dayBuckets.set(day, { pageviews: 0, visitors: new Set() })
    const bucket = dayBuckets.get(day)
    bucket.pageviews += 1
    bucket.visitors.add(row.visitor_hash)
    uniqueTotal.add(row.visitor_hash)
    pathCounts.set(row.path, (pathCounts.get(row.path) || 0) + 1)
  }

  const daily = [...dayBuckets.entries()]
    .map(([date, b]) => ({ date, pageviews: b.pageviews, uniqueVisitors: b.visitors.size }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const topPaths = [...pathCounts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  return {
    totalPageviews: data.length,
    totalUniqueVisitors: uniqueTotal.size,
    daily,
    topPaths,
  }
}
