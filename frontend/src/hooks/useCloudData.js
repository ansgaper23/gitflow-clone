import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

function authFetch(url, options = {}) {
  const token = localStorage.getItem('gitflow_token');
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    }
  });
}

export function useCloudOverview(projectId) {
  return useQuery({
    queryKey: ['cloud-overview', projectId],
    queryFn: async () => {
      const res = await authFetch(`/api/projects/${projectId}/cloud/overview`);
      if (!res.ok) throw new Error('Error al cargar cloud overview');
      return res.json();
    },
    refetchInterval: 10000
  });
}

export function useCloudTables(projectId) {
  return useQuery({
    queryKey: ['cloud-tables', projectId],
    queryFn: async () => {
      const res = await authFetch(`/api/projects/${projectId}/cloud/database/tables`);
      if (!res.ok) throw new Error('Error fetching tables');
      return res.json();
    }
  });
}

export function useCloudTableRows(projectId, tableName, page = 1, limit = 25) {
  return useQuery({
    queryKey: ['cloud-table-rows', projectId, tableName, page, limit],
    queryFn: async () => {
      if (!tableName) return null;
      const res = await authFetch(`/api/projects/${projectId}/cloud/database/tables/${tableName}/rows?page=${page}&limit=${limit}`);
      if (!res.ok) throw new Error('Error fetching rows');
      return res.json();
    },
    enabled: !!tableName,
    keepPreviousData: true
  });
}

export function useCloudUsers(projectId) {
  return useQuery({
    queryKey: ['cloud-users', projectId],
    queryFn: async () => {
      const res = await authFetch(`/api/projects/${projectId}/cloud/users`);
      if (!res.ok) throw new Error('Error fetching users');
      return res.json();
    },
    refetchInterval: 3000
  });
}

export function useDeleteCloudUser(projectId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId) => {
      const res = await authFetch(`/api/projects/${projectId}/cloud/users/${userId}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Error al eliminar usuario');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cloud-users', projectId] });
    }
  });
}

export function useCloudBuckets(projectId) {
  return useQuery({
    queryKey: ['cloud-buckets', projectId],
    queryFn: async () => {
      const res = await authFetch(`/api/projects/${projectId}/cloud/storage/buckets`);
      if (!res.ok) throw new Error('Error fetching buckets');
      return res.json();
    }
  });
}

export function useCloudFiles(projectId, bucketId) {
  return useQuery({
    queryKey: ['cloud-files', projectId, bucketId],
    queryFn: async () => {
      if (!bucketId) return null;
      const res = await authFetch(`/api/projects/${projectId}/cloud/storage/buckets/${bucketId}/files`);
      if (!res.ok) throw new Error('Error fetching files');
      return res.json();
    },
    enabled: !!bucketId
  });
}

export function useSeoStatus(projectId) {
  const queryClient = useQueryClient();

  const auditQuery = useQuery({
    queryKey: ['seo-status', projectId],
    queryFn: async () => {
      const res = await authFetch(`/api/projects/${projectId}/seo/status`);
      if (!res.ok) throw new Error('Error al ejecutar auditoría SEO');
      return res.json();
    }
  });
  
  const [isFixing, setIsFixing] = useState(false);

  const fixSeo = async () => {
    setIsFixing(true);
    // Usually this would be a mutation to a backend endpoint, but since it just triggers a prompt, we just toggle state for a moment
    setTimeout(() => setIsFixing(false), 3000);
  };

  return { ...auditQuery, fixSeo, isFixing };
}


export function useAnalytics(projectId, range = '7d') {
  return useQuery({
    queryKey: ['analytics', projectId, range],
    queryFn: async () => {
      const res = await authFetch(`/api/projects/${projectId}/analytics?range=${range}`);
      if (!res.ok) throw new Error('Error al cargar analíticas');
      return res.json();
    }
  });
}

export function useSettings(projectId) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['settings', projectId],
    queryFn: async () => {
      const res = await authFetch(`/api/projects/${projectId}/settings`);
      if (!res.ok) throw new Error('Error al cargar configuraciones');
      return res.json();
    }
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data) => {
      const res = await authFetch(`/api/projects/${projectId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Error updating settings');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries(['settings', projectId])
  });

  const addSecretMutation = useMutation({
    mutationFn: async ({ key, value }) => {
      // Supongamos que la ruta es POST /api/projects/:id/secrets
      const res = await authFetch(`/api/projects/${projectId}/secrets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value })
      });
      if (!res.ok) throw new Error('Error adding secret');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries(['settings', projectId])
  });

  return {
    ...query,
    updateSettings: updateSettingsMutation.mutate,
    addSecret: addSecretMutation.mutate
  };
}
