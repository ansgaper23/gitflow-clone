import { getOwnedProject } from '../services/projectResolver.js';
import { getAnalyticsSummary } from '../services/projectAnalytics.js';

export async function getAnalyticsMetrics(req, res) {
  const { id } = req.params;
  const range = req.query.range || '7d';
  const days = range === '30d' ? 30 : range === '24h' ? 1 : 7;

  try {
    const project = await getOwnedProject(req.user.id, id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // isPublished is usually determined if it has a custom domain or active Vercel/VPS domain
    const isPublished = Boolean(project.custom_domain || project.published);

    let summary;
    try {
      summary = await getAnalyticsSummary(project.repo_full_name, days);
    } catch (e) {
      // Return 0 if analytics not set up or no data
      summary = { totals: { views: 0, visitors: 0 }, topPages: [], timeline: [] };
    }

    const views = summary.totals?.views || 0;
    const visitors = summary.totals?.visitors || 0;

    if (!isPublished || views === 0) {
      return res.json({
        isPublished: false,
        pageViews: 0,
        uniqueVisitors: 0,
        topPages: [],
        chartData: []
      });
    }

    return res.json({
      isPublished: true,
      pageViews: views,
      uniqueVisitors: visitors,
      topPages: (summary.topPages || []).map(p => ({ path: p.path, views: p.count })),
      chartData: (summary.timeline || []).map(t => ({ date: t.date, views: t.count }))
    });
  } catch (err) {
    console.error('Analytics fetch error:', err);
    return res.status(500).json({ error: 'Error calculando anal?ticas.' });
  }
}
