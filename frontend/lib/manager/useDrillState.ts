"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";

export type DrillKind = "campaign" | "adset" | "adname";

export interface DrillStep {
  kind: DrillKind;
  id: string;
}

export interface ResolvedDrillStep extends DrillStep {
  name: string | null;
}

const KIND_TO_TOKEN: Record<DrillKind, string> = {
  campaign: "c",
  adset: "s",
  adname: "a",
};

const TOKEN_TO_KIND: Record<string, DrillKind> = {
  c: "campaign",
  s: "adset",
  a: "adname",
};

const DRILL_PARAM = "drill";
const STEP_SEP = ",";
const KV_SEP = ":";
const NAME_CACHE_KEY = "hookify-drill-names";

function encodeStack(stack: DrillStep[]): string {
  return stack
    .map((s) => `${KIND_TO_TOKEN[s.kind]}${KV_SEP}${encodeURIComponent(s.id)}`)
    .join(STEP_SEP);
}

function decodeStack(raw: string | null | undefined): DrillStep[] {
  if (!raw) return [];
  return raw
    .split(STEP_SEP)
    .map((part) => {
      const idx = part.indexOf(KV_SEP);
      if (idx < 0) return null;
      const token = part.slice(0, idx);
      const id = part.slice(idx + 1);
      const kind = TOKEN_TO_KIND[token];
      if (!kind || !id) return null;
      try {
        return { kind, id: decodeURIComponent(id) } as DrillStep;
      } catch {
        return null;
      }
    })
    .filter((step): step is DrillStep => step !== null);
}

function nameCacheKey(step: DrillStep): string {
  return `${step.kind}:${step.id}`;
}

function readNameCache(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(NAME_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeNameCache(cache: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(NAME_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota errors — names are best-effort
  }
}

// ── Overlay otimista (compartilhado entre a tabela e o modal) ─────────────────
// Abrir o drill dependia do commit de router.push; com a tabela pesada essa
// navegacao fica presa atras de renders nao-urgentes e o modal so aparecia apos
// varios cliques. Este store externo abre o modal de forma SINCRONA no clique,
// mantendo a URL como fonte de verdade (sincronizada logo em seguida).
let optimisticStack: DrillStep[] | null = null;
const overlayListeners = new Set<() => void>();

function setOptimisticStack(next: DrillStep[] | null): void {
  optimisticStack = next;
  overlayListeners.forEach((listener) => listener());
}

function subscribeOverlay(listener: () => void): () => void {
  overlayListeners.add(listener);
  return () => {
    overlayListeners.delete(listener);
  };
}

function getOptimisticSnapshot(): DrillStep[] | null {
  return optimisticStack;
}

export interface UseDrillStateResult {
  stack: ResolvedDrillStep[];
  isOpen: boolean;
  current: ResolvedDrillStep | null;
  /** Push a new drill level. Pass `name` so breadcrumb can render a friendly label. */
  push: (step: DrillStep & { name?: string | null }) => void;
  /**
   * Abre o modal já com a cadeia completa (ex.: campanha → conjunto ao clicar numa
   * linha da aba "Por conjunto"). Substitui a pilha atual — o breadcrumb passa a
   * mostrar a hierarquia inteira mesmo sem o usuário ter navegado por ela.
   */
  openChain: (steps: (DrillStep & { name?: string | null })[]) => void;
  /** Truncate stack to keep only steps up to (and including) the given index. */
  popTo: (index: number) => void;
  /** Close the modal entirely. */
  close: () => void;
  /** Update the cached name for an already-pushed step (e.g. after fetching). */
  setName: (step: DrillStep, name: string | null) => void;
}

export function useDrillState(): UseDrillStateResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rawStack = useMemo(() => decodeStack(searchParams.get(DRILL_PARAM)), [searchParams]);

  // O clique grava aqui de forma sincrona; effectiveRaw abre o modal na hora. Quando
  // o searchParams alcanca o valor otimista, descartamos o overlay (convergencia sem
  // flicker) e a URL volta a ser a unica fonte.
  const optimistic = useSyncExternalStore(subscribeOverlay, getOptimisticSnapshot, () => null);
  const effectiveRaw = optimistic ?? rawStack;

  // O overlay vale ate a URL SE MOVER — nao ate ela bater com o overlay. Descartar
  // so no match deixava um estado preso: se a navegacao commitasse num valor
  // diferente (Voltar do navegador antes do push, ou dois drills em sequencia
  // rapida), o overlay nunca era limpo e o modal parava de responder a URL,
  // inclusive ao Voltar. A URL e a fonte de verdade: assim que ela anda, o
  // overlay ja cumpriu o papel (cobrir a latencia do commit) e sai.
  const lastRawKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const rawKey = encodeStack(rawStack);
    if (lastRawKeyRef.current === null) {
      lastRawKeyRef.current = rawKey;
      return;
    }
    if (lastRawKeyRef.current !== rawKey) {
      lastRawKeyRef.current = rawKey;
      setOptimisticStack(null);
    }
  }, [rawStack]);

  const stack = useMemo<ResolvedDrillStep[]>(() => {
    const cache = readNameCache();
    return effectiveRaw.map((step) => ({ ...step, name: cache[nameCacheKey(step)] ?? null }));
  }, [effectiveRaw]);

  const current = stack.length > 0 ? stack[stack.length - 1] : null;

  const writeStack = useCallback(
    (next: DrillStep[]) => {
      // Abre/fecha o modal imediatamente; a navegacao abaixo so sincroniza a URL.
      setOptimisticStack(next);
      const params = new URLSearchParams(searchParams.toString());
      if (next.length === 0) {
        params.delete(DRILL_PARAM);
      } else {
        params.set(DRILL_PARAM, encodeStack(next));
      }
      const qs = params.toString();
      const href = qs ? `${pathname}?${qs}` : pathname;
      router.push(href as any, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const push = useCallback(
    (step: DrillStep & { name?: string | null }) => {
      if (step.name) {
        const cache = readNameCache();
        cache[nameCacheKey(step)] = step.name;
        writeNameCache(cache);
      }
      const baseStep: DrillStep = { kind: step.kind, id: step.id };
      writeStack([...effectiveRaw, baseStep]);
    },
    [effectiveRaw, writeStack],
  );

  const openChain = useCallback(
    (steps: (DrillStep & { name?: string | null })[]) => {
      const valid = steps.filter((s) => s.id);
      if (valid.length === 0) return;
      const cache = readNameCache();
      let dirty = false;
      for (const step of valid) {
        if (step.name) {
          cache[nameCacheKey(step)] = step.name;
          dirty = true;
        }
      }
      if (dirty) writeNameCache(cache);
      writeStack(valid.map(({ kind, id }) => ({ kind, id })));
    },
    [writeStack],
  );

  const popTo = useCallback(
    (index: number) => {
      const safeIndex = Math.max(0, Math.min(index, effectiveRaw.length - 1));
      writeStack(effectiveRaw.slice(0, safeIndex + 1));
    },
    [effectiveRaw, writeStack],
  );

  const close = useCallback(() => {
    writeStack([]);
  }, [writeStack]);

  const setName = useCallback((step: DrillStep, name: string | null) => {
    const cache = readNameCache();
    if (name) {
      cache[nameCacheKey(step)] = name;
    } else {
      delete cache[nameCacheKey(step)];
    }
    writeNameCache(cache);
  }, []);

  return {
    stack,
    isOpen: stack.length > 0,
    current,
    push,
    openChain,
    popTo,
    close,
    setName,
  };
}
