import React, { useState } from 'react';
import { useAnalytics } from '../../hooks/useCloudData';
import { BarChart2, Globe } from 'lucide-react';

export default function AnalyticsView({ project }) {
  const [range, setRange] = useState('7d');
  const { data: analytics, isLoading } = useAnalytics(project.id, range);

  if (isLoading) return <div className="p-8 text-[#8a8f9d]">Loading metrics...</div>;

  if (!analytics?.isPublished) {
    return (
      <div className="flex flex-col items-center justify-center p-12 border border-[#23252a] rounded-xl bg-[#141519] text-center mt-10">
        <Globe className="w-12 h-12 text-[#3b82f6] mb-4 opacity-80" />
        <h3 className="text-lg font-semibold text-[#f0f2f5] mb-2">Publica tu proyecto para ver métricas</h3>
        <p className="text-sm text-[#8a8f9d] mb-6 max-w-md">
          Necesitas conectar un dominio o publicar la aplicación para comenzar a recolectar visitas, ubicaciones y métricas de uso de usuarios reales.
        </p>
      </div>
    );
  }

  const metrics = [
    { label: 'Visitors', value: analytics.uniqueVisitors || '0' },
    { label: 'Page views', value: analytics.pageViews || '0' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-[#f0f2f5]">Analytics</h2>
        <select value={range} onChange={(e) => setRange(e.target.value)} className="bg-[#1c1d23] text-sm text-[#f0f2f5] border border-[#23252a] rounded-lg p-2 outline-none">
          <option value="24h">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {metrics.map(m => (
          <div key={m.label} className="p-5 rounded-xl border border-[#23252a] bg-[#141519]">
            <h3 className="text-sm text-[#8a8f9d] mb-2">{m.label}</h3>
            <p className="text-2xl font-semibold text-[#f0f2f5]">{m.value}</p>
          </div>
        ))}
      </div>

      {analytics.topPages?.length > 0 && (
        <div className="p-5 rounded-xl border border-[#23252a] bg-[#141519]">
          <h3 className="text-sm font-semibold text-[#f0f2f5] mb-4">Top Pages</h3>
          <div className="space-y-3">
            {analytics.topPages.map(p => (
              <div key={p.path} className="flex justify-between text-sm">
                <span className="text-[#8a8f9d] truncate max-w-[80%]">{p.path}</span>
                <span className="text-[#f0f2f5]">{p.views}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
