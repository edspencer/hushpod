import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query'

/* ------------------------------------------------------------------ */
/* Entity types                                                        */
/* ------------------------------------------------------------------ */

export type EpisodeStatus =
  | 'pending'
  | 'downloading'
  | 'transcribing'
  | 'detecting'
  | 'cutting'
  | 'done'
  | 'error'

export type AdLabel = 'ad' | 'promo' | 'intro' | 'outro'

export interface Show {
  id: number
  title: string
  slug: string
  feedUrl: string
  description: string | null
  imageUrl: string | null
  isActive: boolean
  episodeLimit: number
  removeAds: boolean
  removePromos: boolean
  detectionGuidance: string | null
  lastCheckedAt: string | null
  episodeCount: number
}

export type ShowSettingsPatch = Partial<
  Pick<Show, 'isActive' | 'episodeLimit' | 'removeAds' | 'removePromos' | 'detectionGuidance'>
>

export interface Episode {
  id: number
  showId: number
  guid: string
  title: string
  description: string | null
  publishedAt: string | null
  sourceUrl: string
  duration: number | null
  originalPath: string | null
  cleanPath: string | null
  originalSize: number | null
  cleanSize: number | null
  status: EpisodeStatus
  errorMessage: string | null
  retryCount: number
  createdAt: string
  updatedAt: string
}

export interface Ad {
  id: number
  episodeId: number
  showId: number
  startTime: number
  endTime: number
  label: AdLabel
  company: string | null
  adText: string | null
  reason: string | null
  createdAt: string
  updatedAt: string
}

export interface TranscriptSegment {
  id: number
  start: number
  end: number
  text: string
}

export interface Transcript {
  language?: string
  durationSec?: number
  segments: TranscriptSegment[]
}

export interface AppSettings {
  whisperMode: 'local' | 'remote'
  whisperModel: string
  whisperEndpoint: string
  whisperApiKey: string
  llmProvider: 'openai-compatible' | 'openai' | 'anthropic' | 'ollama'
  llmBaseUrl: string
  llmApiKey: string
  llmModel: string
  checkIntervalMinutes: number
  concurrency: number
  crossfadeMs: number
  baseUrl: string
  enableTransitionDetection: boolean
  transitionWindowSeconds: number
  transitionEnergyThreshold: number
}

/* Composite / response shapes ------------------------------------- */

export interface ShowWithEpisodes extends Show {
  episodes: Episode[]
}

export interface EpisodeDetail extends Episode {
  showSlug: string | null
  showTitle: string | null
  hasTranscript: boolean
  audioCleanUrl: string | null
  audioOriginalUrl: string | null
  ads: Ad[]
}

export interface AddShowResponse {
  show: Show
  discovered: number
}

export interface AdsStats {
  totalAds: number
  totalSeconds: number
  byCompany: { company: string | null; count: number; seconds: number }[]
  byLabel: { label: string; count: number }[]
}

export interface SystemStatus {
  queue: { queued: number[]; active: number[] }
  episodes: Record<string, number>
}

export interface ProcessResponse {
  ok: true
  queued: number
}

