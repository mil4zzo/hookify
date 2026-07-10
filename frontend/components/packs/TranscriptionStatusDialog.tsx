"use client";

import React, { useEffect, useState, useCallback } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/endpoints";
import { PackTranscriptionStatus, TranscriptionAdInfo } from "@/lib/api/schemas";
import {
  IconCheck,
  IconCircleX,
  IconLoader2,
  IconMicrophone,
  IconMicrophoneOff,
} from "@tabler/icons-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  packId: string;
  packName: string;
  onConfirm: (adNames: string[]) => void;
}

export function TranscriptionStatusDialog({ isOpen, onClose, packId, packName, onConfirm }: Props) {
  const [status, setStatus] = useState<PackTranscriptionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!packId) return;
    setIsLoading(true);
    setStatus(null);
    try {
      const data = await api.facebook.getPackTranscriptionStatus(packId);
      setStatus(data);
      setSelected(new Set(data.untranscribed_ads.map((a) => a.ad_name)));
    } catch {
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, [packId]);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  const handleToggle = (adName: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(adName)) next.delete(adName);
      else next.add(adName);
      return next;
    });
  };

  const handleToggleAll = () => {
    if (!status) return;
    if (selected.size === status.untranscribed_ads.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(status.untranscribed_ads.map((a) => a.ad_name)));
    }
  };

  const allDone = status && status.untranscribed === 0 && status.processing === 0;
  const confirmCount = selected.size;
  const totalSelectable = status?.untranscribed_ads.length ?? 0;

  return (
    <AppDialog
      isOpen={isOpen}
      onClose={onClose}
      title={`Transcrição — ${packName}`}
      size="md"
      closeOnOverlayClick
      closeOnEscape
      showCloseButton={false}
    >
      <div className="flex flex-col gap-6 py-4">
        <h2 className="text-xl font-semibold text-text">Transcrição — {packName}</h2>

        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && !status && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Não foi possível carregar o status de transcrição.
          </p>
        )}

        {!isLoading && status && (
          <>
            <AdBreakdownBar status={status} />

            {allDone ? (
              <p className="text-sm text-muted-foreground">
                Todos os anúncios de vídeo deste pack já foram transcritos.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {totalSelectable > 0 && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {confirmCount} de {totalSelectable} selecionado{confirmCount !== 1 ? "s" : ""}
                    </span>
                    <Button variant="ghost" size="sm" onClick={handleToggleAll}>
                      {confirmCount === totalSelectable ? "Desmarcar todos" : "Marcar todos"}
                    </Button>
                  </div>
                )}

                <div className="space-y-1 max-h-[300px] overflow-y-auto border border-border rounded-lg p-2">
                  {status.untranscribed_ads.map((ad) => (
                    <AdRow
                      key={ad.ad_name}
                      ad={ad}
                      checked={selected.has(ad.ad_name)}
                      disabled={false}
                      onToggle={() => handleToggle(ad.ad_name)}
                    />
                  ))}
                  {status.processing_ads.map((ad) => (
                    <AdRow
                      key={ad.ad_name}
                      ad={ad}
                      checked={false}
                      disabled={true}
                      onToggle={() => {}}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="flex gap-4 w-full">
          <Button
            onClick={onClose}
            variant="destructiveOutline"
            className="flex-1 flex items-center justify-center gap-2"
          >
            <IconCircleX className="h-5 w-5" />
            Cancelar
          </Button>
          {!allDone && (
            <Button
              onClick={() => onConfirm(Array.from(selected))}
              disabled={confirmCount === 0 || isLoading || !status}
              variant="success"
              className="flex-1 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <IconMicrophone className="h-5 w-5" />
              Transcrever {confirmCount > 0 ? `${confirmCount} ${confirmCount === 1 ? "ad" : "ads"}` : "ads"}
            </Button>
          )}
        </div>
      </div>
    </AppDialog>
  );
}

interface AdRowProps {
  ad: TranscriptionAdInfo;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}

function AdRow({ ad, checked, disabled, onToggle }: AdRowProps) {
  if (disabled) {
    return (
      <div className="flex items-center gap-3 rounded-md p-3 opacity-50">
        <IconLoader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        <Thumbnail url={ad.thumbnail_url} />
        <span className="min-w-0 truncate text-sm text-text flex-1">{ad.ad_name}</span>
      </div>
    );
  }

  return (
    <label className="flex w-full cursor-pointer select-none items-center rounded-md p-3 hover:bg-accent transition-colors gap-3">
      <Checkbox checked={checked} onCheckedChange={() => onToggle()} />
      <Thumbnail url={ad.thumbnail_url} />
      <span className="min-w-0 truncate text-sm text-text flex-1">{ad.ad_name}</span>
    </label>
  );
}

function Thumbnail({ url }: { url?: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />;
  }
  return <div className="h-9 w-9 shrink-0 rounded bg-input-30" />;
}

const STRIPE_BG =
  "repeating-linear-gradient(-45deg, color-mix(in oklab, var(--muted-foreground) 22%, transparent) 0, color-mix(in oklab, var(--muted-foreground) 22%, transparent) 2px, transparent 2px, transparent 7px)";
const TRANSCRIBED_BG = "color-mix(in oklab, var(--success) 40%, transparent)";
const UNTRANSCRIBED_BG = "var(--attention)";

function AdBreakdownBar({ status }: { status: PackTranscriptionStatus }) {
  const total = status.total_video_ads;
  const untranscribedTotal = status.untranscribed + status.processing;

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum anúncio de vídeo neste pack.
      </p>
    );
  }

  const barSegments = [
    { key: "transcribed", count: status.transcribed, bg: TRANSCRIBED_BG },
    { key: "untranscribed", count: untranscribedTotal, bg: UNTRANSCRIBED_BG },
    { key: "no_voice", count: status.no_voice, bg: STRIPE_BG },
  ].filter((s) => s.count > 0);

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-sm text-muted-foreground">
        Dos{" "}
        <span className="font-semibold text-text">{total}</span>{" "}
        de vídeo:
      </span>

      <div
        className="flex h-4 w-full overflow-hidden rounded-full"
        style={{ background: "color-mix(in oklab, var(--border) 60%, transparent)" }}
      >
        {barSegments.map((seg) => {
          const pct = (seg.count / total) * 100;
          return (
            <div
              key={seg.key}
              className="h-full transition-all"
              style={{ width: `max(${pct}%, 6px)`, background: seg.bg }}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-1 pt-0.5">
        <LegendItem
          dotBg={TRANSCRIBED_BG}
          textClass={status.transcribed > 0 ? "text-success/80" : "text-muted-foreground/40"}
          label={`${status.transcribed} ${status.transcribed === 1 ? "transcrito" : "transcritos"}`}
        />
        <LegendItem
          dotBg={UNTRANSCRIBED_BG}
          textClass={untranscribedTotal > 0 ? "text-attention" : "text-muted-foreground/40"}
          label={`${untranscribedTotal} sem transcrição${status.processing > 0 ? ` · ${status.processing} em andamento` : ""}`}
        />
        <LegendItem
          dotBg={STRIPE_BG}
          textClass={status.no_voice > 0 ? "text-muted-foreground/70" : "text-muted-foreground/40"}
          label={`${status.no_voice} sem áudio`}
        />
      </div>
    </div>
  );
}

function LegendItem({
  dotBg,
  textClass,
  label,
}: {
  dotBg: string;
  textClass: string;
  label: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${textClass}`}>
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ background: dotBg }}
      />
      {label}
    </span>
  );
}
