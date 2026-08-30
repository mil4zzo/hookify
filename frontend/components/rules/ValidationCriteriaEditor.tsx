"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { IconCheck, IconLoader2 } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/common/States";
import { RuleBuilder, type RuleDimensionOption } from "@/components/rules/RuleBuilder";
import { useClientAdAccounts, useClientPacks } from "@/lib/hooks/useClientSession";
import { countRestrictiveConditions } from "@/lib/rules/restrictive";
import type { RuleTree } from "@/lib/rules/types";
import { logger } from "@/lib/utils/logger";

/**
 * O Critério de validação — "a partir de quando um anúncio já pode ser julgado" —
 * escrito no MESMO construtor do Manager e do Boards.
 *
 * POR QUE ESTE INVÓLUCRO EXISTE
 *   O `RuleBuilder` é puro: recebe a árvore e devolve a árvore. O que muda aqui é
 *   tudo que orbita o salvar — o critério é preferência PERSISTIDA (vai para
 *   `user_preferences.validation_criteria`), não recorte de sessão como os
 *   filtros do Manager. Então precisa de botão, de estado "salvo × alterado" e de
 *   uma trava contra salvar critério vazio, que faria todo anúncio passar por
 *   maduro — inclusive o que estreou hoje.
 *
 * DE ONDE VÊM AS OPÇÕES DE PACK E CONTA
 *   Da sessão do cliente, não do recorte da tela: aqui não existe recorte. No
 *   Boards as opções saem das linhas visíveis; nas Configurações a lista completa
 *   é a única resposta possível — e é a certa, porque o critério vale para
 *   qualquer período que o usuário venha a abrir depois.
 */
export interface ValidationCriteriaEditorProps {
  value: RuleTree;
  onChange: (rules: RuleTree) => void;
  onSave?: (rules: RuleTree) => Promise<void>;
  isSaving?: boolean;
  /** O onboarding tem o próprio botão "Próximo", que salva. */
  hideSaveButton?: boolean;
}

export function ValidationCriteriaEditor({
  value,
  onChange,
  onSave,
  isSaving = false,
  hideSaveButton = false,
}: ValidationCriteriaEditorProps) {
  const { packs } = useClientPacks();
  const { adAccounts } = useClientAdAccounts();
  const [saveError, setSaveError] = useState<string | null>(null);

  // O que está no banco. Só muda quando um save dá certo — é o contraste que
  // acende o botão. Snapshot no MONTE porque quem renderiza este editor já
  // esperou o carregamento terminar (Topbar e onboarding gateiam em isLoading).
  const savedSnapshotRef = useRef<string>(JSON.stringify(value));

  const dimensionOptions = useMemo<Partial<Record<string, RuleDimensionOption[]>>>(() => {
    const accountNameById = new Map(adAccounts.map((account) => [account.id, account.name]));
    const accountIds = new Set<string>();
    for (const pack of packs) if (pack.adaccount_id) accountIds.add(String(pack.adaccount_id));

    return {
      pack_ids: packs
        .map((pack) => ({ value: pack.id, label: pack.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      account_ids: Array.from(accountIds)
        .map((id) => ({ value: id, label: accountNameById.get(id) ?? id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    };
  }, [packs, adAccounts]);

  const conditionCount = countRestrictiveConditions(value);
  const hasChanges = JSON.stringify(value) !== savedSnapshotRef.current;

  const handleSave = useCallback(async () => {
    if (!onSave) return;
    setSaveError(null);
    try {
      await onSave(value);
      savedSnapshotRef.current = JSON.stringify(value);
    } catch (error) {
      logger.error("Erro ao salvar critérios de validação:", error);
      setSaveError("Não foi possível salvar o critério. Tente novamente.");
    }
  }, [onSave, value]);

  const canSave = hasChanges && conditionCount > 0 && !isSaving;

  return (
    <div className="space-y-4">
      <RuleBuilder value={value} onChange={onChange} context="criteria" dimensionOptions={dimensionOptions} disabled={isSaving} />

      {saveError && (
        <InlineNotice tone="destructive" title="Erro ao salvar">
          {saveError}
        </InlineNotice>
      )}

      {onSave && !hideSaveButton && (
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            variant={canSave ? "default" : "ghost"}
            className="flex items-center gap-2"
          >
            {isSaving ? (
              <>
                <IconLoader2 className="h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <IconCheck className="h-4 w-4" />
                {hasChanges && conditionCount > 0 ? "Salvar critério" : "Salvo"}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
