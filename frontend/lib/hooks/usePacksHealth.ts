"use client";

import { useMemo } from "react";
import { useAdPerformance } from "@/lib/api/hooks";
import { usePacksAds } from "@/lib/hooks/usePacksAds";
import { useFilters } from "@/lib/hooks/useFilters";
import { useAppAuthReady } from "@/lib/hooks/useAppAuthReady";
import { useUserPreferences } from "@/lib/hooks/useUserPreferences";
import { getTodayLocal, formatDateLocal } from "@/lib/utils/dateFilters";
import { subDays } from "date-fns";
import type { RankingsRequest } from "@/lib/api/schemas";
import type { AdsPack } from "@/lib/types";

// Janela fixa de saúde: últimos 7 dias. Todos os packs comparáveis na MESMA janela
// (espelha o DISPLAY_WINDOW do bloco de comparação do /plano). Packs históricos
// (date_stop < janela) não têm dados aqui → estado "fora-do-periodo", derivado das
// datas do pack sem precisar de dados.
const HEALTH_WINDOW_DAYS = 7;

export type PackHealthState =
  | "escalando"   // CPR ≤ 85% do alvo — folga real
  | "estavel"     // CPR entre 85% e 115% do alvo
  | "sangrando"   // CPR > 115% do alvo
  | "sem-alvo"    // tem entrega mas usuário não definiu custo-alvo p/ o actionType
  | "sem-entrega" // pack ativo na janela mas sem spend
  | "fora-do-periodo"; // date_stop do pack anterior à janela de saúde

export interface PackHealth {
  packId: string;
  state: PackHealthState;
  spend: number;
  results: number;
  /** CPR ponderado (Σspend/Σresults) — única média do app. null sem results. */
  cpr: number | null;
  /** CPR/alvo (1 = no alvo; <1 melhor). null sem alvo ou sem CPR. */
  ratioToTarget: number | null;
  /** 0–100 p/ o health ring: 100 = CPR ≤ 50% do alvo, 50 = no alvo, 0 = ≥ 2× alvo. */
  healthPct: number | null;
}

function computeState(spend: number, cpr: number | null, target: number | undefined, outOfWindow: boolean): PackHealthState {
  if (outOfWindow) return "fora-do-periodo";
  if (spend <= 0) return "sem-entrega";
  if (!target || target <= 0) return "sem-alvo";
  if (cpr == null) return "sangrando"; // gastou e não converteu na janela
  const ratio = cpr / target;
  if (ratio <= 0.85) return "escalando";
  if (ratio <= 1.15) return "estavel";
  return "sangrando";
}

/**
 * Saúde por pack para a estante do Hangar (fase 1).
 * UMA query ad-performance com TODOS os packs (janela fixa de 7d) + split
 * client-side por pack via packsAdsMap (match por ad_id/ad_name + account,
 * mesmo critério do getPackId do pipeline). Métricas = soma sobre TODOS os
 * ads do pack (média global ponderada — nunca média de subconjunto).
 */
export function usePacksHealth(packs: AdsPack[]) {
  const { isAuthorized } = useAppAuthReady();
  const { actionType } = useFilters();
  const { targetCprByActionType } = useUserPreferences();

  const dateStop = getTodayLocal();
  const dateStart = formatDateLocal(subDays(new Date(`${dateStop}T12:00:00`), HEALTH_WINDOW_DAYS - 1));

  const allPackIds = useMemo(() => packs.map((p) => p.id), [packs]);

  const request = useMemo((): RankingsRequest => ({
    date_start: dateStart,
    date_stop: dateStop,
    group_by: "ad_name",
    action_type: actionType || undefined,
    limit: 1000,
    filters: {},
    pack_ids: allPackIds,
    include_available_conversion_types: false,
  }), [dateStart, dateStop, actionType, allPackIds]);

  const enabled = isAuthorized && allPackIds.length > 0 && !!actionType;
  const { data, isLoading } = useAdPerformance(request, enabled);

  const { packsAdsMap } = usePacksAds(packs);

  const healthByPackId = useMemo(() => {
    const map = new Map<string, PackHealth>();
    const rows: any[] = data?.data ?? [];
    const target = actionType ? targetCprByActionType?.[actionType] : undefined;

    for (const pack of packs) {
      const outOfWindow = !pack.auto_refresh && !!pack.date_stop && pack.date_stop < dateStart;
      const packAds = packsAdsMap.get(pack.id) || [];
      let spend = 0;
      let results = 0;
      if (packAds.length > 0 && rows.length > 0) {
        for (const row of rows) {
          const matches = packAds.some((pa: any) => {
            if (row.account_id && pa.account_id && String(row.account_id).trim() !== String(pa.account_id).trim()) return false;
            if (row.ad_id && pa.ad_id && String(row.ad_id).trim() === String(pa.ad_id).trim()) return true;
            if (row.ad_name && pa.ad_name && String(row.ad_name).trim() === String(pa.ad_name).trim()) return true;
            return false;
          });
          if (!matches) continue;
          spend += Number(row.spend || 0);
          results += actionType ? Number(row.conversions?.[actionType] || 0) : 0;
        }
      }
      const cpr = results > 0 ? spend / results : null;
      const ratio = cpr != null && target && target > 0 ? cpr / target : null;
      // 0–100: 1 - (ratio-0.5)/1.5 clampado → ratio 0.5→100, 1→~66... simplificar:
      // 100 no ratio ≤0.5, 50 no ratio 1, 0 no ratio ≥2 (interpolação linear em 2 trechos).
      let healthPct: number | null = null;
      if (ratio != null) {
        healthPct = ratio <= 1
          ? Math.min(100, 50 + ((1 - ratio) / 0.5) * 50)
          : Math.max(0, 50 - ((ratio - 1) / 1.0) * 50);
        healthPct = Math.round(healthPct);
      }
      map.set(pack.id, {
        packId: pack.id,
        state: computeState(spend, cpr, target, outOfWindow),
        spend,
        results,
        cpr,
        ratioToTarget: ratio,
        healthPct,
      });
    }
    return map;
  }, [packs, packsAdsMap, data, actionType, targetCprByActionType, dateStart]);

  return { healthByPackId, isLoading, windowDays: HEALTH_WINDOW_DAYS, actionType };
}
