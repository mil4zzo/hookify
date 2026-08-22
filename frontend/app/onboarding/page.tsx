"use client";

import { useEffect, useState } from "react";
import { useOnboardingGate } from "@/lib/hooks/useOnboardingGate";
import { MultiStepBreadcrumb } from "@/components/common/MultiStepBreadcrumb";
import { StateSkeleton } from "@/components/common/States";
import { PageContainer } from "@/components/common/PageContainer";
import { PageBodyStack } from "@/components/common/layout";
import { InitialSettingsStep } from "./steps/InitialSettingsStep";
import { FacebookStep } from "./steps/FacebookStep";
import { ValidationStep } from "./steps/ValidationStep";
import { SuccessStep } from "./steps/SuccessStep";

type Step = 1 | 2 | 3 | 4;

// Largura contida e centralizada: o onboarding é um wizard focado, não uma página de dados.
const ONBOARDING_SHELL_CLASS = "mx-auto w-full max-w-3xl";

function OnboardingSkeleton() {
  return (
    <PageContainer
      variant="standard"
      title="Configuração inicial"
      description="Vamos deixar tudo pronto para o Hookify analisar seus anúncios."
      className={ONBOARDING_SHELL_CLASS}
    >
      <PageBodyStack density="spacious">
        <StateSkeleton variant="widget" rows={1} className="rounded-md border border-border bg-card" />
        <StateSkeleton variant="page" rows={3} className="rounded-md border border-border bg-card" />
      </PageBodyStack>
    </PageContainer>
  );
}

/** Calcula o step inicial com base no progresso salvo no backend. */
function computeInitialStep(data: { has_completed_onboarding?: boolean } | undefined): Step {
  if (!data) return 1;
  // Quem já concluiu vê a tela final; quem não concluiu COMEÇA DO INÍCIO.
  //
  // Antes o passo inicial era inferido de `initial_settings_configured` (locale) e
  // `validation_criteria_configured` — e os dois MENTEM numa conta nova: o hook
  // useUserPreferences cria a linha de preferências já preenchida com locale, moeda
  // e critério recomendado no primeiro carregamento autenticado (medido: 245 ms
  // entre created_at e updated_at). O onboarding então "resumia" passos que o
  // usuário nunca fez e caía na tela final sem nunca ter concluído.
  //
  // Retomar de onde parou só vale com sinal confiável de que o usuário DECIDIU
  // aquele passo. Como não há esse sinal hoje, começar do início é o correto: são
  // 3 passos curtos, os valores já salvos aparecem preenchidos, e o Facebook usa
  // popup (não recarrega a página, então nada se perde no meio do fluxo).
  if (data.has_completed_onboarding) return 4;
  return 1;
}

export default function OnboardingPage() {
  const { authStatus, onboardingStatus, isClient, data } = useOnboardingGate("onboarding");
  const [step, setStep] = useState<Step>(1);
  const [initialized, setInitialized] = useState(false);

  // Restaurar progresso quando os dados do backend chegarem
  useEffect(() => {
    if (!initialized && data && onboardingStatus !== "checking") {
      setStep(computeInitialStep(data));
      setInitialized(true);
    }
  }, [data, onboardingStatus, initialized]);

  // Restringir navegação do breadcrumb: só permite voltar, nunca pular adiante
  const handleStepClick = (stepId: string | number) => {
    const numId = typeof stepId === "string" ? parseInt(stepId, 10) : stepId;
    if (numId <= step) {
      setStep(numId as Step);
    }
  };

  if (!isClient) {
    return <OnboardingSkeleton />;
  }

  if (authStatus !== "authorized") {
    return <OnboardingSkeleton />;
  }

  if (onboardingStatus === "checking") {
    return <OnboardingSkeleton />;
  }

  return (
    <PageContainer
      variant="standard"
      title="Configuração inicial"
      description="Vamos deixar tudo pronto para o Hookify analisar seus anúncios."
      className={ONBOARDING_SHELL_CLASS}
    >
      <MultiStepBreadcrumb
        steps={[
          { id: 1, label: "Preferências" },
          { id: 2, label: "Conectar Facebook" },
          { id: 3, label: "Critério de validação" },
          { id: 4, label: "Carregar Pack" },
        ]}
        currentStepId={step}
        variant="visual"
        onStepClick={handleStepClick}
      />

      {step === 1 && <InitialSettingsStep onContinue={() => setStep(2)} />}
      {step === 2 && <FacebookStep onContinue={() => setStep(3)} onBack={() => setStep(1)} />}
      {step === 3 && <ValidationStep onContinue={() => setStep(4)} onBack={() => setStep(2)} />}
      {step === 4 && <SuccessStep onBack={() => setStep(3)} />}
    </PageContainer>
  );
}