/* ------------------------------------------------------------------ */
/* Low-level fetch client                                             */
/* ------------------------------------------------------------------ */

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, headers, ...rest } = init ?? {}
  const res = await fetch(path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`
    try {
      const data = (await res.json()) as { error?: string }
      if (data && typeof data.error === 'string') message = data.error
    } catch {
      /* non-json error body */
    }
    throw new ApiError(message, res.status)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

/* ------------------------------------------------------------------ */
/* Endpoint functions                                                 */
/* ------------------------------------------------------------------ */

export const api = {
  listShows: (): Promise<Show[]> => request<Show[]>('/api/shows'),

  addShow: (feedUrl: string): Promise<AddShowResponse> =>
    request<AddShowResponse>('/api/shows', {
      method: 'POST',
      json: { feedUrl },
    }),

  getShow: (id: number): Promise<ShowWithEpisodes> => request<ShowWithEpisodes>(`/api/shows/${id}`),

  updateShow: (id: number, patch: ShowSettingsPatch): Promise<Show> =>
    request<Show>(`/api/shows/${id}`, { method: 'PATCH', json: patch }),

  checkShow: (id: number): Promise<{ discovered: number }> =>
    request<{ discovered: number }>(`/api/shows/${id}/check`, {
      method: 'POST',
    }),

  deleteShow: (id: number, deleteFiles = false): Promise<{ ok: true }> =>
    request<{ ok: true }>(`/api/shows/${id}${deleteFiles ? '?deleteFiles=true' : ''}`, {
      method: 'DELETE',
    }),

  listShowEpisodes: (showId: number): Promise<Episode[]> =>
    request<Episode[]>(`/api/shows/${showId}/episodes`),

  getEpisode: (id: number): Promise<EpisodeDetail> => request<EpisodeDetail>(`/api/episodes/${id}`),

  getEpisodeTranscript: (id: number): Promise<Transcript> =>
    request<Transcript>(`/api/episodes/${id}/transcript`),

  processEpisode: (id: number): Promise<ProcessResponse> =>
    request<ProcessResponse>(`/api/episodes/${id}/process`, {
      method: 'POST',
    }),

  reprocessEpisode: (id: number): Promise<ProcessResponse> =>
    request<ProcessResponse>(`/api/episodes/${id}/reprocess`, {
      method: 'POST',
    }),

  listEpisodeAds: (episodeId: number): Promise<Ad[]> =>
    request<Ad[]>(`/api/episodes/${episodeId}/ads`),

  listShowAds: (showId: number): Promise<Ad[]> => request<Ad[]>(`/api/shows/${showId}/ads`),

  getAdsStats: (): Promise<AdsStats> => request<AdsStats>('/api/ads/stats'),

  getSettings: (): Promise<AppSettings> => request<AppSettings>('/api/settings'),

  updateSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    request<AppSettings>('/api/settings', { method: 'PATCH', json: patch }),

  getStatus: (): Promise<SystemStatus> => request<SystemStatus>('/api/status'),
}

/* ------------------------------------------------------------------ */
/* Query keys                                                          */
/* ------------------------------------------------------------------ */

export const queryKeys = {
  shows: ['shows'] as const,
  show: (id: number) => ['shows', id] as const,
  showEpisodes: (showId: number) => ['shows', showId, 'episodes'] as const,
  showAds: (showId: number) => ['shows', showId, 'ads'] as const,
  episode: (id: number) => ['episodes', id] as const,
  episodeTranscript: (id: number) => ['episodes', id, 'transcript'] as const,
  episodeAds: (episodeId: number) => ['episodes', episodeId, 'ads'] as const,
  adsStats: ['ads', 'stats'] as const,
  settings: ['settings'] as const,
  status: ['status'] as const,
}

/* ------------------------------------------------------------------ */
/* React Query hooks                                                  */
/* ------------------------------------------------------------------ */

export function useShows(): UseQueryResult<Show[], Error> {
  return useQuery({ queryKey: queryKeys.shows, queryFn: api.listShows })
}

export function useShow(id: number | undefined): UseQueryResult<ShowWithEpisodes, Error> {
  return useQuery({
    queryKey: queryKeys.show(id ?? -1),
    queryFn: () => api.getShow(id as number),
    enabled: id != null,
  })
}

export function useShowEpisodes(showId: number | undefined): UseQueryResult<Episode[], Error> {
  return useQuery({
    queryKey: queryKeys.showEpisodes(showId ?? -1),
    queryFn: () => api.listShowEpisodes(showId as number),
    enabled: showId != null,
  })
}

export function useEpisode(id: number | undefined): UseQueryResult<EpisodeDetail, Error> {
  return useQuery({
    queryKey: queryKeys.episode(id ?? -1),
    queryFn: () => api.getEpisode(id as number),
    enabled: id != null,
  })
}

export function useEpisodeTranscript(
  id: number | undefined,
  enabled = true,
): UseQueryResult<Transcript, Error> {
  return useQuery({
    queryKey: queryKeys.episodeTranscript(id ?? -1),
    queryFn: () => api.getEpisodeTranscript(id as number),
    enabled: id != null && enabled,
    staleTime: 5 * 60 * 1000,
  })
}

export function useEpisodeAds(episodeId: number | undefined): UseQueryResult<Ad[], Error> {
  return useQuery({
    queryKey: queryKeys.episodeAds(episodeId ?? -1),
    queryFn: () => api.listEpisodeAds(episodeId as number),
    enabled: episodeId != null,
  })
}

export function useShowAds(showId: number | undefined): UseQueryResult<Ad[], Error> {
  return useQuery({
    queryKey: queryKeys.showAds(showId ?? -1),
    queryFn: () => api.listShowAds(showId as number),
    enabled: showId != null,
  })
}

export function useAdsStats(): UseQueryResult<AdsStats, Error> {
  return useQuery({ queryKey: queryKeys.adsStats, queryFn: api.getAdsStats })
}

export function useSettings(): UseQueryResult<AppSettings, Error> {
  return useQuery({ queryKey: queryKeys.settings, queryFn: api.getSettings })
}

export function useStatus(refetchInterval?: number): UseQueryResult<SystemStatus, Error> {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: api.getStatus,
    refetchInterval,
  })
}

/* Mutations ------------------------------------------------------- */

export function useAddShow(): UseMutationResult<AddShowResponse, Error, string> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (feedUrl: string) => api.addShow(feedUrl),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.shows })
    },
  })
}

export function useUpdateShow(): UseMutationResult<
  Show,
  Error,
  { id: number; patch: ShowSettingsPatch }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }) => api.updateShow(id, patch),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.shows })
      void qc.invalidateQueries({ queryKey: queryKeys.show(id) })
    },
  })
}

export function useCheckShow(): UseMutationResult<{ discovered: number }, Error, number> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.checkShow(id),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: queryKeys.show(id) })
      void qc.invalidateQueries({ queryKey: queryKeys.shows })
    },
  })
}

export function useDeleteShow(): UseMutationResult<
  { ok: true },
  Error,
  { id: number; deleteFiles?: boolean }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, deleteFiles }) => api.deleteShow(id, deleteFiles),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.shows })
    },
  })
}

export function useProcessEpisode(): UseMutationResult<ProcessResponse, Error, number> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.processEpisode(id),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: queryKeys.episode(id) })
      void qc.invalidateQueries({ queryKey: queryKeys.status })
    },
  })
}

export function useReprocessEpisode(): UseMutationResult<ProcessResponse, Error, number> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.reprocessEpisode(id),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: queryKeys.episode(id) })
      void qc.invalidateQueries({ queryKey: queryKeys.status })
    },
  })
}

export function useUpdateSettings(): UseMutationResult<AppSettings, Error, Partial<AppSettings>> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<AppSettings>) => api.updateSettings(patch),
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.settings, data)
    },
  })
}
