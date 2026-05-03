"use client";

import React, { useEffect, useState, useCallback } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { AppCheckbox } from "@/components/ui/app-checkbox";
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
        <div>
          <h2 className="text-xl font-semibold text-text mb-2">Transcrição — {packName}</h2>
          {!isLoading && status && !allDone && totalSelectable > 0 && (
            <p className="text-sm text-muted-foreground">
              Selecione quais anúncios deseja transcrever:
            </p>
          )}
        </div>

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
            {/* Status badges */}
            <div className="flex flex-wrap gap-2">
              {status.transcribed > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                  <IconCheck className="h-3.5 w-3.5" />
                  {status.transcribed} {status.transcribed === 1 ? "transcrito" : "transcritos"}
                </span>
              )}
              {status.untranscribed > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-input-30 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                  <IconMicrophone className="h-3.5 w-3.5" />
                  {status.untranscribed} sem transcrição
                </span>
              )}
              {status.no_voice > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning">
                  <IconMicrophoneOff className="h-3.5 w-3.5" />
                  {status.no_voice} sem voz detectada
                </span>
              )}
              {status.processing > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                  <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                  {status.processing} em processamento
                </span>
              )}
              {status.transcribed === 0 && status.untranscribed === 0 && status.no_voice === 0 && status.processing === 0 && (
                <span className="text-sm text-muted-foreground">
                  Nenhum anúncio de vídeo encontrado neste pack.
                </span>
              )}
            </div>

            {allDone ? (
              <p className="text-sm text-muted-foreground">
                Todos os anúncios de vídeo deste pack já foram transcritos.
              </p>
            ) : (
              <>
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
              </>
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
    <AppCheckbox
      checked={checked}
      onCheckedChange={() => onToggle()}
      className="flex w-full rounded-md p-3 hover:bg-accent transition-colors gap-3"
    >
      <Thumbnail url={ad.thumbnail_url} />
      <span className="min-w-0 truncate text-sm text-text flex-1">{ad.ad_name}</span>
    </AppCheckbox>
  );
}

function Thumbnail({ url }: { url?: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />;
  }
  return <div className="h-9 w-9 shrink-0 rounded bg-input-30" />;
}
