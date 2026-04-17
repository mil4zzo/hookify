"use client";

import { useEffect, useRef, useState } from "react";
import { IconCircleCheck, IconLink, IconPhotoFilled, IconPlus, IconVideo, IconX } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { AdCreativeDetailResponse } from "@/lib/api/schemas";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CreativeMediaSlot = AdCreativeDetailResponse["media_slots"][number];

export interface SlotFile {
  file: File;
  isAutoFilled: boolean;
  autoFilledFrom: string;
}

export interface AdMediaSet {
  id: string;
  adName: string;
  slots: Record<string, SlotFile | null>;
}

// ---------------------------------------------------------------------------
// Pure state helpers (exported for use in upload/page.tsx)
// ---------------------------------------------------------------------------

export function applyUpload(set: AdMediaSet, slotKey: string, file: File, templateSlots: CreativeMediaSlot[]): AdMediaSet {
  const updated: AdMediaSet = { ...set, slots: { ...set.slots } };
  updated.slots[slotKey] = { file, isAutoFilled: false, autoFilledFrom: "" };

  const slot = templateSlots.find((s) => s.slot_key === slotKey);
  for (const compatKey of slot?.compatible_slot_keys ?? []) {
    const existing = updated.slots[compatKey];
    const isManuallyOverridden = existing !== undefined && existing !== null && !existing.isAutoFilled;
    if (!isManuallyOverridden) {
      updated.slots[compatKey] = { file, isAutoFilled: true, autoFilledFrom: slotKey };
    }
  }
  return updated;
}

export function clearSlot(set: AdMediaSet, slotKey: string): AdMediaSet {
  return { ...set, slots: { ...set.slots, [slotKey]: null } };
}

export function resetSlotToAutoFill(set: AdMediaSet, slotKey: string, templateSlots: CreativeMediaSlot[]): AdMediaSet {
  const slot = templateSlots.find((s) => s.slot_key === slotKey);
  const sourceKey = slot?.compatible_slot_keys.find((k) => !!set.slots[k]?.file);
  if (!sourceKey) return set;
  const sourceFile = set.slots[sourceKey]!.file;
  return {
    ...set,
    slots: {
      ...set.slots,
      [slotKey]: { file: sourceFile, isAutoFilled: true, autoFilledFrom: sourceKey },
    },
  };
}

export function buildDefaultAdNameFromSlots(slots: Record<string, SlotFile | null>): string {
  for (const slotFile of Object.values(slots)) {
    if (slotFile?.file) return slotFile.file.name.replace(/\.[^.]+$/, "");
  }
  return "";
}

export function isMediaSetComplete(set: AdMediaSet, templateSlots: CreativeMediaSlot[]): boolean {
  if (!set.adName.trim()) return false;
  return templateSlots.filter((s) => s.required).every((s) => !!set.slots[s.slot_key]?.file);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "video/mp4", "video/quicktime"];

function parseAspectRatio(ratio: string): string {
  if (!ratio) return "aspect-square";
  const parts = ratio.split(":");
  if (parts.length !== 2) return "aspect-square";
  const [w, h] = parts;
  return w === h ? "aspect-square" : `aspect-[${w}/${h}]`;
}

// ---------------------------------------------------------------------------
// FileSlot — shows aspect-ratio-correct drop zone or image/video preview
// ---------------------------------------------------------------------------

