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
 * Onde uma edição de julgamento vai parar.
 *
 * - `user`   — grava no padrão da conta (user_preferences)
 * - `pack`   — grava no override do único pack selecionado
 * - `locked` — vários packs compartilham o mesmo override; gravar exigiria
 *              escolher entre eles, então a edição sai daqui e vai para a
 *              configuração do pack
 */
export type JudgmentEditScope = "user" | "pack" | "locked";

export interface JudgmentEditTarget {
  scope: JudgmentEditScope;
  /** Texto curto para a UI explicar o destino da edição. */
  label: string;
  packId: string | null;
}

export interface UseJudgmentEditorReturn {
  /** Valores EFETIVOS (já resolvidos contra os packs selecionados). */
  mqlLeadscoreMin: number;
  targetCprByActionType: Record<string, number>;
  diagnosticCostMetric: DiagnosticCostMetric;
  hasDivergence: boolean;
  divergent: Record<JudgmentField, boolean>;
  selectedPackNames: string[];
  isSaving: boolean;
  /** Para onde uma edição desse campo vai. */
  editTargetFor: (field: JudgmentField) => JudgmentEditTarget;
  /** Define (ou remove, com `undefined`) o CPR alvo do evento informado. */
  saveTargetCpr: (actionType: string, value: number | undefined) => Promise<void>;
  saveDiagnosticCostMetric: (metric: DiagnosticCostMetric) => Promise<void>;
}

/**
 * Edição de critérios de julgamento a partir das telas de análise.
 *
 * Regra: **edita-se o que está em vigor**. Se o valor efetivo veio de um
 * override de pack, a edição vai para aquele pack; se veio do padrão da conta,
 * vai para a conta. Sem isso, o usuário mexeria num controle que mostra o valor
 * do pack e gravaria silenciosamente na conta — o número na tela não mudaria e
 * o padrão global seria corrompido de quebra.
 */
export function useJudgmentEditor(): UseJudgmentEditorReturn {
  const judgment = usePackJudgment();
  const { savePreferences, isSaving: isSavingPreferences } = useUserPreferences();
  const { updatePack } = useClientPacks();
  const [isSavingPack, setIsSavingPack] = useState(false);

  const singlePack = judgment.selectedPacks.length === 1 ? judgment.selectedPacks[0] : null;

  const editTargetFor = useCallback(
    (field: JudgmentField): JudgmentEditTarget => {
      if (judgment.source[field] !== "pack") {
        return { scope: "user", label: "padrão da conta", packId: null };
      }
      if (singlePack) {
        return { scope: "pack", label: `pack ${singlePack.name}`, packId: singlePack.id };
      }
      return { scope: "locked", label: "definido nos packs selecionados", packId: null };
    },
    [judgment.source, singlePack]
  );

  const saveTargetCpr = useCallback(
    async (actionType: string, value: number | undefined) => {
      if (!actionType) return;

      const next = { ...judgment.targetCprByActionType };
      if (value !== undefined && value > 0) {
        next[actionType] = value;
      } else {
        delete next[actionType];
      }

      const target = editTargetFor("targetCprByActionType");
      if (target.scope === "locked") return;

      if (target.scope === "pack" && target.packId) {
        const payload = Object.keys(next).length > 0 ? next : null;
        setIsSavingPack(true);
        try {
          await api.analytics.updatePackJudgment(target.packId, { target_cpr: payload });
          updatePack(target.packId, { target_cpr: payload } as Partial<AdsPack>);
        } finally {
          setIsSavingPack(false);
        }
        return;
      }

      await savePreferences({ targetCprByActionType: next });
    },
    [judgment.targetCprByActionType, editTargetFor, savePreferences, updatePack]
  );

  const saveDiagnosticCostMetric = useCallback(
    async (metric: DiagnosticCostMetric) => {
      const target = editTargetFor("diagnosticCostMetric");
      if (target.scope === "locked") return;

      if (target.scope === "pack" && target.packId) {
        setIsSavingPack(true);
        try {
          await api.analytics.updatePackJudgment(target.packId, { diagnostic_cost_metric: metric });
          updatePack(target.packId, { diagnostic_cost_metric: metric } as Partial<AdsPack>);
        } finally {
          setIsSavingPack(false);
        }
        return;
      }

      await savePreferences({ diagnosticCostMetric: metric });
    },
    [editTargetFor, savePreferences, updatePack]
  );

  return useMemo(
    () => ({
      mqlLeadscoreMin: judgment.mqlLeadscoreMin,
      targetCprByActionType: judgment.targetCprByActionType,
      diagnosticCostMetric: judgment.diagnosticCostMetric,
      hasDivergence: judgment.hasDivergence,
      divergent: judgment.divergent,
      selectedPackNames: judgment.selectedPackNames,
      isSaving: isSavingPreferences || isSavingPack,
      editTargetFor,
      saveTargetCpr,
      saveDiagnosticCostMetric,
    }),
    [
      judgment.mqlLeadscoreMin,
      judgment.targetCprByActionType,
      judgment.diagnosticCostMetric,
      judgment.hasDivergence,
      judgment.divergent,
      judgment.selectedPackNames,
      isSavingPreferences,
      isSavingPack,
      editTargetFor,
      saveTargetCpr,
      saveDiagnosticCostMetric,
    ]
  );
}
