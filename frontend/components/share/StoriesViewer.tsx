"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  IconBrandParsinta,
  IconChartFunnel,
  IconChevronUp,
  IconCurrencyDollar,
  IconVolume,
  IconVolumeOff,
  IconWorld,
  IconX,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";
import { getSiteOrigin } from "@/lib/utils/siteUrl";
import type { PublicShare, ShareItem, ShareMetricKey } from "@/lib/share/types";

// Gramática de stories padrão (Instagram/WhatsApp): segmentos no topo, tap
// direita/esquerda navega, segurar pausa, swipe-up abre métricas. A identidade
// Hookify entra pelos tokens (bg-background, primary, Geist) e pelo rodapé.

const IMAGE_DURATION_MS = 7000;
const TAP_MAX_MS = 300;
const SWIPE_UP_MIN_PX = 60;

// ── Formatação (espelho do modal de detalhamento; snapshot usa a escala da linha) ──

const METRIC_LABELS: Record<ShareMetricKey, string> = {
  cpmql: "CPMQL",
  cpr: "CPR",
  cpc: "CPC",
  cpm: "CPM",
  ctr: "CTR",
  website_ctr: "Link CTR",
  connect_rate: "Connect Rate",
  page_conv: "Page Conv",
  scroll_stop: "Scroll Stop",
  hook: "Hook",
  hold_rate: "Hold Rate",
  video_watched_p50: "50% View",
  spend: "Spend",
  frequency: "Frequency",
  impressions: "Impressions",
  reach: "Reach",
  results: "Resultados",
  clicks: "Cliques",
  mql_count: "MQLs",
};

const CURRENCY_KEYS = new Set<ShareMetricKey>(["cpmql", "cpr", "cpc", "cpm", "spend"]);
const FRACTION_PCT_KEYS = new Set<ShareMetricKey>(["ctr", "website_ctr", "connect_rate", "page_conv", "scroll_stop", "hook", "hold_rate"]);

function formatMetric(key: ShareMetricKey, value: number, currency: string | null): string {
  if (CURRENCY_KEYS.has(key)) {
    try {
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(value);
    } catch {
      return value.toFixed(2);
    }
  }
  if (FRACTION_PCT_KEYS.has(key)) return `${(value * 100).toFixed(2)}%`;
  if (key === "video_watched_p50") return `${Math.round(value)}%`;
  if (key === "frequency") return value.toFixed(2);
  return Math.round(value).toLocaleString("pt-BR");
}

interface SectionConfig {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  cards: Array<{ key: ShareMetricKey; subtitleOf?: ShareMetricKey; subtitleLabel?: string }>;
}

// Mesmas 4 seções e 16 métricas do AdDetailsDialog (aba Geral)
const SECTIONS: SectionConfig[] = [
  {
    title: "Resultados",
    icon: IconCurrencyDollar,
    cards: [
      { key: "cpmql", subtitleOf: "mql_count", subtitleLabel: "MQLs" },
      { key: "cpr", subtitleOf: "results", subtitleLabel: "resultados" },
      { key: "cpc", subtitleOf: "clicks", subtitleLabel: "cliques" },
      { key: "cpm" },
    ],
  },
  {
    title: "Funil",
    icon: IconChartFunnel,
    cards: [{ key: "ctr" }, { key: "website_ctr" }, { key: "connect_rate" }, { key: "page_conv" }],
  },
  {
    title: "Retenção",
    icon: IconBrandParsinta,
    cards: [{ key: "scroll_stop" }, { key: "hook" }, { key: "hold_rate" }, { key: "video_watched_p50" }],
  },
  {
    title: "Visibilidade",
    icon: IconWorld,
    cards: [{ key: "spend" }, { key: "frequency" }, { key: "impressions" }, { key: "reach" }],
  },
];

function formatDatePt(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function isVideoExpired(item: ShareItem): boolean {
  const media = item.media;
  if (media.type !== "video") return false;
  if (!media.video_url) return true;
  if (!media.video_expires_at) return false;
  const expiry = new Date(media.video_expires_at).getTime();
  return Number.isFinite(expiry) && expiry <= Date.now();
}

// ── Progresso do segmento ativo ──────────────────────────────────────────────

/** Preenchimento por timer (imagens e slides degradados). Isolado para o RAF não re-renderizar o viewer. */
function TimedSegmentFill({ paused, resetKey, onComplete }: { paused: boolean; resetKey: number; onComplete: () => void }) {
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    progressRef.current = 0;
    setProgress(0);
  }, [resetKey]);

  useEffect(() => {
    if (paused) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = Math.min(1, progressRef.current + (now - last) / IMAGE_DURATION_MS);
      last = now;
      progressRef.current = next;
      setProgress(next);
      if (next >= 1) {
        onCompleteRef.current();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused, resetKey]);

  return <div className="h-full rounded-full bg-primary" style={{ width: `${progress * 100}%` }} />;
}

