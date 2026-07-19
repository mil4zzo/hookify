"use client";

import React, { useEffect, useState, useCallback } from "react";
import { AppDialog } from "@/components/common/AppDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
// design-system-exception: direct-skeleton-import - skeleton estrutural espelha o layout específico do dialog (barra + abas + linhas com checkbox), sem variant equivalente no StateSkeleton
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { api } from "@/lib/api/endpoints";
import { PackTranscriptionStatus, TranscriptionAdInfo } from "@/lib/api/schemas";
import { cn } from "@/lib/utils/cn";
import {
  IconCircleX,
  IconLoader2,
  IconMicrophone,
  IconRefresh,
} from "@tabler/icons-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  packId: string;
  packName: string;
  onConfirm: (adNames: string[]) => void;
  /** Força nova tentativa dos ads marcados como "sem áudio" (escape para falsos positivos). */
  onForce: (adNames: string[]) => void;
}

type TabValue = "untranscribed" | "transcribed" | "no_voice";

// Fonte única da identidade visual de cada categoria: a mesma cor pinta o
// contador da aba e o segmento da progressbar.
const STRIPE_BG =
  "repeating-linear-gradient(-45deg, color-mix(in oklab, var(--muted-foreground) 22%, transparent) 0, color-mix(in oklab, var(--muted-foreground) 22%, transparent) 2px, transparent 2px, transparent 7px)";

const CATEGORY_BAR_BG: Record<TabValue, string> = {
  untranscribed: "var(--attention)",
  transcribed: "var(--success)",
  no_voice: STRIPE_BG,
};

// "Sem áudio" não tem cor própria: herda a do trigger (muted quando inativo,
// primary-foreground quando ativo), espelhando as listras neutras da barra.
const CATEGORY_COUNT_CLASS: Record<TabValue, string> = {
  untranscribed: "text-attention",
  transcribed: "text-success",
  no_voice: "",
};

// Categoria não selecionada recua — mesmo valor no contador da aba e no
// segmento da barra, para que os dois leiam como a mesma informação.
const INACTIVE_CATEGORY_OPACITY = 0.5;

// Altura fixa da lista: as 3 abas ocupam o mesmo espaço, cheias ou vazias.
const AD_LIST_BOX =
  "h-[18rem] overflow-y-auto rounded-lg border border-border bg-background p-2";