function FileSlot({ label, aspectRatios, file, required, isAutoFilled, autoFilledFromLabel, onFile, onClear, onReset, resetSourceLabel }: { label: string; aspectRatios: string[]; file: File | null; required: boolean; isAutoFilled?: boolean; autoFilledFromLabel?: string; onFile: (file: File) => void; onClear: () => void; onReset?: () => void; resetSourceLabel?: string }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isVideo = file?.type.startsWith("video/");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    if (!file || isVideo) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isVideo]);

  const aspectClass = parseAspectRatio(aspectRatios[0] ?? "");

  return (
    <div className="flex-1 min-w-0 space-y-1">
      {/* Label */}
      <div className="flex items-center gap-1">
        <span className="truncate text-[11px] font-semibold text-foreground">{label}</span>
        {!required && <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">opc.</span>}
      </div>

      {/* Auto-fill badge */}
      {isAutoFilled && autoFilledFromLabel && (
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <IconLink className="h-3 w-3 shrink-0" />
          <span>
            De <span className="font-medium">{autoFilledFromLabel}</span>
          </span>
        </div>
      )}

      {/* Slot area */}
      {file ? (
        <div className={`relative w-full overflow-hidden rounded-lg bg-muted ${aspectClass}`}>
          {isVideo ? (
            <div className="absolute inset-0 flex items-center justify-center bg-muted">
              <IconVideo className="h-8 w-8 text-muted-foreground opacity-50" />
            </div>
          ) : previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt={file.name} className="absolute inset-0 h-full w-full object-cover" />
          ) : null}
          {/* Bottom gradient + filename */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 px-2 pb-1.5">
            <p className="truncate text-[10px] leading-tight text-white drop-shadow">{file.name}</p>
          </div>
          {/* Remove button */}
          <button type="button" className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70" onClick={onClear}>
            <IconX className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className={`group flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-2 transition-colors ${isDragOver ? "border-primary bg-primary-10" : "border-border bg-muted-20 hover:border-primary-60 hover:bg-primary-5"} ${aspectClass}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f && ACCEPTED_TYPES.includes(f.type)) onFile(f);
          }}
        >
          <IconPhotoFilled className={`h-6 w-6 transition-colors ${isDragOver ? "text-primary" : "text-muted-foreground group-hover:text-primary"}`} />
          <span className={`text-center text-[11px] font-medium leading-tight transition-colors ${isDragOver ? "text-primary" : "text-muted-foreground group-hover:text-primary"}`}>Arraste ou selecione</span>
          {aspectRatios.filter(Boolean).length > 0 && <span className="text-center text-[10px] text-muted-foreground/60 leading-tight">{aspectRatios.filter(Boolean).join(" · ")}</span>}
        </button>
      )}

      {/* Reset to auto-fill */}
      {onReset && resetSourceLabel && (
        <button type="button" className="text-[10px] text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground" onClick={onReset}>
          Usar mídia de {resetSourceLabel}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept=".jpg,.jpeg,.png,.mp4,.mov"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && ACCEPTED_TYPES.includes(f.type)) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SlotCard — one creative card: name input on top, slots below
// ---------------------------------------------------------------------------

function SlotCard({ set, index, templateSlots, onUpdate, onRemove }: { set: AdMediaSet; index: number; templateSlots: CreativeMediaSlot[]; onUpdate: (updated: AdMediaSet) => void; onRemove: () => void }) {
  const complete = isMediaSetComplete(set, templateSlots);
  const filledCount = templateSlots.filter((s) => !!set.slots[s.slot_key]?.file).length;
  const totalCount = templateSlots.length;

  return (
    <div className={`rounded-xl border bg-secondary transition-colors ${complete ? "border-primary-30" : "border-border"}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 rounded-t-md border-b border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2.5">
          {complete ? <IconCircleCheck className="h-4 w-4 shrink-0 text-primary" /> : <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground text-[10px] font-bold text-muted-foreground opacity-40">{index + 1}</div>}
          <span className="text-sm font-semibold">Criativo {index + 1}</span>
          {filledCount > 0 && (
            <Badge variant={complete ? "secondary" : "outline"} className="px-1.5 py-0.5 text-[10px]">
              {filledCount}/{totalCount}
            </Badge>
          )}
        </div>
        <button type="button" className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive-10 hover:text-destructive" onClick={onRemove}>
          <IconX className="h-4 w-4" />
        </button>
      </div>

      {/* Ad name — top */}
      <div className="px-4 pt-4 pb-3">
        <Input className="h-9 text-sm" placeholder="Ex: Criativo Verão 01" value={set.adName} onChange={(e) => onUpdate({ ...set, adName: e.target.value })} />
      </div>

      {/* Slots — horizontal row */}
      <div className="flex gap-3 px-4 pb-4">
        {templateSlots.map((slot) => {
          const current = set.slots[slot.slot_key] ?? null;
          const isAutoFilled = !!current?.isAutoFilled;
          const sourceSlot = templateSlots.find((s) => s.slot_key === current?.autoFilledFrom);
          const resetSourceSlot = templateSlots.find((s) => s.slot_key === slot.compatible_slot_keys[0]);
          const showReset = !isAutoFilled && slot.compatible_slot_keys.length > 0 && !!current?.file && !!resetSourceSlot && !!set.slots[resetSourceSlot.slot_key]?.file;
          const compatibleRatios = slot.compatible_slot_keys.map((k) => templateSlots.find((s) => s.slot_key === k)?.aspect_ratio ?? "").filter((r) => r && r !== slot.aspect_ratio);
          const aspectRatios = [slot.aspect_ratio, ...compatibleRatios].filter(Boolean);

          return (
            <FileSlot
              key={slot.slot_key}
              label={slot.display_name || slot.primary_placement || slot.slot_key}
              aspectRatios={aspectRatios}
              file={current?.file ?? null}
              required={slot.required}
              isAutoFilled={isAutoFilled}
              autoFilledFromLabel={sourceSlot?.primary_placement}
              onFile={(f) => {
                const updated = applyUpload(set, slot.slot_key, f, templateSlots);
                if (!set.adName.trim()) {
                  onUpdate({ ...updated, adName: f.name.replace(/\.[^.]+$/, "") });
                } else {
                  onUpdate(updated);
                }
              }}
              onClear={() => onUpdate(clearSlot(set, slot.slot_key))}
              onReset={showReset ? () => onUpdate(resetSlotToAutoFill(set, slot.slot_key, templateSlots)) : undefined}
              resetSourceLabel={resetSourceSlot?.primary_placement}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface SlotUploadZoneProps {
  sets: AdMediaSet[];
  templateSlots: CreativeMediaSlot[];
  onChange: (sets: AdMediaSet[]) => void;
}

function generateId() {
  return Math.random().toString(36).slice(2, 9);
}

export function makeEmptyMediaSet(): AdMediaSet {
  return { id: generateId(), adName: "", slots: {} };
}

export default function SlotUploadZone({ sets, templateSlots, onChange }: SlotUploadZoneProps) {
  function addSet() {
    onChange([...sets, makeEmptyMediaSet()]);
  }

  function removeSet(id: string) {
    onChange(sets.filter((s) => s.id !== id));
  }

  function updateSet(id: string, updated: AdMediaSet) {
    onChange(sets.map((s) => (s.id === id ? updated : s)));
  }

  const completedCount = sets.filter((s) => isMediaSetComplete(s, templateSlots)).length;

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      {sets.length > 0 && (
        <div className="flex items-center justify-between px-0.5">
          <span className="text-xs text-muted-foreground">
            {completedCount} de {sets.length} criativo{sets.length !== 1 ? "s" : ""} pronto{completedCount !== 1 ? "s" : ""}
          </span>
          {completedCount === sets.length && sets.length > 0 && (
            <span className="flex items-center gap-1 text-xs font-medium text-primary">
              <IconCircleCheck className="h-3.5 w-3.5" />
              Todos prontos
            </span>
          )}
        </div>
      )}

      {/* Cards grid — 1 col mobile → 2 col tablet → 4 col desktop */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {sets.map((set, index) => (
          <SlotCard key={set.id} set={set} index={index} templateSlots={templateSlots} onUpdate={(updated) => updateSet(set.id, updated)} onRemove={() => removeSet(set.id)} />
        ))}

        {/* Add card — lives inside the grid as a peer */}
        <button
          type="button"
          className="group flex min-h-[120px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted-10 text-sm text-muted-foreground transition-colors hover:border-primary-60 hover:bg-primary-5 hover:text-primary"
          onClick={addSet}
        >
          <IconPlus className="h-5 w-5 transition-transform group-hover:scale-110" />
          <span>Adicionar criativo</span>
        </button>
      </div>
    </div>
  );
}