/** Preenchimento dirigido pelo próprio vídeo (timeupdate ~4Hz, como no WhatsApp). */
function VideoSegmentFill({ videoRef, resetKey }: { videoRef: React.RefObject<HTMLVideoElement | null>; resetKey: number }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    setProgress(0);
    const el = videoRef.current;
    if (!el) return;
    const onTime = () => {
      if (el.duration > 0) setProgress(Math.min(1, el.currentTime / el.duration));
    };
    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, [resetKey, videoRef]);

  return <div className="h-full rounded-full bg-primary" style={{ width: `${progress * 100}%` }} />;
}

// ── Viewer ───────────────────────────────────────────────────────────────────

export function StoriesViewer({ share }: { share: PublicShare }) {
  const items = share.items;
  const [index, setIndex] = useState(0);
  const [isHolding, setIsHolding] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isMetricsOpen, setIsMetricsOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pointerStartRef = useRef<{ t: number; x: number; y: number } | null>(null);

  const current = items[index];
  const expired = isVideoExpired(current);
  const hasPlayableVideo = current.media.type === "video" && !!current.media.video_url && !expired;
  const isPaused = isHolding || isMetricsOpen;

  const goTo = useCallback(
    (target: number) => {
      setIsMetricsOpen(false);
      setIndex(Math.max(0, Math.min(target, items.length - 1)));
    },
    [items.length],
  );
  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);

  // Pausa/retoma o vídeo junto com o estado do viewer (hold ou métricas abertas)
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !hasPlayableVideo) return;
    if (isPaused) el.pause();
    else el.play().catch(() => {});
  }, [isPaused, hasPlayableVideo, index]);

  // Teclado (desktop): setas navegam, Esc fecha métricas
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "Escape") setIsMetricsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerStartRef.current = { t: performance.now(), x: e.clientX, y: e.clientY };
    setIsHolding(true);
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const start = pointerStartRef.current;
      pointerStartRef.current = null;
      setIsHolding(false);
      if (!start) return;
      const deltaY = e.clientY - start.y;
      if (deltaY < -SWIPE_UP_MIN_PX) {
        setIsMetricsOpen(true);
        return;
      }
      if (performance.now() - start.t > TAP_MAX_MS) return; // hold = pausa, não navega
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      if (relX < 0.3) prev();
      else next();
    },
    [next, prev],
  );

  const handlePointerCancel = useCallback(() => {
    pointerStartRef.current = null;
    setIsHolding(false);
  }, []);

  const metrics = current.metrics || {};
  const visibleSections = SECTIONS.map((section) => ({
    ...section,
    cards: section.cards.filter((card) => typeof metrics[card.key] === "number"),
  })).filter((section) => section.cards.length > 0);

  return (
    <div className="fixed inset-0 z-overlay flex items-center justify-center overflow-hidden bg-background text-text">
      {/* Glow de marca atrás do frame (desktop) — a pitada Hookify */}
      <div aria-hidden className="pointer-events-none absolute hidden h-2/3 w-96 rounded-full bg-primary-20 blur-3xl sm:block" />

      {/* Frame 9:16: fullscreen no mobile, moldura centrada no desktop */}
      <div className="relative h-[100dvh] w-full overflow-hidden bg-black sm:h-[92dvh] sm:w-auto sm:aspect-[9/16] sm:rounded-lg sm:shadow-elevation-overlay">
        {/* Mídia + tap zones */}
        <div
          className="absolute inset-0 touch-none select-none"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div key={index} className="h-full w-full">
            {hasPlayableVideo ? (
              <video
                ref={videoRef}
                src={current.media.video_url ?? undefined}
                poster={current.media.thumbnail_url ?? undefined}
                muted={isMuted}
                playsInline
                autoPlay
                onEnded={next}
                className="h-full w-full object-contain"
              />
            ) : expired ? (
              <div className="relative flex h-full w-full items-center justify-center">
                {current.media.thumbnail_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={current.media.thumbnail_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40 blur-md" />
                )}
                <div className="relative mx-6 space-y-2 rounded-lg bg-background-80 p-4 text-center shadow-elevation-overlay">
                  <p className="text-3xl" aria-hidden>
                    ⏳
                  </p>
                  <p className="text-sm font-semibold">Esse vídeo expirou 😴</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    A CDN da Meta aposentou o link. Peça um link atualizado no Hookify ;)
                  </p>
                  <p className="text-2xs text-muted-foreground">As métricas continuam logo abaixo 👇</p>
                </div>
              </div>
            ) : current.media.image_url || current.media.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={current.media.image_url ?? current.media.thumbnail_url ?? undefined}
                alt={current.ad_name}
                className="h-full w-full object-contain"
                draggable={false}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">Sem prévia disponível</div>
            )}
          </div>
        </div>

        {/* Header: segmentos + logo + contagem/período (gradiente para legibilidade) */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-overlay to-transparent px-3 pb-8 pt-3">
          <div className="flex gap-1">
            {items.map((_, i) => (
              <div key={i} className="h-0.5 flex-1 overflow-hidden rounded-full bg-foreground-30">
                {i < index ? (
                  <div className="h-full w-full rounded-full bg-primary" />
                ) : i === index ? (
                  hasPlayableVideo ? (
                    <VideoSegmentFill videoRef={videoRef} resetKey={index} />
                  ) : (
                    <TimedSegmentFill paused={isPaused} resetKey={index} onComplete={next} />
                  )
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <Image src="/logo-hookify-alpha.png" alt="Hookify" width={80} height={21} className="h-[21px] w-[80px]" priority />
            <div className="flex items-center gap-2">
              <span className="text-2xs text-muted-foreground">
                {index + 1}/{items.length} · {formatDatePt(share.date_start)}–{formatDatePt(share.date_stop)}
              </span>
              {hasPlayableVideo && (
                <button
                  type="button"
                  aria-label={isMuted ? "Ativar som" : "Silenciar"}
                  className="pointer-events-auto rounded-full bg-background-60 p-1.5 text-text"
                  onClick={() => setIsMuted((m) => !m)}
                >
                  {isMuted ? <IconVolumeOff className="h-4 w-4" /> : <IconVolume className="h-4 w-4" />}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Rodapé: nome do criativo + CTA de métricas + marca */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-overlay to-transparent px-4 pb-3 pt-10 text-center">
          <p className="truncate text-sm font-medium">{current.ad_name}</p>
          <button
            type="button"
            className="pointer-events-auto mx-auto mt-1 flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-text"
            onClick={() => setIsMetricsOpen(true)}
          >
            <IconChevronUp className="h-4 w-4 animate-bounce" />
            Ver métricas
          </button>
          <a
            href={`${getSiteOrigin()}/pv`}
            target="_blank"
            rel="noopener noreferrer"
            className="pointer-events-auto mt-1 inline-block text-2xs text-muted-foreground hover:text-text"
          >
            Feito com <span className="font-semibold text-brand">Hookify</span>
          </a>
        </div>

        {/* Backdrop das métricas (fecha ao tocar fora) */}
        {isMetricsOpen && (
          <button
            type="button"
            aria-label="Fechar métricas"
            className="absolute inset-0 z-20 bg-background-60"
            onClick={() => setIsMetricsOpen(false)}
          />
        )}

        {/* Sheet de métricas — mesmas 4 seções do modal de detalhamento */}
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 z-30 max-h-[75%] overflow-y-auto rounded-t-lg border-t border-border bg-card p-4 shadow-elevation-overlay transition-transform duration-300",
            isMetricsOpen ? "translate-y-0" : "translate-y-full",
          )}
          aria-hidden={!isMetricsOpen}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{current.ad_name}</p>
              <p className="text-2xs text-muted-foreground">
                {formatDatePt(share.date_start)}–{formatDatePt(share.date_stop)} · snapshot na criação do link
              </p>
            </div>
            <button
              type="button"
              aria-label="Fechar métricas"
              className="rounded-full p-1 text-muted-foreground hover:text-text"
              onClick={() => setIsMetricsOpen(false)}
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4">
            {visibleSections.map((section) => {
              const SectionIcon = section.icon;
              return (
                <div key={section.title} className="space-y-2">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                    <SectionIcon className="h-4 w-4 flex-shrink-0" />
                    <span>{section.title}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {section.cards.map((card) => {
                      const value = metrics[card.key] as number;
                      const subtitleValue = card.subtitleOf != null ? metrics[card.subtitleOf] : null;
                      return (
                        <div key={card.key} className="rounded-md border border-border bg-background p-2">
                          <p className="text-2xs text-muted-foreground">{METRIC_LABELS[card.key]}</p>
                          <p className="text-base font-semibold">{formatMetric(card.key, value, share.currency)}</p>
                          {typeof subtitleValue === "number" && (
                            <p className="text-2xs text-muted-foreground">
                              {Math.round(subtitleValue).toLocaleString("pt-BR")} {card.subtitleLabel}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {visibleSections.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">Sem métricas disponíveis para este criativo.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
