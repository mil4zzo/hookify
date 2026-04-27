"use client";

import React, { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { IconAlertCircle, IconLoader2, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";

const CARD_TRANSITION = "900ms cubic-bezier(0.22, 1, 0.36, 1)";
const CONTENT_TRANSITION = "520ms cubic-bezier(0.22, 1, 0.36, 1)";
const PROGRESS_STEP_SIZE = 1;
const MIN_STEP_DELAY_MS = 10;
const MAX_STEP_DELAY_MS = 42;
const VARIANT_ORDER = ["initializing", "loading", "success", "error"] as const;

export type ProgressToastVisualVariant = (typeof VARIANT_ORDER)[number];

export type ProgressToastCardStaged = {
  stageLabel: string;
  stageTitle: string;
  dynamicLine: string;
  stageContext?: string;
};

type ToastCardFrameProps = {
  variant: ProgressToastVisualVariant;
  progress: number;
  animated?: boolean;
  children: ReactNode;
};

type ProgressBarProps = {
  progress: number;
  variant: ProgressToastVisualVariant;
  animated?: boolean;
};

export type ProgressToastCardProps = {
  packName: string;
  progress: number;
  stagedContent?: ProgressToastCardStaged;
  message?: string;
  onCancel?: () => void;
  icon?: ReactNode;
  currentStep: number;
  totalSteps: number;
  inlineError?: boolean;
  cancelling?: boolean;
  animated?: boolean;
  /** Terminal frame: success (progress=100) or error (inlineError). Hides cancel UI on success and shows an icon-only "Fechar" on error. */
  terminal?: boolean;
};

export type PausedToastCardProps = {
  packName: string;
  onReconnect: () => void;
  onCancel: () => void;
  animated?: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function mix(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function getVariant(progress: number, inlineError: boolean, cancelling: boolean): ProgressToastVisualVariant {
  if (cancelling) return "initializing";
  if (inlineError) return "error";
  if (progress >= 100) return "success";
  if (progress <= 0) return "initializing";
  return "loading";
}

function getProgressStepDelay(from: number, to: number) {
  const distance = Math.abs(to - from);
  if (distance <= 0) return MAX_STEP_DELAY_MS;
  return Math.round(clamp(220 / distance, MIN_STEP_DELAY_MS, MAX_STEP_DELAY_MS));
}

function useAnimatedProgress(targetProgress: number, enabled: boolean) {
  const [displayProgress, setDisplayProgress] = useState(targetProgress);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setDisplayProgress(targetProgress);
      return;
    }

    if (displayProgress === targetProgress) return;

    const direction = displayProgress < targetProgress ? 1 : -1;
    timeoutRef.current = setTimeout(
      () => {
        setDisplayProgress((current) => {
          if (current === targetProgress) return current;
          return clamp(current + direction * PROGRESS_STEP_SIZE, 0, 100);
        });
      },
      getProgressStepDelay(displayProgress, targetProgress),
    );

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [displayProgress, enabled, targetProgress]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return displayProgress;
}

function getBackgroundLayerClasses(): Record<ProgressToastVisualVariant, string> {
  return {
    initializing: "neutral-gradient",
    loading: "primary-gradient",
    success: "success-gradient",
    error: "destructive-gradient",
  };
}

function getFrameConfig(variant: ProgressToastVisualVariant, progress: number) {
  if (variant === "success") {
    return {
      ambientShadow: `0 24px 64px color-mix(in oklab, var(--neutral-950) 55%, transparent),
        0 8px 28px color-mix(in oklab, var(--success-400) 14%, transparent)`,
      surfaceOpacity: 0.18,
      sheenOpacity: 0.12,
      glowPulse: 1,
    };
  }

  if (variant === "error") {
    return {
      ambientShadow: `0 24px 64px color-mix(in oklab, var(--neutral-950) 58%, transparent),
        0 8px 28px color-mix(in oklab, var(--destructive-400) 14%, transparent)`,
      surfaceOpacity: 0.17,
      sheenOpacity: 0.11,
      glowPulse: 1.01,
    };
  }

  if (variant === "initializing") {
    return {
      ambientShadow: `0 24px 64px color-mix(in oklab, var(--neutral-950) 52%, transparent),
        0 8px 24px color-mix(in oklab, var(--surface-fill) 8%, transparent)`,
      surfaceOpacity: 0.1,
      sheenOpacity: 0.08,
      glowPulse: 0.94,
    };
  }

  const t = progress / 100;
  return {
    ambientShadow: `0 24px 64px color-mix(in oklab, var(--neutral-950) 50%, transparent),
      0 8px 30px color-mix(in oklab, var(--primary-600) ${Math.round(mix(6, 16, t))}%, transparent)`,
    surfaceOpacity: mix(0.12, 0.18, t),
    sheenOpacity: mix(0.09, 0.14, t),
    glowPulse: mix(0.98, 1.06, t),
  };
}

function ToastCardFrame({ variant, progress, animated = true, children }: ToastCardFrameProps) {
  const { ambientShadow, glowPulse } = getFrameConfig(variant, progress);
  const backgroundClasses = getBackgroundLayerClasses();

  return (
    <div
      className="relative w-[22rem] max-w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-lg border border-primary-foreground-10"
      style={{
        boxShadow: ambientShadow,
        transition: animated ? `box-shadow ${CARD_TRANSITION}` : undefined,
      }}
    >
      {VARIANT_ORDER.map((key, index) => (
        <div
          key={`bg-${key}`}
          className={cn("pointer-events-none absolute inset-0", backgroundClasses[key])}
          style={{
            opacity: variant === key ? 1 : 0,
            zIndex: index,
            transition: `opacity ${CARD_TRANSITION}`,
          }}
        />
      ))}

      {VARIANT_ORDER.map((key, index) => (
        <div
          key={`glow-${key}`}
          className="pointer-events-none absolute inset-0"
          style={{
            opacity: variant === key ? 1 : 0,
            zIndex: 4 + index,
            transform: `scale(${variant === key ? glowPulse : 1})`,
            transformOrigin: "50% 85%",
            transition: `opacity ${CARD_TRANSITION}, transform ${CARD_TRANSITION}`,
          }}
        />
      ))}

      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[46%]"
        style={{
          zIndex: 10,
          background: "linear-gradient(180deg, color-mix(in oklab, var(--surface-fill) 14%, transparent), color-mix(in oklab, var(--surface-fill) 4%, transparent) 34%, transparent 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 rounded-lg"
        style={{
          zIndex: 11,
          boxShadow: "inset 0 1px 0 color-mix(in oklab, var(--surface-fill) 18%, transparent), inset 0 -1px 0 color-mix(in oklab, var(--neutral-950) 8%, transparent)",
        }}
      />

      <div className="relative z-20">{children}</div>
    </div>
  );
}

function ProgressBar({ progress, variant, animated = true }: ProgressBarProps) {
  const numericProgress = clamp(Math.round(progress), 0, 100);
  const { surfaceOpacity, sheenOpacity } = getFrameConfig(variant, numericProgress);
  const progressLabel = `${numericProgress}%`;
  const labelInsideFill = numericProgress > 33;
  const labelInsideProgress = clamp((numericProgress - 28) / 10, 0, 1);
  const outsideOffset = mix(12, 2, labelInsideProgress);

  const percentLabelClass = variant === "success" ? "text-success-400" : variant === "initializing" ? "text-primary-foreground" : variant === "loading" && !labelInsideFill ? "text-primary-foreground" : "text-primary";

  return (
    <div className="relative">
      <div
        className="relative h-[3.25rem] w-full rounded-md border border-primary-foreground-10 px-1 py-1 backdrop-blur-md"
        style={{
          background: `color-mix(in oklab, var(--surface-fill) ${Math.round(surfaceOpacity * 100)}%, transparent)`,
          boxShadow: "inset 0 1px 0 color-mix(in oklab, var(--surface-fill) 14%, transparent), inset 0 -1px 0 color-mix(in oklab, var(--neutral-950) 6%, transparent), 0 12px 36px color-mix(in oklab, var(--neutral-950) 35%, transparent)",
          transition: animated ? `background ${CARD_TRANSITION}, box-shadow ${CARD_TRANSITION}` : undefined,
        }}
      >
        <div className="relative h-full w-full overflow-visible rounded-md">
          <div
            className="pointer-events-none absolute left-0 right-0 top-0 h-[42%] rounded-md"
            style={{
              background: `linear-gradient(180deg, color-mix(in oklab, var(--surface-fill) ${Math.round(sheenOpacity * 100)}%, transparent), transparent 100%)`,
              transition: animated ? `opacity ${CONTENT_TRANSITION}` : undefined,
            }}
          />

          {variant === "success" && (
            <>
              <div
                className="absolute inset-y-0 left-0 rounded-md bg-primary-foreground"
                style={{
                  width: "100%",
                  boxShadow: "0 6px 18px color-mix(in oklab, var(--surface-fill) 18%, transparent), 0 0 22px color-mix(in oklab, var(--surface-fill) 22%, transparent)",
                }}
              />
              <div className="absolute inset-y-0 right-3 flex items-center justify-end text-2xl font-semibold tabular-nums leading-none tracking-tight text-success-400">{progressLabel}</div>
            </>
          )}

          {variant !== "success" && numericProgress > 0 && (
            <>
              <div
                className="absolute inset-y-0 left-0 rounded-md bg-primary-foreground"
                style={{
                  width: `${numericProgress}%`,
                  minWidth: "4px",
                  boxShadow: "0 6px 18px color-mix(in oklab, var(--surface-fill) 18%, transparent), 0 0 22px color-mix(in oklab, var(--surface-fill) 22%, transparent)",
                  transition: animated ? `width ${CONTENT_TRANSITION}` : undefined,
                }}
              />
              <div
                className={cn("absolute inset-y-0 flex items-center text-2xl font-semibold tabular-nums leading-none tracking-tight", percentLabelClass)}
                style={
                  labelInsideFill
                    ? {
                        left: `${numericProgress}%`,
                        transform: "translateX(calc(-100% - 10px))",
                        transition: animated ? `left ${CONTENT_TRANSITION}, color ${CONTENT_TRANSITION}` : undefined,
                      }
                    : {
                        left: `${numericProgress}%`,
                        transform: `translateX(${outsideOffset}px)`,
                        transition: animated ? `left ${CONTENT_TRANSITION}, color ${CONTENT_TRANSITION}` : undefined,
                      }
                }
              >
                {progressLabel}
              </div>
            </>
          )}

          {variant !== "success" && numericProgress === 0 && <div className="absolute inset-y-0 left-0 flex items-center justify-start pl-3 text-2xl font-semibold tabular-nums leading-none tracking-tight text-primary-foreground">{progressLabel}</div>}
        </div>
      </div>

      <div className="mt-1.5 flex justify-between px-0.5 text-[10px] font-medium tabular-nums text-primary-foreground-45">
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100</span>
      </div>
    </div>
  );
}

export function ProgressToastCard({ packName, progress, stagedContent, message, onCancel, icon, currentStep, totalSteps, inlineError = false, cancelling = false, animated = true, terminal = false }: ProgressToastCardProps) {
  const targetProgress = clamp(Math.round(progress), 0, 100);
  const animatedProgress = useAnimatedProgress(targetProgress, animated && !inlineError && !cancelling);
  const variant = useMemo(() => getVariant(inlineError || cancelling ? targetProgress : animatedProgress, inlineError, cancelling), [animatedProgress, cancelling, inlineError, targetProgress]);

  const hasStagedLayout = Boolean(stagedContent?.stageLabel && stagedContent?.stageTitle && stagedContent?.dynamicLine !== undefined);
  const staged = hasStagedLayout ? stagedContent : undefined;

  const eyebrow = staged ? (staged.stageContext ? `${packName}: ${staged.stageContext} › ${staged.stageLabel}` : `Atualizando ${packName} — ${staged.stageLabel}`) : `${packName} — etapa ${currentStep}/${totalSteps}`;

  const titleText = staged ? staged.stageTitle : "Processando";
  const dynamicLine = staged ? staged.dynamicLine : message || "...";
  const isSuccess = variant === "success";
  const showBar = !cancelling && !inlineError;
  const showTerminalCloseButton = terminal && inlineError && Boolean(onCancel);
  const showTransientErrorCancelButton = !terminal && inlineError && Boolean(onCancel);
  const showLoadingCancelButton = showBar && Boolean(onCancel) && !(terminal && isSuccess);

  return (
    <ToastCardFrame variant={variant} progress={animatedProgress} animated={animated}>
      <div className="flex flex-col gap-3 px-4 pb-4 pt-3 text-primary-foreground" role="status" aria-live="polite" aria-valuemin={0} aria-valuemax={100} aria-valuenow={showBar ? animatedProgress : undefined}>
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex-shrink-0 [&_svg]:h-4 [&_svg]:w-4">{cancelling ? <IconLoader2 className="animate-spin opacity-90" /> : icon || <IconLoader2 className="animate-spin opacity-90" />}</span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[11px] font-medium leading-tight text-primary-foreground-75">{eyebrow}</p>
            <p className="text-sm font-semibold leading-snug tracking-tight text-primary-foreground">{titleText}</p>

            {cancelling ? (
              <p className="pt-0.5 text-xs font-medium leading-snug text-primary-foreground-90">
                Cancelando atualização de <strong className="font-semibold text-primary-foreground">{packName}</strong>...
              </p>
            ) : inlineError ? (
              <p className="pt-0.5 text-xs font-medium leading-snug text-destructive-300">{dynamicLine}</p>
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 pt-0.5">
                <span className="text-2xl font-semibold tabular-nums leading-none tracking-tight text-primary-foreground">{animatedProgress}%</span>
                <span className="text-xl font-semibold leading-none text-primary-foreground-40">•</span>
                <span className="min-w-0 text-xs font-medium leading-snug text-primary-foreground-88">{dynamicLine}</span>
              </div>
            )}
          </div>

          {showTerminalCloseButton && (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Fechar"
              className="ml-1 flex-shrink-0 rounded p-1 text-primary-foreground-75 hover:bg-primary-foreground-10 hover:text-primary-foreground focus:outline-none focus:ring-1 focus:ring-primary-foreground-30"
            >
              <IconX className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </div>

        {showTransientErrorCancelButton && (
          <div className="flex justify-end pt-1">
            <Button type="button" size="sm" variant="secondary" className="h-8 border-primary-foreground-20 bg-primary-foreground-10 text-primary-foreground hover:bg-primary-foreground-20" onClick={onCancel}>
              Cancelar
            </Button>
          </div>
        )}

        {showBar && <ProgressBar progress={animatedProgress} variant={variant} animated={animated} />}

        {showLoadingCancelButton && (
          <div className="flex justify-end">
            <Button type="button" size="sm" variant="ghost" className="h-8 text-primary-foreground-90 hover:bg-primary-foreground-10 hover:text-primary-foreground" onClick={onCancel}>
              Cancelar
            </Button>
          </div>
        )}
      </div>
    </ToastCardFrame>
  );
}

export function PausedToastCard({ packName, onReconnect, onCancel, animated = true }: PausedToastCardProps) {
  return (
    <ToastCardFrame variant="initializing" progress={0} animated={animated}>
      <div className="flex flex-col gap-4 px-4 pb-4 pt-3 text-primary-foreground" role="alert" aria-live="assertive">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 flex-shrink-0 text-attention [&_svg]:h-4 [&_svg]:w-4">
            <IconAlertCircle />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[11px] font-medium leading-tight text-primary-foreground-75">{packName}: Leadscore</p>
            <p className="text-sm font-semibold leading-snug tracking-tight text-attention">Sincronização pausada</p>
            <p className="pt-0.5 text-sm leading-snug text-primary-foreground-82">Aguardando reconexão do Google para continuar a importação.</p>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" size="sm" variant="primary" shadow="md" onClick={onReconnect}>
            Reconectar Google
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </div>
    </ToastCardFrame>
  );
}
