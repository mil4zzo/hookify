"use client"

// Liga a pool de mídias do assistente ao backend:
// - arquivos do computador entram na fila e sobem 2 por vez (vídeo grande não trava
//   a fila inteira, e mais que isso só disputaria a mesma banda);
// - importação do Drive é feita pelo servidor; aqui só acompanhamos;
// - vídeo "processing" é finalizado pelo backend a cada consulta (status + capa).
import { useCallback, useEffect, useMemo, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/lib/api/endpoints"
import { useLaunchWizard, type PoolEntry } from "./store"
import { ACCEPTED_TYPES, readDimensions, uploadLocalFile } from "./uploader"
import type { DriveFile } from "./types"

const MAX_PARALLEL_UPLOADS = 2
const POLL_MS = 3000

function errorMessage(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: { message?: string } } } })?.response?.data?.detail
  return detail?.message || (err instanceof Error ? err.message : "Falha no envio")
}

export function useMediaPipeline() {
  const pool = useLaunchWizard((s) => s.pool)
  const accountId = useLaunchWizard((s) => s.accountId)
  const addToPool = useLaunchWizard((s) => s.addToPool)
  const updatePoolEntry = useLaunchWizard((s) => s.updatePoolEntry)
  const applyLibraryMedia = useLaunchWizard((s) => s.applyLibraryMedia)
  const inFlight = useRef(new Map<string, AbortController>())

  // Fila de envio do computador
  useEffect(() => {
    const queued = Object.values(pool).filter((e) => e.status === "queued" && e.file && !inFlight.current.has(e.key))
    const free = MAX_PARALLEL_UPLOADS - inFlight.current.size
    for (const entry of queued.slice(0, Math.max(0, free))) {
      const controller = new AbortController()
      inFlight.current.set(entry.key, controller)
      updatePoolEntry(entry.key, { status: "uploading", error: null })
      uploadLocalFile(
        entry.file!,
        entry.accountId,
        { width: entry.width, height: entry.height, durationMs: entry.durationMs },
        (media) =>
          updatePoolEntry(entry.key, {
            mediaId: media.id,
            status: media.status,
            bytesSent: media.bytes_sent,
            error: media.error_message,
          }),
        controller.signal,
      )
        .catch((err) => {
          if (controller.signal.aborted) return
          updatePoolEntry(entry.key, { status: "error", error: errorMessage(err) })
        })
        .finally(() => {
          inFlight.current.delete(entry.key)
          // nova referência da pool = o efeito roda de novo e puxa o próximo da fila
          useLaunchWizard.setState((s) => ({ pool: { ...s.pool } }))
        })
    }
  }, [pool, updatePoolEntry])

  // Abandonar a tela pausa os envios; voltar retoma do mesmo ponto (a sessão está na Meta).
  useEffect(() => {
    const flights = inFlight.current
    return () => {
      for (const controller of flights.values()) controller.abort()
      flights.clear()
    }
  }, [])

  // Acompanhamento do que o servidor conduz: Drive enviando + vídeo processando
  const watchedIds = useMemo(
    () =>
      Object.values(pool)
        .filter((e) => e.mediaId && (e.status === "processing" || (e.status === "uploading" && e.source === "drive")))
        .map((e) => e.mediaId!)
        .sort(),
    [pool],
  )
  const { data: watched } = useQuery({
    queryKey: ["campaign-launch", "media", watchedIds],
    queryFn: () => api.campaignLaunch.getMedia(watchedIds),
    enabled: watchedIds.length > 0,
    refetchInterval: POLL_MS,
    gcTime: 0,
  })
  useEffect(() => {
    if (watched?.media) applyLibraryMedia(watched.media)
  }, [watched, applyLibraryMedia])

  const addLocalFiles = useCallback(
    async (files: File[]) => {
      if (!accountId) return
      const accepted = files.filter((f) => ACCEPTED_TYPES[f.type])
      const rejected = files.length - accepted.length
      if (rejected) toast.warning(`${rejected} arquivo(s) ignorado(s): use JPG, PNG, MP4 ou MOV.`)
      const entries = await Promise.all(
        accepted.map(async (file): Promise<PoolEntry> => {
          const previewUrl = URL.createObjectURL(file)
          const dims = await readDimensions(file, previewUrl)
          return {
            key: `file:${file.name}:${file.size}:${file.lastModified}`,
            name: file.name,
            mediaType: ACCEPTED_TYPES[file.type],
            source: "upload",
            sizeBytes: file.size,
            width: dims.width,
            height: dims.height,
            durationMs: dims.durationMs,
            group: null,
            previewUrl,
            file,
            accountId,
            mediaId: null,
            status: "queued",
            bytesSent: 0,
            error: null,
          }
        }),
      )
      addToPool(entries)
    },
    [accountId, addToPool],
  )

  const addDriveFiles = useCallback(
    async (files: DriveFile[]) => {
      if (!accountId || !files.length) return
      try {
        const { media } = await api.campaignLaunch.importFromDrive(accountId, files)
        const byIndex = files.map((f, i) => ({ f, m: media[i] }))
        addToPool(
          byIndex.map(({ f, m }) => ({
            key: `drive:${f.id}`,
            name: f.name,
            mediaType: f.media_type,
            source: "drive",
            sizeBytes: f.size_bytes,
            width: f.width,
            height: f.height,
            durationMs: f.duration_ms,
            group: f.group,
            previewUrl: f.thumbnail_url,
            driveFile: f,
            accountId,
            mediaId: m?.id ?? null,
            status: m?.status ?? "error",
            bytesSent: m?.bytes_sent ?? 0,
            error: m?.error_message ?? null,
          })),
        )
      } catch (err) {
        toast.error(errorMessage(err))
      }
    },
    [accountId, addToPool],
  )

  const retryEntry = useCallback(
    async (key: string) => {
      const entry = useLaunchWizard.getState().pool[key]
      if (!entry) return
      if (entry.source === "upload") {
        updatePoolEntry(key, { status: "queued", error: null })
        return
      }
      if (!entry.driveFile) return
      try {
        // Linha com erro é reiniciada no servidor e reimportada; o cartão continua o mesmo.
        const { media } = await api.campaignLaunch.importFromDrive(entry.accountId, [entry.driveFile])
        const m = media[0]
        if (m) updatePoolEntry(key, { mediaId: m.id, status: m.status, bytesSent: m.bytes_sent, error: m.error_message })
      } catch (err) {
        toast.error(errorMessage(err))
      }
    },
    [updatePoolEntry],
  )

  return { addLocalFiles, addDriveFiles, retryEntry }
}
