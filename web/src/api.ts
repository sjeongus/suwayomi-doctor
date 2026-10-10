import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CheckHistoryEntry,
  MihonCheckResult,
  ScanProgress,
  SeriesView,
  ServerEvent,
  Settings,
  SourceView,
  Summary,
} from '../../server/shared/api-types';

export type * from '../../server/shared/api-types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const useSummary = () => useQuery({ queryKey: ['summary'], queryFn: () => request<Summary>('/api/summary') });
export const useSeries = () => useQuery({ queryKey: ['series'], queryFn: () => request<SeriesView[]>('/api/series') });
export const useSources = () => useQuery({ queryKey: ['sources'], queryFn: () => request<SourceView[]>('/api/sources') });
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => request<Settings>('/api/settings') });
export const useHistory = (mangaId: number | null) =>
  useQuery({
    queryKey: ['history', mangaId],
    queryFn: () => request<CheckHistoryEntry[]>(`/api/series/${mangaId}/history`),
    enabled: mangaId !== null,
  });

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function useStartScan() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: () => request('/api/scan', { method: 'POST' }), onSettled: invalidate });
}

export function useSyncNow() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: () => request<{ series: number; resolved: number }>('/api/sync/now', { method: 'POST' }),
    onSettled: invalidate,
  });
}

export function useCancelScan() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: () => request('/api/scan', { method: 'DELETE' }), onSettled: invalidate });
}

export function useRecheck() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (mangaId: number) => request<SeriesView>(`/api/series/${mangaId}/recheck`, { method: 'POST' }),
    onSettled: invalidate,
  });
}

export function useScanlatorLookup() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (mangaId: number) => request<SeriesView>(`/api/series/${mangaId}/scanlators`, { method: 'POST' }),
    onSettled: invalidate,
  });
}

export function useIgnore() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: ({ mangaId, days }: { mangaId: number; days: number | null }) =>
      request<SeriesView>(`/api/series/${mangaId}/ignore`, { method: 'POST', body: JSON.stringify({ days }) }),
    onSettled: invalidate,
  });
}

export function useRemove() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (mangaId: number) => request<SeriesView>(`/api/series/${mangaId}/remove`, { method: 'POST' }),
    onSettled: invalidate,
  });
}

export function useSaveSettings() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
    onSettled: invalidate,
  });
}

/** Subscribes to server-sent events and keeps the query cache fresh. Returns live scan progress. */
export function useLiveUpdates(): void {
  const qc = useQueryClient();
  useEffect(() => {
    void fetch('/api/sync', { method: 'POST' });
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refreshSoon = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void qc.invalidateQueries({ queryKey: ['series'] });
        void qc.invalidateQueries({ queryKey: ['sources'] });
        void qc.invalidateQueries({ queryKey: ['history'] });
        void qc.invalidateQueries({ queryKey: ['summary'] });
      }, 600);
    };
    const es = new EventSource('/api/events');
    es.onmessage = (msg) => {
      const event = JSON.parse(msg.data as string) as ServerEvent;
      if (event.type === 'progress') {
        qc.setQueryData<Summary>(['summary'], (old) => (old ? { ...old, progress: event.progress } : old));
        if (!event.progress.running) refreshSoon();
      } else {
        refreshSoon();
      }
    };
    return () => {
      es.close();
      if (timer) clearTimeout(timer);
    };
  }, [qc]);
}

export type { ScanProgress };

/** Sends a Mihon backup to be checked. The server reads it in memory and keeps nothing. */
export async function checkMihonBackup(file: Blob, sourceId?: string, anilist = true): Promise<MihonCheckResult> {
  const qs = new URLSearchParams();
  if (sourceId) qs.set('source', sourceId);
  if (!anilist) qs.set('anilist', '0');
  return request<MihonCheckResult>(`/api/mihon/check${qs.size ? `?${qs}` : ''}`, {
    method: 'POST',
    body: file,
    headers: { 'content-type': 'application/octet-stream' },
  });
}
