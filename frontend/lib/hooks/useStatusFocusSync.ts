import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import { useFilters } from "@/lib/hooks/useFilters";
import { useAppAuthReady } from "@/lib/hooks/useAppAuthReady";
import { logger } from "@/lib/utils/logger";

// TTL client-side espelhando o server-side (5 min por pack). O guard do servidor é o
// autoritativo; este só evita requests obviamente redundantes.
const CLIENT_TTL_MS = 5 * 60 * 1000;
// Delay no mount: não competir com o carregamento inicial da página (rankings em voo).
const MOUNT_DELAY_MS = 3000;

/**
 * Sync de status on-focus: ao montar a página e ao voltar o foco/visibilidade da aba,
 * pede ao backend para reler do Meta o effective_status dos ads e dos pais
 * (campanhas/adsets) dos packs selecionados. Cobre mudanças feitas FORA do Hookify
 * (Ads Manager) entre refreshes de pack — toggles feitos aqui já se auto-sincronizam.
 *
 * Só invalida os caches de rankings quando o backend confirmou que algum pack foi
 * de fato sincronizado (`synced.length > 0`) — pack dentro do TTL devolve `skipped`
 * e não dispara refetch.
 */
export function useStatusFocusSync(): void {
  const qc = useQueryClient();
  const { isAuthorized } = useAppAuthReady();
  const { selectedPackIds } = useFilters();
  const lastRunRef = useRef(0);
  const inFlightRef = useRef(false);

  const packIdsKey = Array.from(selectedPackIds).sort().join(",");

  // Seleção de packs mudou → libera o TTL client-side (o server-side segue protegendo o
  // Meta por pack; packs já sincronizados voltam como "skipped").
  useEffect(() => {
    lastRunRef.current = 0;
  }, [packIdsKey]);

  const runSync = useCallback(async () => {
    if (!isAuthorized || !packIdsKey) return;
    const now = Date.now();
    if (inFlightRef.current || now - lastRunRef.current < CLIENT_TTL_MS) return;
    inFlightRef.current = true;
    lastRunRef.current = now;
    try {
      const res = await api.facebook.syncPacksStatus(packIdsKey.split(","));
      if (res.failed.length > 0) {
        // O servidor libera o slot TTL dos packs que falharam para permitir retry no próximo
        // focus — liberar o TTL client-side também, senão o retry fica inalcançável por 5 min.
        lastRunRef.current = 0;
      }
      if (res.synced.length > 0) {
        await qc.invalidateQueries({ queryKey: ["analytics", "rankings"], refetchType: "active" });
      }
    } catch (e) {
      // Best-effort: falha de sync não deve incomodar o usuário; TTL liberado para retry.
      lastRunRef.current = 0;
      logger.warn("[useStatusFocusSync] sync falhou", e);
    } finally {
      inFlightRef.current = false;
    }
  }, [isAuthorized, packIdsKey, qc]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void runSync();
    }, MOUNT_DELAY_MS);

    const onFocus = () => {
      void runSync();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void runSync();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [runSync]);
}
