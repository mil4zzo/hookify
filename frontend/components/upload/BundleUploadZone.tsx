"use client"

import { useRef } from "react"
import { IconPhoto, IconPlus, IconTrash, IconUpload, IconVideo, IconX } from "@tabler/icons-react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { AdCreativeDetailResponse } from "@/lib/api/schemas"

export interface BundlePoolFile {
  id: string
  file: File
  mediaType: "image" | "video"
}

export interface BundleDraft {
  id: string
  name: string
  slotFiles: Record<string, string | null>
}

interface BundleUploadZoneProps {
  mediaSlots: AdCreativeDetailResponse["media_slots"]
  mode: "visual" | "filename"
  onModeChange: (mode: "visual" | "filename") => void
  filePool: BundlePoolFile[]
  bundles: BundleDraft[]
  parseErrors: string[]
  onFilePoolChange: (files: BundlePoolFile[]) => void
  onBundlesChange: (bundles: BundleDraft[]) => void
}

function formatFileSize(file: File) {
  return `${(file.size / (1024 * 1024)).toFixed(2)} MB`
}

export default function BundleUploadZone({
  mediaSlots,
  mode,
  onModeChange,
  filePool,
  bundles,
  parseErrors,
  onFilePoolChange,
  onBundlesChange,
}: BundleUploadZoneProps) {
  const bulkInputRef = useRef<HTMLInputElement | null>(null)

  function createEmptyBundle(index = bundles.length + 1): BundleDraft {
    return {
      id: `bundle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: `Bundle ${index}`,
      slotFiles: Object.fromEntries(mediaSlots.map((slot) => [slot.slot_key, null])),
    }
  }

  function appendPoolFiles(nextFiles: FileList | null) {
    if (!nextFiles) return
    const accepted = Array.from(nextFiles)
      .filter((file) => ["image/jpeg", "image/png", "video/mp4", "video/quicktime"].includes(file.type))
      .map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${file.name}`,
        file,
        mediaType: file.type.startsWith("video/") ? "video" as const : "image" as const,
      }))
    onFilePoolChange([...filePool, ...accepted])
  }

  function removePoolFile(fileId: string) {
    onFilePoolChange(filePool.filter((entry) => entry.id !== fileId))
    onBundlesChange(
      bundles.map((bundle) => ({
        ...bundle,
        slotFiles: Object.fromEntries(
          Object.entries(bundle.slotFiles).map(([slotKey, currentFileId]) => [
            slotKey,
            currentFileId === fileId ? null : currentFileId,
          ]),
        ),
      })),
    )
  }

  function addBundle() {
    onBundlesChange([...bundles, createEmptyBundle()])
  }

  function updateBundle(bundleId: string, patch: Partial<BundleDraft>) {
    onBundlesChange(bundles.map((bundle) => (bundle.id === bundleId ? { ...bundle, ...patch } : bundle)))
  }

  function removeBundle(bundleId: string) {
    onBundlesChange(bundles.filter((bundle) => bundle.id !== bundleId))
  }

  function assignFileToSlot(bundleId: string, slotKey: string, fileId: string | null) {
    onBundlesChange(
      bundles.map((bundle) =>
        bundle.id === bundleId
          ? {
              ...bundle,
              slotFiles: {
                ...bundle.slotFiles,
                [slotKey]: fileId,
              },
            }
          : bundle,
      ),
    )
  }

  function handleVisualSlotFile(bundleId: string, slotKey: string, nextFile: File | null) {
    if (!nextFile) return
    const mediaType = nextFile.type.startsWith("video/") ? "video" : "image"
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${nextFile.name}`,
      file: nextFile,
      mediaType: mediaType as "image" | "video",
    }
    onFilePoolChange([...filePool, entry])
    assignFileToSlot(bundleId, slotKey, entry.id)
  }

  const filenamePattern = "{bundle_name}__{slot_key}.{ext}"

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Bundles de mídia</div>
            <div className="text-xs text-muted-foreground">
              Monte um anúncio por bundle preenchendo todos os slots exigidos pelo template.
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant={mode === "visual" ? "default" : "outline"} onClick={() => onModeChange("visual")}>
              Mapeamento visual
            </Button>
            <Button type="button" variant={mode === "filename" ? "default" : "outline"} onClick={() => onModeChange("filename")}>
              Nomenclatura
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {mediaSlots.map((slot) => (
            <Badge key={slot.slot_key} variant="outline">
              {slot.display_name} • {slot.slot_key}
            </Badge>
          ))}
        </div>
      </Card>

      {mode === "filename" ? (
        <Card
          className="flex min-h-44 cursor-pointer flex-col items-center justify-center gap-3 border-dashed p-6 text-center"
          onClick={() => bulkInputRef.current?.click()}
        >
          <div className="rounded-full bg-primary-10 p-4 text-primary">
            <IconUpload className="h-8 w-8" />
          </div>
          <div>
            <div className="font-medium">Importe os arquivos e agrupe por nome</div>
            <div className="text-sm text-muted-foreground">
              Padrao aceito: <span className="font-mono">{filenamePattern}</span>
            </div>
          </div>
          <Button type="button" variant="outline">Selecionar arquivos</Button>
          <input
            ref={bulkInputRef}
            type="file"
            className="hidden"
            multiple
            accept=".jpg,.jpeg,.png,.mp4,.mov"
            onChange={(event) => appendPoolFiles(event.target.files)}
          />
        </Card>
      ) : null}

      {mode === "visual" ? (
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">{bundles.length} bundle(s) criado(s)</div>
          <Button type="button" variant="outline" onClick={addBundle}>
            <IconPlus className="mr-2 h-4 w-4" />
            Adicionar bundle
          </Button>
        </div>
      ) : null}

      {parseErrors.length > 0 ? (
        <Card className="space-y-2 border-destructive-20 bg-destructive-5 p-4 text-sm text-destructive">
          <div className="font-medium">Arquivos com nomenclatura invalida</div>
          <ul className="space-y-1">
            {parseErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      {filePool.length > 0 ? (
        <Card className="space-y-3 p-4">
          <div className="text-sm font-medium">Arquivos disponiveis</div>
          <div className="space-y-2">
            {filePool.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="flex min-w-0 items-center gap-3">
                  {entry.mediaType === "video" ? (
                    <IconVideo className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <IconPhoto className="h-5 w-5 text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{entry.file.name}</div>
                    <div className="text-xs text-muted-foreground">{formatFileSize(entry.file)}</div>
                  </div>
                </div>
                <Button type="button" variant="ghost" size="icon" onClick={() => removePoolFile(entry.id)} aria-label={`Remover ${entry.file.name}`}>
                  <IconX className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div className="space-y-4">
        {bundles.map((bundle, bundleIndex) => (
          <Card key={bundle.id} className="space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Input
                value={bundle.name}
                onChange={(event) => updateBundle(bundle.id, { name: event.target.value })}
                placeholder={`Bundle ${bundleIndex + 1}`}
                className="max-w-sm"
              />
              <Button type="button" variant="ghost" size="icon" onClick={() => removeBundle(bundle.id)} aria-label={`Remover ${bundle.name}`}>
                <IconTrash className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              {mediaSlots.map((slot) => {
                const selectedFileId = bundle.slotFiles[slot.slot_key] || null
                const selectedFile = filePool.find((entry) => entry.id === selectedFileId)
                const slotPool = filePool.filter((entry) => entry.mediaType === slot.media_type)
                return (
                  <div key={slot.slot_key} className="rounded-lg border p-3">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">{slot.display_name}</div>
                        <div className="text-xs text-muted-foreground">{slot.slot_key}</div>
                      </div>
                      <Badge variant="outline">{slot.media_type}</Badge>
                    </div>

                    {mode === "visual" ? (
                      <div className="space-y-3">
                        {selectedFile ? (
                          <div className="rounded-md border border-border p-3">
                            <div className="truncate text-sm font-medium">{selectedFile.file.name}</div>
                            <div className="text-xs text-muted-foreground">{formatFileSize(selectedFile.file)}</div>
                          </div>
                        ) : (
                          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                            Nenhum arquivo selecionado
                          </div>
                        )}
                        <label className="inline-flex cursor-pointer">
                          <input
                            type="file"
                            className="hidden"
                            accept={slot.media_type === "video" ? ".mp4,.mov" : ".jpg,.jpeg,.png"}
                            onChange={(event) => handleVisualSlotFile(bundle.id, slot.slot_key, event.target.files?.[0] || null)}
                          />
                          <Button type="button" variant="outline">Selecionar arquivo</Button>
                        </label>
                      </div>
                    ) : (
                      <Select
                        value={selectedFileId || "__empty__"}
                        onValueChange={(value) => assignFileToSlot(bundle.id, slot.slot_key, value === "__empty__" ? null : value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Escolha um arquivo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__empty__">Nenhum</SelectItem>
                          {slotPool.map((entry) => (
                            <SelectItem key={entry.id} value={entry.id}>
                              {entry.file.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
