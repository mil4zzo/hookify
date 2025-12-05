"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconBrandFacebook, IconCheck, IconChevronRight, IconChevronLeft, IconLoader2 } from "@tabler/icons-react";
import { useOnboardingGate } from "@/lib/hooks/useOnboardingGate";
import { useFacebookAccountConnection } from "@/lib/hooks/useFacebookAccountConnection";
import { useValidationCriteria } from "@/lib/hooks/useValidationCriteria";
import { ValidationCondition, ValidationCriteriaBuilder, validateConditions } from "@/components/common/ValidationCriteriaBuilder";
import { MultiStepBreadcrumb } from "@/components/common/MultiStepBreadcrumb";
import { api } from "@/lib/api/endpoints";
import { LoadingState } from "@/components/common/States";
import { showError, showSuccess } from "@/lib/utils/toast";

type Step = 1 | 2 | 3;

const RECOMMENDED_IMPRESSIONS = 3000;

function useRecommendedCriteria() {
  const condition: ValidationCondition = {
    id: "onboarding_default_impressions",
    type: "condition",
    field: "impressions",
    operator: "GREATER_THAN_OR_EQUAL",
    value: String(RECOMMENDED_IMPRESSIONS),
  };
  return [condition];
}

function FacebookStep(props: { onContinue: () => void }) {
  const { connections, connect, activeConnections, hasActiveConnection } = useFacebookAccountConnection();

  const handleConnect = async () => {
    try {
      const ok = await connect.mutateAsync();
      if (ok) {
        showSuccess("Facebook conectado com sucesso!");
        // Avança automaticamente para o próximo passo após conectar
        props.onContinue();
      }
    } catch (e: any) {
      showError(e);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conecte sua conta do Facebook</CardTitle>
        <CardDescription>O Hookify precisa da sua conta do Facebook para carregar os anúncios automaticamente. Você pode pular agora, mas algumas funcionalidades ficarão limitadas até a conexão.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
            <IconBrandFacebook className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            {connections.isLoading ? (
              <p className="text-sm text-muted-foreground">Verificando conexões do Facebook...</p>
            ) : hasActiveConnection ? (
              <>
                <p className="text-sm font-medium">Conta do Facebook conectada</p>
                {activeConnections[0]?.facebook_name && <p className="text-xs text-muted-foreground">{activeConnections[0].facebook_name}</p>}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhuma conta do Facebook conectada ainda.</p>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <Button className="flex-1 flex items-center gap-2" variant={hasActiveConnection ? "outline" : "default"} onClick={handleConnect} disabled={connect.isPending}>
            {connect.isPending ? <IconLoader2 className="w-4 h-4 animate-spin" /> : <IconBrandFacebook className="w-4 h-4" />}
            {hasActiveConnection ? "Reconectar Facebook" : connect.isPending ? "Conectando..." : "Conectar Facebook"}
          </Button>
          {!hasActiveConnection && (
            <Button variant="outline" onClick={props.onContinue}>
              Pular por enquanto
            </Button>
          )}
        </div>

        {hasActiveConnection && (
          <div className="flex justify-end">
            <Button variant="default" className="flex items-center gap-1" onClick={props.onContinue}>
              <span>Continuar</span>
              <IconChevronRight className="w-4 h-4" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ValidationStep(props: { onContinue: () => void; onBack: () => void }) {
  const { criteria, isLoading, isSaving, error, saveCriteria, updateCriteria } = useValidationCriteria();

  const recommendedCriteria = useRecommendedCriteria();

  // Ao entrar na etapa, se não houver critérios ainda, sugerir "Impressions >= 3000"
  useEffect(() => {
    if (!isLoading && (!criteria || criteria.length === 0)) {
      updateCriteria([
        {
          ...recommendedCriteria[0],
          // Gera um id único para evitar colisões com outros lugares
          id: `onboarding_default_${Date.now()}`,
        },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const handleSave = async (conditions: ValidationCondition[]) => {
    await saveCriteria(conditions);
    showSuccess("Critério de validação salvo com sucesso!");
    props.onContinue();
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Configurando critério de validação</CardTitle>
        </CardHeader>
        <CardContent>
          <LoadingState label="Carregando critérios..." />
        </CardContent>
      </Card>
    );
  }

  const handleNext = async () => {
    const validation = validateConditions(criteria || []);
    if (!validation.isValid) {
      showError(validation.errors.join(", "));
      return;
    }
    await handleSave(criteria || []);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Defina seu Critério de Validação</CardTitle>
        <CardDescription>Essa regra define a partir de quando um anúncio tem dados suficientes para ser analisado nas telas de Rankings e Insights.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
      </CardContent>
    </Card>
  );
}

function SuccessStep(props: { onBack: () => void }) {
  const router = useRouter();

  const handleFinish = async () => {
    try {
      await api.onboarding.complete();
      // Enviar usuário direto para o fluxo de carregamento de packs
      router.replace("/ads-loader?openDialog=true");
    } catch (e: any) {
      showError(e);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pronto para carregar seus anúncios</CardTitle>
        <CardDescription>Seu ambiente inicial está configurado. Agora você pode carregar um Pack de Anúncios para começar a análise.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button className="w-full flex items-center gap-2" size="lg" onClick={handleFinish}>
          <IconChevronRight className="w-4 h-4" />
          Carregue seu primeiro Pack de Anúncios
        </Button>
        <div className="flex justify-start">
          <Button variant="outline" onClick={props.onBack}>
            <IconChevronLeft className="w-4 h-4 mr-1" />
            Voltar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function OnboardingPage() {
  const { authStatus, onboardingStatus, isClient } = useOnboardingGate("onboarding");
  const [step, setStep] = useState<Step>(1);

  if (!isClient) {
    return <LoadingState label="Carregando..." />;
  }

  if (authStatus !== "authorized") {
    return <LoadingState label="Redirecionando para login..." />;
  }

  if (onboardingStatus === "checking") {
    return <LoadingState label="Verificando configurações iniciais..." />;
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Configuração inicial</h1>
        <p className="text-sm text-muted-foreground">Vamos deixar tudo pronto para o Hookify analisar seus anúncios.</p>
      </div>

      <MultiStepBreadcrumb
        steps={[
          { id: 1, label: "Conectar Facebook" },
          { id: 2, label: "Critério de validação" },
          { id: 3, label: "Carregar Pack" },
        ]}
        currentStepId={step}
        variant="visual"
        onStepClick={(stepId) => setStep(stepId as Step)}
      />

      {step === 1 && <FacebookStep onContinue={() => setStep(2)} />}
      {step === 2 && <ValidationStep onContinue={() => setStep(3)} onBack={() => setStep(1)} />}
      {step === 3 && <SuccessStep onBack={() => setStep(2)} />}
    </div>
  );
}
