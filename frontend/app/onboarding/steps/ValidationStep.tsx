"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { IconChevronRight, IconChevronLeft, IconLoader2 } from "@tabler/icons-react";
import { useValidationCriteria } from "@/lib/hooks/useValidationCriteria";
import { ValidationCondition, ValidationCriteriaBuilder, validateConditions } from "@/components/common/ValidationCriteriaBuilder";
import { api } from "@/lib/api/endpoints";
import { FormPageSection } from "@/components/common/layout";
import { LoadingState } from "@/components/common/States";
import { showError, showSuccess } from "@/lib/utils/toast";

const RECOMMENDED_IMPRESSIONS = 3000;

export function ValidationStep(props: { onContinue: () => void; onBack: () => void }) {
  const { criteria, isLoading, isSaving, saveCriteria, updateCriteria } = useValidationCriteria();
  const defaultsApplied = useRef(false);

  // Sugerir "Impressions >= 3000" se não houver critérios ainda
  useEffect(() => {
    if (!isLoading && !defaultsApplied.current && (!criteria || criteria.length === 0)) {
      defaultsApplied.current = true;
      updateCriteria([
        {
          id: `onboarding_default_${Date.now()}`,
          type: "condition",
          field: "impressions",
          operator: "GREATER_THAN_OR_EQUAL",
          value: String(RECOMMENDED_IMPRESSIONS),
        } as ValidationCondition,
      ]);
    }
  }, [isLoading, criteria, updateCriteria]);

  const handleSave = async (conditions: ValidationCondition[]) => {
    await saveCriteria(conditions);
    await api.onboarding.complete();
    showSuccess("Configuração concluída!");
    props.onContinue();
  };

  if (isLoading) {
    return (
      <FormPageSection title="Configurando critério de validação">
        <LoadingState label="Carregando critérios..." />
      </FormPageSection>
    );
  }

  const handleNext = async () => {
    const validation = validateConditions(criteria || []);
    if (!validation.isValid) {
      showError(validation.errors.join(", "));
      return;
    }
    try {
      await handleSave(criteria || []);
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
      <ValidationCriteriaBuilder value={criteria} onChange={updateCriteria} onSave={handleSave} isSaving={isSaving} hideSaveButton={true} />

      <div className="flex justify-between">
        <Button variant="outline" onClick={props.onBack} disabled={isSaving}>
          <IconChevronLeft className="w-4 h-4 mr-1" />
          Voltar
        </Button>
        <Button variant="default" onClick={handleNext} disabled={isSaving || !criteria || criteria.length === 0}>
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
