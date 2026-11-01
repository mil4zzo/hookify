"use client"

import { useMemo, useRef, useState } from "react"
import {
  IconAlertCircle,
  IconBrandGoogleDrive,
  IconCircleCheck,
  IconDeviceDesktop,
  IconFolder,
  IconLoader2,
  IconPhoto,
  IconRefresh,
  IconTrash,
  IconUpload,
  IconVideo,
} from "@tabler/icons-react"
import { api } from "@/lib/api/endpoints"
import { useLaunchWizard, type PoolEntry } from "@/lib/campaignLaunch/store"
import { isCreativeComplete, type CreativeDraft } from "@/lib/campaignLaunch/grouping"
import type { DriveFile, MediaSlot } from "@/lib/campaignLaunch/types"
import type { useMediaPipeline } from "@/lib/campaignLaunch/useMediaPipeline"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { InlineNotice, StatePanel } from "@/components/common/States"
import { cn } from "@/lib/utils/cn"

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

// O pipeline de envio vive no assistente (não aqui): sair deste passo não pode abortar envios.
export function CreativesStep({ pipeline }: { pipeline: ReturnType<typeof useMediaPipeline> }) {
  const slots = useLaunchWizard((s) => s.slots)
  const creatives = useLaunchWizard((s) => s.creatives)
  const pool = useLaunchWizard((s) => s.pool)
  const { addLocalFiles, addDriveFiles, retryEntry } = pipeline

  const entries = Object.values(pool)
  const ready = entries.filter((e) => e.status === "ready").length
  const failed = entries.filter((e) => e.status === "error").length

  return (
    <div className="space-y-6">
      <Tabs defaultValue="computer">
        <TabsList>
          <TabsTrigger value="computer">
            <IconDeviceDesktop className="h-4 w-4" /> Computador
          </TabsTrigger>
          <TabsTrigger value="drive">
            <IconBrandGoogleDrive className="h-4 w-4" /> Google Drive
          </TabsTrigger>
        </TabsList>
        <TabsContent value="computer" className="pt-4">
          <LocalDropzone onFiles={(files) => void addLocalFiles(files)} />
        </TabsContent>
        <TabsContent value="drive" className="pt-4">
          <DrivePicker existing={pool} onImport={addDriveFiles} />
        </TabsContent>
      </Tabs>

      {slots.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Este modelo tem {slots.length} posicionamentos com mídia própria ({slots.map((s) => s.display_name).join(" · ")}).
          Arquivos com o mesmo nome-base (ex.: <span className="font-medium text-foreground">AD01_feed</span> e{" "}
          <span className="font-medium text-foreground">AD01_story</span>) ou na mesma subpasta do Drive viram um
          criativo, e cada um vai para o posicionamento pela proporção.
        </p>
      )}

      {creatives.length === 0 ? (
        <StatePanel
          kind="empty"
          frame="dashed"
          title="Nenhum criativo ainda"
          message="Adicione arquivos do computador ou importe uma pasta do Google Drive."
        />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {creatives.length} criativo(s) · {ready}/{entries.length} mídia(s) prontas na Meta
            {failed > 0 && ` · ${failed} com erro`}
          </p>
          {creatives.map((creative) => (
            <CreativeCard key={creative.key} creative={creative} slots={slots} pool={pool} onRetry={retryEntry} />
          ))}
        </div>
      )}
    </div>
  )
}

function LocalDropzone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        onFiles(Array.from(e.dataTransfer.files))
      }}
      className={cn(
        // design-system-exception: ad-hoc-dashed-border - área que recebe arrasto (borda padrão, primary no arrasto)
        "focus-inset flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-10 text-center transition-colors",
        dragging ? "border-primary bg-primary-10" : "border-border bg-surface-2 hover:border-primary",
      )}
    >
      <IconUpload className="h-6 w-6 text-muted-foreground" />
      <span className="text-sm font-medium">Arraste imagens e vídeos ou clique para escolher</span>
      <span className="text-xs text-muted-foreground">
        JPG, PNG (até 30 MB) · MP4, MOV (até 4 GB). O envio começa na hora e continua enquanto você revisa.
      </span>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,video/mp4,video/quicktime"
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []))
          e.target.value = ""
        }}
      />
    </button>
  )
}

