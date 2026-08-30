"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { IconChevronRight, IconChevronLeft, IconLoader2 } from "@tabler/icons-react";
import { useValidationCriteria } from "@/lib/hooks/useValidationCriteria";
import { ValidationCriteriaEditor } from "@/components/rules/ValidationCriteriaEditor";
import { countRestrictiveConditions } from "@/lib/rules/restrictive";
import { isEmptyRuleTree, type RuleTree } from "@/lib/rules/types";
import { api } from "@/lib/api/endpoints";
import { useQueryClient } from "@tanstack/react-query";
import { patchOnboardingStatusCache } from "@/lib/hooks/useOnboardingStatus";
import { FormPageSection } from "@/components/common/layout";
import { StateSkeleton } from "@/components/common/States";
import { showError, showSuccess } from "@/lib/utils/toast";

const RECOMMENDED_IMPRESSIONS = 3000;

export function ValidationStep(props: { onContinue: () => void; onBack: () => void }) {
  const { criteria, isLoading, isSaving, saveCriteria, updateCriteria } = useValidationCriteria();
  const queryClient = useQueryClient();
  const defaultsApplied = useRef(false);

  // Semente: "impressões > 3000". É o mesmo corte que a fase 4 gravou para todo
  // mundo — um anúncio com menos que isso ainda não tem amostra para ser julgado.
  useEffect(() => {
    if (!isLoading && !defaultsApplied.current && isEmptyRuleTree(criteria)) {
      defaultsApplied.current = true;
      updateCriteria({
        logic: "AND",
        conditions: [
          {
            id: `onboarding_default_${Date.now()}`,
            type: "condition",
            field: "impressions",
            operator: ">",
            value: RECOMMENDED_IMPRESSIONS,
          },
        ],
      });
    }
  }, [isLoading, criteria, updateCriteria]);

  const handleSave = async (conditions: RuleTree) => {
    await saveCriteria(conditions);
    await api.onboarding.complete();
    patchOnboardingStatusCache(queryClient, {
      validation_criteria_configured: true,
      has_completed_onboarding: true,
    });
    showSuccess("Configuração concluída!");
    props.onContinue();
  };

  if (isLoading) {
    return (
      <FormPageSection title="Configurando critério de validação">
        <StateSkeleton variant="widget" rows={3} />
      </FormPageSection>
    );
  }

  const handleNext = async () => {
    // Condição em branco não conta: um critério com "impressões >" sem número
    // deixa todo anúncio passar por maduro, que é o oposto do que esta tela pede.
    if (countRestrictiveConditions(criteria) === 0) {
      showError("Preencha ao menos uma condição para concluir.");
      return;
    }
    try {
      await handleSave(criteria);
    } catch (e: any) {
      showError(e);
    }
  };

  return (
    <FormPageSection
      title="Critério de Validação"
      description={
        <>
          Defina a partir de <strong>quando um anúncio tem dados suficientes para ser analisado</strong>. Anúncios que não atendem esses critérios são considerados em fase de testes.
        </>
      }
      density="spacious"
    >
      <ValidationCriteriaEditor value={criteria} onChange={updateCriteria} onSave={handleSave} isSaving={isSaving} hideSaveButton={true} />

      <div className="flex justify-between">
        <Button variant="outline" onClick={props.onBack} disabled={isSaving}>
          <IconChevronLeft className="w-4 h-4 mr-1" />
          Voltar
        </Button>
        <Button variant="default" onClick={handleNext} disabled={isSaving || countRestrictiveConditions(criteria) === 0}>
          {isSaving ? (
            <>
              <IconLoader2 className="w-4 h-4 mr-1 animate-spin" />
              Salvando...
            </>
          ) : (
            <>
              Próximo
              <IconChevronRight className="w-4 h-4 ml-1" />
            </>
          )}
        </Button>
      </div>
    </FormPageSection>
  );
}
