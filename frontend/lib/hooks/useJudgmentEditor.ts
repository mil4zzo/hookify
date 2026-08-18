"use client";

import { useCallback, useMemo, useState } from "react";
import { api } from "@/lib/api/endpoints";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { useUserPreferences } from "@/lib/hooks/useUserPreferences";
import { usePackJudgment } from "@/lib/hooks/usePackJudgment";
import type { JudgmentField } from "@/lib/judgment/resolveJudgment";
import type { AdsPack } from "@/lib/types";
import type { DiagnosticCostMetric } from "@/lib/store/userPreferences";

/**
 * Onde uma edição vai parar.
 *
 * - `pack`   — grava no único pack selecionado
 * - `locked` — vários packs selecionados; gravar exigiria escolher entre eles,
 *              então a edição sai daqui e vai para a configuração do pack
 */
export type JudgmentEditScope = "pack" | "locked";

export interface JudgmentEditTarget {
  scope: JudgmentEditScope;
  /** Texto curto para a UI explicar o destino da edição. */
  label: string;
  packId: string | null;
}

export interface UseJudgmentEditorReturn {
  /** Valores EFETIVOS, resolvidos contra os packs selecionados. */
  mqlLeadscoreMin: number | null;
  targetCprByActionType: Record<string, number>;
  /** Controle de visualização — vem da conta, não do pack. */
  diagnosticCostMetric: DiagnosticCostMetric;
  hasDivergence: boolean;
  divergent: Record<JudgmentField, boolean>;
  /** action_types cuja meta foi descartada por divergência entre os packs. */
  divergentTargetCprKeys: string[];
  selectedPackNames: string[];
  isSaving: boolean;
  /** Para onde uma edição desse campo vai. */
  editTargetFor: (field: JudgmentField) => JudgmentEditTarget;
  /** Define (ou remove, com `undefined`) o CPR alvo do evento informado. */
  saveTargetCpr: (actionType: string, value: number | undefined) => Promise<void>;
  /** Define (ou limpa, com `null`) o corte de leadscore do pack. */
  saveMqlLeadscoreMin: (value: number | null) => Promise<void>;
  saveDiagnosticCostMetric: (metric: DiagnosticCostMetric) => Promise<void>;
}

/**
 * Edição dos critérios de julgamento a partir das telas de análise.
 *
 * Depois da migration 110 não há mais "para onde gravar?": o corte de leadscore
 * e a meta de CPR são inerentes ao PACK, e `diagnostic_cost_metric` é controle
 * de visualização e mora na conta. O que restou de decisão é apenas quantos
 * packs estão selecionados — com mais de um, a edição fica bloqueada aqui e
 * acontece na configuração do pack, onde o alvo é explícito.
 *
 * Escrevem dono e editor; o backend recusa viewer com 403.
 */
export function useJudgmentEditor(): UseJudgmentEditorReturn {
  const judgment = usePackJudgment();
  const {
    diagnosticCostMetric,
    savePreferences,
    isSaving: isSavingPreferences,
  } = useUserPreferences();
  const { updatePack } = useClientPacks();
  const [isSavingPack, setIsSavingPack] = useState(false);

  const singlePack = judgment.selectedPacks.length === 1 ? judgment.selectedPacks[0] : null;

  const editTargetFor = useCallback(
    (_field: JudgmentField): JudgmentEditTarget => {
      if (singlePack) {
        return { scope: "pack", label: `pack ${singlePack.name}`, packId: singlePack.id };
      }
      return { scope: "locked", label: "definido em cada pack", packId: null };
    },
    [singlePack]
  );

  /** Grava no pack e espelha no store, para a tela não esperar um refetch. */
  const writeToPack = useCallback(
    async (packId: string, patch: Partial<AdsPack>) => {
      setIsSavingPack(true);
      try {
        await api.analytics.updatePackJudgment(packId, patch as Record<string, unknown>);
        updatePack(packId, patch);
      } finally {
        setIsSavingPack(false);
      }
    },
    [updatePack]
  );

  const saveTargetCpr = useCallback(
    async (actionType: string, value: number | undefined) => {
      if (!actionType) return;

      const target = editTargetFor("targetCprByActionType");
      if (target.scope === "locked" || !target.packId) return;

      const next = { ...judgment.targetCprByActionType };
      if (value !== undefined && value > 0) next[actionType] = value;
      else delete next[actionType];

      // Mapa vazio vira null: "sem meta" e "meta vazia" seriam o mesmo estado.
      const payload = Object.keys(next).length > 0 ? next : null;
      await writeToPack(target.packId, { target_cpr: payload });
    },
    [judgment.targetCprByActionType, editTargetFor, writeToPack]
  );

  const saveMqlLeadscoreMin = useCallback(
    async (value: number | null) => {
      const target = editTargetFor("mqlLeadscoreMin");
      if (target.scope === "locked" || !target.packId) return;

      const normalized = value !== null && Number.isFinite(value) && value >= 0 ? value : null;
      await writeToPack(target.packId, { mql_leadscore_min: normalized });
    },
    [editTargetFor, writeToPack]
  );

  // Controle de visualização: sempre a conta, independente da seleção de packs.
  const saveDiagnosticCostMetric = useCallback(
    async (metric: DiagnosticCostMetric) => {
      await savePreferences({ diagnosticCostMetric: metric });
    },
    [savePreferences]
  );

  return useMemo(
    () => ({
      mqlLeadscoreMin: judgment.mqlLeadscoreMin,
      targetCprByActionType: judgment.targetCprByActionType,
      diagnosticCostMetric,
      hasDivergence: judgment.hasDivergence,
      divergent: judgment.divergent,
      divergentTargetCprKeys: judgment.divergentTargetCprKeys,
      selectedPackNames: judgment.selectedPackNames,
      isSaving: isSavingPreferences || isSavingPack,
      editTargetFor,
      saveTargetCpr,
      saveMqlLeadscoreMin,
      saveDiagnosticCostMetric,
    }),
    [
      judgment.mqlLeadscoreMin,
      judgment.targetCprByActionType,
      judgment.hasDivergence,
      judgment.divergent,
      judgment.divergentTargetCprKeys,
      judgment.selectedPackNames,
      diagnosticCostMetric,
      isSavingPreferences,
      isSavingPack,
      editTargetFor,
      saveTargetCpr,
      saveMqlLeadscoreMin,
      saveDiagnosticCostMetric,
    ]
  );
}