export function TranscriptionStatusDialog({ isOpen, onClose, packId, packName, onConfirm, onForce }: Props) {
  const [status, setStatus] = useState<PackTranscriptionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedNoAudio, setSelectedNoAudio] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<TabValue>("untranscribed");

  const load = useCallback(async () => {
    if (!packId) return;
    setIsLoading(true);
    setStatus(null);
    try {
      const data = await api.facebook.getPackTranscriptionStatus(packId);
      setStatus(data);
      setSelected(new Set(data.untranscribed_ads.map((a) => a.ad_name)));
      // "Forçar" é ação excepcional: começa sem nada marcado (opt-in)
      setSelectedNoAudio(new Set());
      setActiveTab(
        data.untranscribed_ads.length + data.processing_ads.length > 0
          ? "untranscribed"
          : data.transcribed_ads.length > 0
            ? "transcribed"
            : data.no_voice_ads.length > 0
              ? "no_voice"
              : "untranscribed"
      );
    } catch {
      setStatus(null);
    } finally {
      setIsLoading(false);
    }
  }, [packId]);

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, load]);

  const toggleIn = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (adName: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(adName)) next.delete(adName);
      else next.add(adName);
      return next;
    });
  };

  const toggleAllIn = (
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    current: Set<string>,
    all: TranscriptionAdInfo[]
  ) => {
    if (current.size === all.length) setter(new Set());
    else setter(new Set(all.map((a) => a.ad_name)));
  };

  const untranscribedTotal = status ? status.untranscribed + status.processing : 0;
  const confirmCount = selected.size;
  const forceCount = selectedNoAudio.size;

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

        {isLoading && <TranscriptionStatusSkeleton />}

        {!isLoading && !status && (
          <p className="text-sm text-muted-foreground py-4 text-center">
            Não foi possível carregar o status de transcrição.
          </p>
        )}

        {!isLoading && status && (
          <>
            <AdBreakdownBar status={status} activeTab={activeTab} />

            {status.total_video_ads > 0 && (
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)}>
                <TabsList className="w-full">
                  <TabTriggerContent value="untranscribed" label="Pendentes" count={untranscribedTotal} activeTab={activeTab} />
                  <TabTriggerContent value="transcribed" label="Transcritos" count={status.transcribed} activeTab={activeTab} />
                  <TabTriggerContent value="no_voice" label="Sem áudio" count={status.no_voice} activeTab={activeTab} />
                </TabsList>

                <TabsContent value="untranscribed" className="flex flex-col gap-2 pt-3">
                  {status.untranscribed_ads.length > 0 && (
                    <SelectionHeader
                      selectedCount={confirmCount}
                      totalCount={status.untranscribed_ads.length}
                      onToggleAll={() => toggleAllIn(setSelected, selected, status.untranscribed_ads)}
                    />
                  )}
                  <AdList
                    isEmpty={untranscribedTotal === 0}
                    emptyMessage="Todos os anúncios de vídeo deste pack já foram transcritos ou não têm áudio detectável."
                  >
                    {status.untranscribed_ads.map((ad) => (
                      <AdRow
                        key={ad.ad_name}
                        ad={ad}
                        checked={selected.has(ad.ad_name)}
                        onToggle={() => toggleIn(setSelected)(ad.ad_name)}
                      />
                    ))}
                    {status.processing_ads.map((ad) => (
                      <ProcessingAdRow key={ad.ad_name} ad={ad} />
                    ))}
                  </AdList>
                </TabsContent>

                <TabsContent value="transcribed" className="pt-3">
                  <AdList
                    isEmpty={status.transcribed_ads.length === 0}
                    emptyMessage="Nenhum anúncio transcrito ainda."
                  >
                    {status.transcribed_ads.map((ad) => (
                      <ReadOnlyAdRow key={ad.ad_name} ad={ad} />
                    ))}
                  </AdList>
                </TabsContent>

                <TabsContent value="no_voice" className="flex flex-col gap-2 pt-3">
                  {status.no_voice_ads.length > 0 && (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Nenhum áudio foi detectado nestes vídeos, por isso não são transcritos.
                        Se acha que houve engano, marque e force uma nova tentativa.
                      </p>
                      <SelectionHeader
                        selectedCount={forceCount}
                        totalCount={status.no_voice_ads.length}
                        onToggleAll={() => toggleAllIn(setSelectedNoAudio, selectedNoAudio, status.no_voice_ads)}
                      />
                    </>
                  )}
                  <AdList
                    isEmpty={status.no_voice_ads.length === 0}
                    emptyMessage="Nenhum vídeo sem áudio detectável."
                  >
                    {status.no_voice_ads.map((ad) => (
                      <AdRow
                        key={ad.ad_name}
                        ad={ad}
                        checked={selectedNoAudio.has(ad.ad_name)}
                        onToggle={() => toggleIn(setSelectedNoAudio)(ad.ad_name)}
                      />
                    ))}
                  </AdList>
                </TabsContent>
              </Tabs>
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
          {activeTab === "untranscribed" && (status?.untranscribed ?? 0) > 0 && (
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
          {activeTab === "no_voice" && (status?.no_voice ?? 0) > 0 && (
            <Button
              onClick={() => onForce(Array.from(selectedNoAudio))}
              disabled={forceCount === 0 || isLoading || !status}
              className="flex-1 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <IconRefresh className="h-5 w-5" />
              Forçar {forceCount > 0 ? `${forceCount} ${forceCount === 1 ? "ad" : "ads"}` : "nova tentativa"}
            </Button>
          )}
        </div>
      </div>
    </AppDialog>
  );
}

function TabTriggerContent({
  value,
  label,
  count,
  activeTab,
}: {
  value: TabValue;
  label: string;
  count: number;
  activeTab: TabValue;
}) {
  // `shrink` anula o `shrink-0` da base do TabsTrigger: as 3 abas dividem a
  // largura igualmente e cedem espaço em vez de estourar a lista.
  return (
    <TabsTrigger value={value} className="min-w-0 flex-1 shrink gap-1.5">
      {label}
      <span
        className={cn("text-xs tabular-nums", CATEGORY_COUNT_CLASS[value])}
        style={{ opacity: value === activeTab ? 1 : INACTIVE_CATEGORY_OPACITY }}
      >
        ({count})
      </span>
    </TabsTrigger>
  );
}

function SelectionHeader({
  selectedCount,
  totalCount,
  onToggleAll,
}: {
  selectedCount: number;
  totalCount: number;
  onToggleAll: () => void;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">
        {selectedCount} de {totalCount} selecionado{selectedCount !== 1 ? "s" : ""}
      </span>
      <Button variant="ghost" size="sm" onClick={onToggleAll}>
        {selectedCount === totalCount ? "Desmarcar todos" : "Marcar todos"}
      </Button>
    </div>
  );
}

function AdList({
  isEmpty,
  emptyMessage,
  children,
}: {
  isEmpty: boolean;
  emptyMessage: string;
  children: React.ReactNode;
}) {
  if (isEmpty) {
    return (
      <div className={cn(AD_LIST_BOX, "flex items-center justify-center")}>
        <p className="px-6 text-center text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return <div className={cn(AD_LIST_BOX, "space-y-1")}>{children}</div>;
}

function TranscriptionStatusSkeleton() {
  return (
    <>
      {/* espelha AdBreakdownBar */}
      <div className="flex flex-col gap-2.5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-full rounded-full" />
      </div>

      {/* espelha a barra de abas + linha de seleção + lista de ads */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-control-default w-full rounded-lg" />
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-28" />
        </div>

        <div className={cn(AD_LIST_BOX, "space-y-1 overflow-hidden")}>
          {SKELETON_ROW_WIDTHS.map((width, i) => (
            <div key={i} className="flex items-center gap-3 p-3">
              <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
              <Skeleton className="h-9 w-9 shrink-0 rounded" />
              <Skeleton className={`h-4 ${width}`} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

const SKELETON_ROW_WIDTHS = ["w-3/5", "w-4/5", "w-1/2", "w-2/3"];

interface AdRowProps {
  ad: TranscriptionAdInfo;
  checked: boolean;
  onToggle: () => void;
}

function AdRow({ ad, checked, onToggle }: AdRowProps) {
  return (
    <label className="flex w-full cursor-pointer select-none items-center rounded-md p-3 hover:bg-accent transition-colors gap-3">
      <Checkbox checked={checked} onCheckedChange={() => onToggle()} />
      <Thumbnail url={ad.thumbnail_url} />
      <span className="min-w-0 truncate text-sm text-text flex-1">{ad.ad_name}</span>
    </label>
  );
}

function ProcessingAdRow({ ad }: { ad: TranscriptionAdInfo }) {
  return (
    <div className="flex items-center gap-3 rounded-md p-3 opacity-50">
      <IconLoader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
      <Thumbnail url={ad.thumbnail_url} />
      <span className="min-w-0 truncate text-sm text-text flex-1">{ad.ad_name}</span>
    </div>
  );
}

function ReadOnlyAdRow({ ad }: { ad: TranscriptionAdInfo }) {
  return (
    <div className="flex items-center gap-3 rounded-md p-3">
      <Thumbnail url={ad.thumbnail_url} />
      <span className="min-w-0 truncate text-sm text-text flex-1">{ad.ad_name}</span>
    </div>
  );
}

function Thumbnail({ url }: { url?: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />;
  }
  return <div className="h-9 w-9 shrink-0 rounded bg-input-30" />;
}

function AdBreakdownBar({
  status,
  activeTab,
}: {
  status: PackTranscriptionStatus;
  activeTab: TabValue;
}) {
  const total = status.total_video_ads;
  const untranscribedTotal = status.untranscribed + status.processing;

  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum anúncio de vídeo neste pack.
      </p>
    );
  }

  const barSegments: { key: TabValue; count: number }[] = [
    { key: "transcribed", count: status.transcribed },
    { key: "untranscribed", count: untranscribedTotal },
    { key: "no_voice", count: status.no_voice },
  ];

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
        {barSegments
          .filter((seg) => seg.count > 0)
          .map((seg) => {
            const pct = (seg.count / total) * 100;
            return (
              <div
                key={seg.key}
                className="h-full transition-all"
                style={{
                  width: `max(${pct}%, 6px)`,
                  background: CATEGORY_BAR_BG[seg.key],
                  opacity: seg.key === activeTab ? 1 : INACTIVE_CATEGORY_OPACITY,
                }}
              />
            );
          })}
      </div>
    </div>
  );
}
