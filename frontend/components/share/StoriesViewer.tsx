"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  IconBrandParsinta,
  IconChartFunnel,
  IconChevronDown,
  IconChevronUp,
  IconCurrencyDollar,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerPlayFilled,
  IconVolume,
  IconVolumeOff,
  IconWorld,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";
import { getSiteOrigin } from "@/lib/utils/siteUrl";
import { PublicMetricCell } from "@/components/share/PublicMetricCell";
import {
  SHARE_METRIC_SECTIONS,
  findMetricCardConfig,
  hasMetric,
} from "@/lib/share/metricsDisplay";
import type { PublicShare, ShareItem } from "@/lib/share/types";

// Gramática de stories padrão (Instagram/WhatsApp): segmentos no topo, tap
// direita/esquerda navega, segurar pausa, painel de métricas na base. A
// identidade Hookify entra pelos tokens (bg-background, primary, Geist).

const IMAGE_DURATION_MS = 7000;
const TAP_MAX_MS = 300;
const SWIPE_UP_MIN_PX = 60;

// Zonas de toque na mídia (fração da largura). O centro pausa/retoma — daí
// prev/next ficarem nas bordas, ainda com alvo confortável no polegar.
const TAP_ZONE_PREV_MAX = 0.35;
const TAP_ZONE_PAUSE_MAX = 0.65;

const SECTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Resultados: IconCurrencyDollar,
  Funil: IconChartFunnel,
  Retenção: IconBrandParsinta,
  Visibilidade: IconWorld,
};

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
  // Pausa deliberada (botão do topo ou toque no centro). STICKY: sobrevive à
  // troca de slide — o usuário navega pausado e o tempo nunca corre sozinho.
  const [isUserPaused, setIsUserPaused] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [isMetricsExpanded, setIsMetricsExpanded] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const pointerStartRef = useRef<{ t: number; x: number; y: number } | null>(null);

  const current = items[index];
  const expired = isVideoExpired(current);
  const hasPlayableVideo = current.media.type === "video" && !!current.media.video_url && !expired;
  const isPaused = isHolding || isUserPaused || isMetricsExpanded;

  const metrics = current.metrics || {};
  const averages = share.averages || {};
  const highlights = (share.highlight_metrics || []).filter((key) => hasMetric(metrics, key));

  const goTo = useCallback(
    (target: number) => {
      setIsMetricsExpanded(false);
      setIndex(Math.max(0, Math.min(target, items.length - 1)));
    },
    [items.length],
  );
  const next = useCallback(() => goTo(index + 1), [goTo, index]);
  const prev = useCallback(() => goTo(index - 1), [goTo, index]);

  // Pausa/retoma o vídeo junto com o estado do viewer
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !hasPlayableVideo) return;
    if (isPaused) el.pause();
    else el.play().catch(() => {});
  }, [isPaused, hasPlayableVideo, index]);

  // Teclado (desktop): setas navegam, espaço pausa, Esc fecha o painel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") prev();
      else if (e.key === "Escape") setIsMetricsExpanded(false);
      else if (e.key === " ") {
        e.preventDefault();
        setIsUserPaused((p) => !p);
      }
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
        setIsMetricsExpanded(true);
        return;
      }
      if (performance.now() - start.t > TAP_MAX_MS) return; // hold = pausa transitória, não navega
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      if (relX < TAP_ZONE_PREV_MAX) prev();
      else if (relX < TAP_ZONE_PAUSE_MAX) setIsUserPaused((p) => !p);
      else next();
    },
    [next, prev],
  );

  const handlePointerCancel = useCallback(() => {
    pointerStartRef.current = null;
    setIsHolding(false);
  }, []);

  const visibleSections = SHARE_METRIC_SECTIONS.map((section) => ({
    ...section,
    cards: section.cards.filter((card) => hasMetric(metrics, card.key)),
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

          {/* Indicador de pausa: play centralizado (o toque no centro retoma). */}
          {isUserPaused && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-full bg-background-60 p-4 shadow-elevation-overlay">
                <IconPlayerPlayFilled className="h-9 w-9 text-text" />
              </div>
            </div>
          )}
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
              <button
                type="button"
                aria-label={isUserPaused ? "Retomar" : "Pausar"}
                className="pointer-events-auto rounded-full bg-background-60 p-1.5 text-text"
                onClick={() => setIsUserPaused((p) => !p)}
              >
                {isUserPaused ? <IconPlayerPlay className="h-4 w-4" /> : <IconPlayerPause className="h-4 w-4" />}
              </button>
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

        {/* Backdrop do painel expandido (toque fora colapsa) */}
        {isMetricsExpanded && (
          <button
            type="button"
            aria-label="Fechar métricas"
            className="absolute inset-0 z-20 bg-background-60"
            onClick={() => setIsMetricsExpanded(false)}
          />
        )}

        {/*
          Painel de métricas em DUAS ALTURAS (mesmo container): espiado mostra
          só os destaques; expandido revela as 4 seções. Translúcido para a
          mídia continuar respirando por trás no estado espiado.
        */}
        <div
          className={cn(
            // bg-card (não translúcido): o `card` não tem escala de alpha registrada,
            // e o par card/background é o mesmo contraste dos cards do modal.
            "absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-lg border-t border-border bg-card transition-[max-height] duration-300",
            isMetricsExpanded ? "max-h-[85%]" : "max-h-[45%]",
          )}
        >
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 pb-1.5 pt-2 text-left"
            onClick={() => setIsMetricsExpanded((v) => !v)}
            aria-expanded={isMetricsExpanded}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{current.ad_name}</p>
              <p className="text-2xs text-muted-foreground">
                {isMetricsExpanded
                  ? `${formatDatePt(share.date_start)}–${formatDatePt(share.date_stop)} · snapshot na criação do link`
                  : "Ver todas as métricas"}
              </p>
            </div>
            {isMetricsExpanded ? (
              <IconChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <IconChevronUp className="h-4 w-4 shrink-0 animate-bounce text-muted-foreground" />
            )}
          </button>

          {/* Espiado: só os destaques escolhidos na criação do link */}
          {!isMetricsExpanded && highlights.length > 0 && (
            <div className={cn("grid gap-2 px-3 pb-2", highlights.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
              {highlights.map((key) => {
                const config = findMetricCardConfig(key);
                const subtitleValue = config.subtitleOf != null ? metrics[config.subtitleOf] : null;
                return (
                  <PublicMetricCell
                    key={key}
                    metricKey={key}
                    value={metrics[key] as number}
                    average={averages[key]}
                    currency={share.currency}
                    subtitle={
                      typeof subtitleValue === "number"
                        ? `${Math.round(subtitleValue).toLocaleString("pt-BR")} ${config.subtitleLabel ?? ""}`.trim()
                        : undefined
                    }
                  />
                );
              })}
            </div>
          )}

          {/* Expandido: as 4 seções do modal de detalhamento */}
          {isMetricsExpanded && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-3">
              {visibleSections.map((section) => {
                const SectionIcon = SECTION_ICONS[section.title];
                return (
                  <div key={section.title} className="space-y-2">
                    <div className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                      {SectionIcon ? <SectionIcon className="h-4 w-4 flex-shrink-0" /> : null}
                      <span>{section.title}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {section.cards.map((card) => {
                        const subtitleValue = card.subtitleOf != null ? metrics[card.subtitleOf] : null;
                        return (
                          <PublicMetricCell
                            key={card.key}
                            metricKey={card.key}
                            value={metrics[card.key] as number}
                            average={averages[card.key]}
                            currency={share.currency}
                            subtitle={
                              typeof subtitleValue === "number"
                                ? `${Math.round(subtitleValue).toLocaleString("pt-BR")} ${card.subtitleLabel ?? ""}`.trim()
                                : undefined
                            }
                          />
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
          )}

          <a
            href={`${getSiteOrigin()}/pv`}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 border-t border-border py-1.5 text-center text-2xs text-muted-foreground hover:text-text"
          >
            Feito com <span className="font-semibold text-brand">Hookify</span>
          </a>
        </div>
      </div>
    </div>
  );
}
