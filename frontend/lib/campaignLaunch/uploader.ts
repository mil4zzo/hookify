// Envio de mídia do computador para a biblioteca da conta na Meta ("mídia primeiro").
//
// Imagem: 1 envio. Vídeo: a Meta dita o tamanho de cada pedaço (start_offset/end_offset)
// e o backend repassa pedaço a pedaço, sem gravar em disco. Queda de conexão retoma do
// último pedaço aceito — a sessão de upload vive na Meta, não no navegador.
import { api } from "@/lib/api/endpoints"
import type { LibraryMedia } from "./types"

export const ACCEPTED_TYPES: Record<string, "image" | "video"> = {
  "image/jpeg": "image",
  "image/png": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
}

export function fileFingerprint(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`
}

export interface MediaDimensions {
  width: number | null
  height: number | null
  durationMs: number | null
}

/** Lê largura/altura (e duração) do arquivo local — base do encaixe por proporção. */
export async function readDimensions(file: File, previewUrl: string): Promise<MediaDimensions> {
  const kind = ACCEPTED_TYPES[file.type]
  try {
    if (kind === "image") {
      const bitmap = await createImageBitmap(file)
      const dims = { width: bitmap.width, height: bitmap.height, durationMs: null }
      bitmap.close()
      return dims
    }
    if (kind === "video") {
      return await new Promise<MediaDimensions>((resolve) => {
        const video = document.createElement("video")
        video.preload = "metadata"
        video.muted = true
        const done = (dims: MediaDimensions) => {
          video.removeAttribute("src")
          video.load()
          resolve(dims)
        }
        video.onloadedmetadata = () =>
          done({
            width: video.videoWidth || null,
            height: video.videoHeight || null,
            durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : null,
          })
        video.onerror = () => done({ width: null, height: null, durationMs: null })
        video.src = previewUrl
      })
    }
  } catch {
    // dimensão é dica para o agrupamento; sem ela o encaixe cai na ordem de chegada
  }
  return { width: null, height: null, durationMs: null }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function uploadLocalFile(
  file: File,
  accountId: string,
  dims: MediaDimensions,
  onProgress: (media: LibraryMedia) => void,
  signal?: AbortSignal,
): Promise<LibraryMedia> {
  const kind = ACCEPTED_TYPES[file.type]
  const fingerprint = fileFingerprint(file)
  if (kind === "image") {
    const media = await api.campaignLaunch.uploadImage(
      file,
      { account_id: accountId, fingerprint, width: dims.width, height: dims.height },
      signal,
    )
    onProgress(media)
    return media
  }

  let media = await api.campaignLaunch.startVideo({
    account_id: accountId,
    fingerprint,
    file_name: file.name,
    content_type: file.type,
    size_bytes: file.size,
    width: dims.width,
    height: dims.height,
    duration_ms: dims.durationMs,
  })
  onProgress(media)

  let stalls = 0
  while (media.status === "uploading") {
    if (signal?.aborted) throw new DOMException("Envio cancelado", "AbortError")
    const start = media.start_offset ?? 0
    const end = media.end_offset ?? 0
    if (end <= start) break
    const before = media.bytes_sent
    try {
      media = await api.campaignLaunch.sendVideoChunk(media.id, start, file.slice(start, end), signal)
    } catch (err) {
      if (signal?.aborted) throw err
      // Rede caiu: espera e re-sincroniza o offset com o servidor (a Meta guarda a sessão).
      stalls += 1
      if (stalls > 6) throw err
      await sleep(Math.min(1000 * 2 ** stalls, 15000))
      const fresh = await api.campaignLaunch.getMedia([media.id])
      media = fresh.media[0] ?? media
      continue
    }
    stalls = media.bytes_sent > before || media.status !== "uploading" ? 0 : stalls + 1
    if (stalls > 6) throw new Error("O envio do vídeo parou de avançar.")
    onProgress(media)
  }
  onProgress(media)
  return media
}