function DrivePicker({
  existing,
  onImport,
}: {
  existing: Record<string, PoolEntry>
  onImport: (files: DriveFile[]) => Promise<void>
}) {
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [folder, setFolder] = useState<{ name: string; files: DriveFile[] } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const list = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.campaignLaunch.listDriveFolder(url.trim())
      setFolder({ name: res.folder.name, files: res.files })
      setSelected(new Set(res.files.filter((f) => !existing[`drive:${f.id}`]).map((f) => f.id)))
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: { message?: string } } } })?.response?.data?.detail
      setError(detail?.message ?? "Não foi possível ler a pasta.")
      setFolder(null)
    } finally {
      setLoading(false)
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, DriveFile[]>()
    for (const f of folder?.files ?? []) {
      const key = f.group ?? ""
      map.set(key, [...(map.get(key) ?? []), f])
    }
    return [...map.entries()]
  }, [folder])

  const chosen = (folder?.files ?? []).filter((f) => selected.has(f.id))

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (url.trim()) void list()
        }}
      >
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Cole o link da pasta do Google Drive"
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="outline" disabled={!url.trim() || loading}>
          {loading ? <IconLoader2 className="h-4 w-4 animate-spin" /> : <IconFolder className="h-4 w-4" />}
          Abrir pasta
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">
        Usa a conta Google conectada em Configurações. As mídias vão do Drive direto para a Meta pelo servidor — não
        dependem da sua internet nem desta aba aberta. Cada subpasta vira um criativo.
      </p>

      {error && <InlineNotice tone="destructive">{error}</InlineNotice>}

      {folder &&
        (folder.files.length === 0 ? (
          <StatePanel
            kind="empty"
            frame="none"
            title={`Nenhuma mídia em "${folder.name}"`}
            message="A pasta não tem JPG, PNG, MP4 ou MOV (nem em subpastas de 1º nível)."
          />
        ) : (
          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium">
                {folder.name} · {folder.files.length} arquivo(s)
              </p>
              <Button
                type="button"
                disabled={!chosen.length || importing}
                onClick={async () => {
                  setImporting(true)
                  await onImport(chosen)
                  setImporting(false)
                  setSelected(new Set())
                }}
              >
                {importing && <IconLoader2 className="h-4 w-4 animate-spin" />}
                Importar {chosen.length}
              </Button>
            </div>
            <ul className="max-h-80 space-y-3 overflow-y-auto">
              {groups.map(([group, files]) => (
                <li key={group || "_root"} className="space-y-1">
                  {group && <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{group}</p>}
                  {files.map((f) => {
                    const already = Boolean(existing[`drive:${f.id}`])
                    return (
                      <label
                        key={f.id}
                        className={cn("flex items-center gap-3 rounded-md px-2 py-1.5 text-sm", already ? "opacity-50" : "cursor-pointer hover:bg-surface-2")}
                      >
                        <Checkbox
                          checked={selected.has(f.id)}
                          disabled={already}
                          onCheckedChange={(v) =>
                            setSelected((prev) => {
                              const next = new Set(prev)
                              if (v === true) next.add(f.id)
                              else next.delete(f.id)
                              return next
                            })
                          }
                        />
                        {f.media_type === "video" ? (
                          <IconVideo className="h-4 w-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <IconPhoto className="h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{f.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {f.width && f.height ? `${f.width}×${f.height} · ` : ""}
                          {formatBytes(f.size_bytes)}
                          {already && " · já importado"}
                        </span>
                      </label>
                    )
                  })}
                </li>
              ))}
            </ul>
          </div>
        ))}
    </div>
  )
}

function CreativeCard({
  creative,
  slots,
  pool,
  onRetry,
}: {
  creative: CreativeDraft
  slots: MediaSlot[]
  pool: Record<string, PoolEntry>
  onRetry: (key: string) => void | Promise<void>
}) {
  const renameCreative = useLaunchWizard((s) => s.renameCreative)
  const setCreativeSlot = useLaunchWizard((s) => s.setCreativeSlot)
  const removeCreative = useLaunchWizard((s) => s.removeCreative)
  const complete = isCreativeComplete(creative, slots)
  const poolEntries = Object.values(pool)

  return (
    <div className={cn("space-y-3 rounded-lg border bg-card p-4", complete ? "border-border" : "border-warning-30")}>
      <div className="flex items-center gap-3">
        <Input
          value={creative.name}
          onChange={(e) => renameCreative(creative.key, e.target.value)}
          placeholder="Nome do anúncio"
          aria-label="Nome do anúncio"
          className="min-w-0 flex-1"
        />
        <Button type="button" variant="ghost" size="icon" aria-label="Remover criativo" onClick={() => removeCreative(creative.key)}>
          <IconTrash className="h-4 w-4" />
        </Button>
      </div>
      <div className={cn("grid gap-3", slots.length > 1 ? "sm:grid-cols-2" : "")}>
        {slots.map((slot) => {
          const entry = pool[creative.slots[slot.slot_key] ?? ""]
          return (
            <SlotTile
              key={slot.slot_key}
              slot={slot}
              entry={entry}
              options={poolEntries}
              showPicker={slots.length > 1 || poolEntries.length > 1}
              onPick={(mediaKey) => setCreativeSlot(creative.key, slot.slot_key, mediaKey)}
              onRetry={onRetry}
            />
          )
        })}
      </div>
    </div>
  )
}

function SlotTile({
  slot,
  entry,
  options,
  showPicker,
  onPick,
  onRetry,
}: {
  slot: MediaSlot
  entry: PoolEntry | undefined
  options: PoolEntry[]
  showPicker: boolean
  onPick: (mediaKey: string) => void
  onRetry: (key: string) => void | Promise<void>
}) {
  return (
    <div className="flex gap-3 rounded-md border border-border bg-surface-2 p-3">
      <div className="flex h-20 w-16 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-background">
        {entry?.previewUrl ? (
          entry.mediaType === "video" && entry.source === "upload" ? (
            <video src={entry.previewUrl} muted className="h-full w-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={entry.previewUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          )
        ) : entry?.mediaType === "video" ? (
          <IconVideo className="h-5 w-5 text-muted-foreground" />
        ) : (
          <IconPhoto className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          {slot.display_name}
          {slot.aspect_ratio ? ` · ${slot.aspect_ratio}` : ""}
        </p>
        {showPicker ? (
          <Select value={entry?.key ?? ""} onValueChange={onPick}>
            <SelectTrigger size="sm" aria-label={`Mídia de ${slot.display_name}`}>
              <SelectValue placeholder="Escolher mídia" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.key} value={o.key}>
                  {o.name}
                  {o.width && o.height ? ` (${o.width}×${o.height})` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="truncate text-sm">{entry?.name ?? "Sem mídia"}</p>
        )}
        {entry && <MediaStatus entry={entry} onRetry={() => void onRetry(entry.key)} />}
      </div>
    </div>
  )
}

function MediaStatus({ entry, onRetry }: { entry: PoolEntry; onRetry: () => void }) {
  if (entry.status === "ready")
    return (
      <p className="flex items-center gap-1 text-xs text-success">
        <IconCircleCheck className="h-3.5 w-3.5" /> Pronta na Meta
      </p>
    )
  if (entry.status === "error")
    return (
      <div className="flex items-center gap-2">
        <p className="flex min-w-0 items-center gap-1 text-xs text-destructive">
          <IconAlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate" title={entry.error ?? undefined}>{entry.error ?? "Falhou"}</span>
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
          <IconRefresh className="h-4 w-4" /> Tentar de novo
        </Button>
      </div>
    )
  if (entry.status === "processing")
    return (
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <IconLoader2 className="h-3.5 w-3.5 animate-spin" /> Meta processando o vídeo...
      </p>
    )
  if (entry.status === "queued") return <p className="text-xs text-muted-foreground">Na fila de envio</p>
  const pct = entry.sizeBytes ? Math.round((entry.bytesSent / entry.sizeBytes) * 100) : 0
  return (
    <div className="space-y-1">
      <Progress value={pct} className="h-1.5" />
      <p className="text-xs text-muted-foreground">
        {entry.source === "drive" ? "Drive → Meta" : "Enviando"} · {pct}% de {formatBytes(entry.sizeBytes)}
      </p>
    </div>
  )
}
