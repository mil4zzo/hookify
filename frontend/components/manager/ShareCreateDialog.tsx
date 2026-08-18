"use client";

import React, { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { IconCopy, IconLink, IconLoader2, IconShare2, IconX } from "@tabler/icons-react";
import { AppDialog } from "@/components/common/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThumbnailImage } from "@/components/common/ThumbnailImage";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";
import { cn } from "@/lib/utils/cn";
import { api } from "@/lib/api/endpoints";
import { buildShareAverages, buildShareMetricsFromRow } from "@/lib/share/buildShareItem";
import { MAX_HIGHLIGHT_METRICS, MAX_SHARE_ITEMS, SHARE_HIGHLIGHT_OPTIONS, buildShareUrl } from "@/lib/share/types";
import type { ShareMetricKey } from "@/lib/share/types";
import { useFormatCurrency } from "@/lib/utils/currency";
import { useSettings } from "@/lib/store/settings";
import type { RankingsItem } from "@/lib/api/schemas";
import type { ManagerAverages } from "@/lib/metrics";

/** Sempre disponíveis, e o par que o gestor mais compartilha. */
const DEFAULT_HIGHLIGHTS: ShareMetricKey[] = ["spend", "ctr"];

export interface ShareCreateDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Criativos que virarão slides, na ordem de exibição (seleção ou preset). */
  rows: RankingsItem[];
  dateStart: string;
  dateStop: string;
  actionType: string;
  mqlLeadscoreMin: number | null;
  /** Médias do conjunto — congeladas no snapshot para colorir o viewer público. */
  averages?: ManagerAverages | null;
}

function formatDatePt(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR");
}

function extractErrorDetail(error: unknown): string {
  const detail = (error as any)?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  if (error instanceof Error && error.message) return error.message;
  return "Tente novamente em instantes.";
}

/**
 * Dialog de criação de link compartilhável (aba Criativos). O usuário revisa a
 * lista (pode remover itens), gera o link e copia. As métricas enviadas são o
 * snapshot da própria linha do Manager (mesmos valores do modal de detalhamento);
 * a mídia é resolvida no backend na criação.
 */
export function ShareCreateDialog({ isOpen, onClose, rows, dateStart, dateStop, actionType, mqlLeadscoreMin, averages }: ShareCreateDialogProps) {
  const formatCurrency = useFormatCurrency();
  const { settings } = useSettings();

  const [items, setItems] = useState<RankingsItem[]>([]);
  const [highlights, setHighlights] = useState<ShareMetricKey[]>(DEFAULT_HIGHLIGHTS);
  const [isCreating, setIsCreating] = useState(false);
  const [result, setResult] = useState<{ token: string; expires_at: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    if (rows.length > MAX_SHARE_ITEMS) {
      toast.info(`Máximo de ${MAX_SHARE_ITEMS} criativos por link — mantivemos os ${MAX_SHARE_ITEMS} primeiros.`);
    }
    setItems(rows.filter((r) => !!r.ad_name).slice(0, MAX_SHARE_ITEMS));
    setHighlights(DEFAULT_HIGHLIGHTS);
    setResult(null);
    setIsCreating(false);
  }, [isOpen, rows]);

  /** Seleção circular: cheio + nova escolha descarta a mais antiga (sem beco sem saída). */
  const toggleHighlight = useCallback((key: ShareMetricKey) => {
    setHighlights((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length < MAX_HIGHLIGHT_METRICS) return [...prev, key];
      return [...prev.slice(1), key];
    });
  }, []);

  const shareUrl = result ? buildShareUrl(result.token) : null;

  const handleRemove = useCallback((adName: string) => {
    setItems((prev) => prev.filter((r) => r.ad_name !== adName));
  }, []);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success("Link copiado!", { description: "É só colar no WhatsApp da equipe." });
    } catch {
      toast.error("Não foi possível copiar automaticamente", { description: "Selecione o link e copie manualmente." });
    }
  }, [shareUrl]);

  const handleCreate = useCallback(async () => {
    if (items.length === 0 || isCreating) return;
    setIsCreating(true);
    try {
      const payload = {
        date_start: dateStart,
        date_stop: dateStop,
        currency: settings.currency ?? null,
        items: items.map((row) => ({
          ad_name: String(row.ad_name),
          metrics: buildShareMetricsFromRow(row, { actionType, mqlLeadscoreMin }),
        })),
        averages: buildShareAverages(averages),
        highlight_metrics: highlights,
      };
      const res = await api.shares.create(payload);
      setResult({ token: res.token, expires_at: res.expires_at });
    } catch (error) {
      toast.error("Não foi possível gerar o link", { description: extractErrorDetail(error) });
    } finally {
      setIsCreating(false);
    }
  }, [items, isCreating, dateStart, dateStop, settings.currency, actionType, mqlLeadscoreMin, averages, highlights]);

  return (
    <AppDialog isOpen={isOpen} onClose={onClose} title="Compartilhar criativos" size="lg" padding="md">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Link público em formato stories com {items.length} criativo{items.length !== 1 ? "s" : ""} e as métricas do
          período <span className="font-medium text-text">{formatDatePt(dateStart)} – {formatDatePt(dateStop)}</span>.
        </p>

        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {items.map((row) => (
            <div key={row.ad_name} className="flex items-center gap-3 rounded-md border border-border bg-card px-2.5 py-1.5">
              <ThumbnailImage src={getAdThumbnail(row)} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.ad_name}</p>
                <p className="text-2xs text-muted-foreground">
                  {formatCurrency(Number(row.spend || 0))}
                  {Number.isFinite(row.ctr) ? ` · CTR ${(Number(row.ctr) * 100).toFixed(2)}%` : ""}
                </p>
              </div>
              {!result && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto px-1.5 py-1 text-muted-foreground"
                  aria-label={`Remover ${row.ad_name}`}
                  disabled={isCreating}
                  onClick={() => handleRemove(String(row.ad_name))}
                >
                  <IconX className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
          {items.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum criativo na lista.</p>
          )}
        </div>

        {!result && (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium">Métricas em destaque</p>
              <p className="text-2xs text-muted-foreground">
                {highlights.length}/{MAX_HIGHLIGHT_METRICS} · aparecem sem precisar expandir
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SHARE_HIGHLIGHT_OPTIONS.map((option) => {
                const isSelected = highlights.includes(option.key);
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={isSelected}
                    disabled={isCreating}
                    onClick={() => toggleHighlight(option.key)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition-colors",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:text-text",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {result && shareUrl ? (
          <div className="space-y-2 rounded-md border border-success-30 bg-success-10 p-3">
            <div className="flex items-center gap-1.5 text-sm font-medium text-success">
              <IconLink className="h-4 w-4" />
              Link gerado — válido até {formatDatePt(result.expires_at)}
            </div>
            <div className="flex items-center gap-2">
              <Input readOnly value={shareUrl} size="sm" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button size="sm" className="gap-1.5" onClick={handleCopy}>
                <IconCopy className="h-3.5 w-3.5" />
                Copiar
              </Button>
            </div>
            <p className="text-2xs text-muted-foreground">
              Vídeos usam a CDN da Meta e podem expirar antes do link — as métricas continuam visíveis.
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" disabled={isCreating} onClick={onClose}>
              Cancelar
            </Button>
            <Button size="sm" className="gap-1.5" disabled={items.length === 0 || isCreating} onClick={handleCreate}>
              {isCreating ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" /> : <IconShare2 className="h-3.5 w-3.5" />}
              {isCreating ? "Gerando link…" : "Gerar link"}
            </Button>
          </div>
        )}
      </div>
    </AppDialog>
  );
}
