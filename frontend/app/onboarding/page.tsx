"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IconBrandFacebook, IconCheck, IconChevronRight, IconChevronLeft, IconLoader2 } from "@tabler/icons-react";
import { useOnboardingGate } from "@/lib/hooks/useOnboardingGate";
import { useFacebookAccountConnection } from "@/lib/hooks/useFacebookAccountConnection";
import { useValidationCriteria } from "@/lib/hooks/useValidationCriteria";
import { useFacebookConnectionVerification } from "@/lib/hooks/useFacebookConnectionVerification";
import { FacebookConnectionCard } from "@/components/facebook/FacebookConnectionCard";
import { ValidationCondition, ValidationCriteriaBuilder, validateConditions } from "@/components/common/ValidationCriteriaBuilder";
import { MultiStepBreadcrumb } from "@/components/common/MultiStepBreadcrumb";
import { api } from "@/lib/api/endpoints";
import { LoadingState } from "@/components/common/States";
import { showError, showSuccess } from "@/lib/utils/toast";

type Step = 1 | 2 | 3 | 4;

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

function InitialSettingsStep(props: { onContinue: () => void }) {
  const [language, setLanguage] = useState<string>("pt-BR");
  const [currency, setCurrency] = useState<string>("BRL");
  const [niche, setNiche] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!language || !currency) {
      showError({ message: "Por favor, preencha todos os campos obrigatórios" });
      return;
    }

    setIsSaving(true);
    try {
      await api.onboarding.saveInitialSettings({
        language,
        currency,
        niche: niche || "",
      });
      showSuccess("Configurações salvas com sucesso!");
      props.onContinue();
    } catch (e: any) {
      showError(e);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preferências</CardTitle>
        <CardDescription>
          Essas configurações podem ser alteradas depois em <strong>Configurações &gt; Preferências</strong>.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Idioma */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Idioma</label>
          <Select value={language} onValueChange={setLanguage} disabled={isSaving}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione um idioma" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pt-BR">Português</SelectItem>
              <SelectItem value="en-US" disabled>
                Inglês
              </SelectItem>
              <SelectItem value="es-ES" disabled>
                Espanhol
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">O idioma será aplicado em todas as páginas do app</p>
        </div>

        {/* Moeda */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Moeda</label>
          <Select value={currency} onValueChange={setCurrency} disabled={isSaving}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione uma moeda" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">USD - Dólar Americano ($)</SelectItem>
              <SelectItem value="EUR">EUR - Euro (€)</SelectItem>
              <SelectItem value="GBP">GBP - Libra Esterlina (£)</SelectItem>
              <SelectItem value="BRL">BRL - Real Brasileiro (R$)</SelectItem>
              <SelectItem value="MXN">MXN - Peso Mexicano ($)</SelectItem>
              <SelectItem value="CAD">CAD - Dólar Canadense ($)</SelectItem>
              <SelectItem value="AUD">AUD - Dólar Australiano ($)</SelectItem>
              <SelectItem value="JPY">JPY - Iene Japonês (¥)</SelectItem>
              <SelectItem value="CNY">CNY - Yuan Chinês (¥)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">A moeda será aplicada em todas as páginas do app</p>
        </div>

        {/* Nicho */}
        <div className="space-y-2">
          <label className="text-sm font-medium">Nicho</label>
          <Input type="text" placeholder="Ex: E-commerce, SaaS, etc." value={niche} onChange={(e) => setNiche(e.target.value)} disabled={isSaving} />
          <p className="text-xs text-muted-foreground">Digite o nicho do seu negócio (opcional)</p>
        </div>

        <div className="flex justify-end">
          <Button variant="default" className="flex items-center gap-1" onClick={handleSave} disabled={isSaving || !language || !currency}>
            {isSaving ? (
              <>
                <IconLoader2 className="w-4 h-4 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <span>Continuar</span>
                <IconChevronRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FacebookStep(props: { onContinue: () => void; onBack: () => void }) {
  const { connections, connect, activeConnections, hasActiveConnection, disconnect } = useFacebookAccountConnection();
  const { verifyConnections } = useFacebookConnectionVerification();

  // Verificar conexões quando carregarem
  useEffect(() => {
    if (connections.data && connections.data.length > 0) {
      const connectionIds = connections.data.map((c: any) => c.id);
      verifyConnections(connectionIds);
    }
  }, [connections.data, verifyConnections]);

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

  const handleReconnect = async (connectionId: string) => {
    await handleConnect();
  };

  const handleDelete = async (connectionId: string) => {
    if (!confirm("Tem certeza que deseja desconectar esta conta do Facebook?")) {
      return;
    }
    try {
      await disconnect.mutateAsync(connectionId);
      showSuccess("Conta desconectada com sucesso!");
    } catch (e: any) {
      showError(e);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conta de anúncios do Facebook</CardTitle>
        <CardDescription>Conecte sua conta do Facebook (com acesso à conta de anúncios) para carregar seus anúncios automaticamente.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {connections.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-muted-foreground">Carregando conexões...</p>
          </div>
        ) : connections.data && connections.data.length > 0 ? (
          <div className="space-y-2">
            <label className="text-sm font-medium">Conexões existentes</label>
            <div className="space-y-2">
              {connections.data.map((connection: any) => (
                <FacebookConnectionCard key={connection.id} connection={connection} onReconnect={handleReconnect} onDelete={handleDelete} isDeleting={disconnect.isPending} showActions={true} />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
              <IconBrandFacebook className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">Nenhuma conta do Facebook conectada ainda.</p>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <Button className="flex-1 flex items-center gap-2" variant={hasActiveConnection ? "outline" : "default"} onClick={handleConnect} disabled={connect.isPending}>
            {connect.isPending ? <IconLoader2 className="w-4 h-4 animate-spin" /> : <IconBrandFacebook className="w-4 h-4" />}
            {hasActiveConnection ? "Adicionar outra conta" : connect.isPending ? "Conectando..." : "Conectar Facebook"}
          </Button>
        </div>

        <div className="flex justify-between">
          <Button variant="outline" onClick={props.onBack}>
            <IconChevronLeft className="w-4 h-4 mr-1" />
            Voltar
          </Button>
          {hasActiveConnection && (
            <Button variant="default" className="flex items-center gap-1" onClick={props.onContinue}>
              <span>Continuar</span>
              <IconChevronRight className="w-4 h-4" />
            </Button>
          )}
        </div>
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

    // Marcar onboarding como completo após salvar os critérios
    try {
      await api.onboarding.complete();
    } catch (e: any) {
      console.error("Erro ao completar onboarding:", e);
      // Não bloquear o fluxo se houver erro ao marcar como completo
    }

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
        <CardTitle>Critério de Validação</CardTitle>
        <CardDescription>
          Defina a partir de <strong>quando um anúncio tem dados suficientes para ser analisado</strong>. Anúncios que não atendem esses critérios são considerados em fase de testes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
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

  const handleFinish = () => {
    // Onboarding já foi marcado como completo no passo anterior
    // Apenas redirecionar para a página de packs
    router.replace("/packs?openDialog=true");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pronto para carregar seus anúncios</CardTitle>
        <CardDescription>Seu ambiente inicial está configurado. Agora você pode carregar um Pack de Anúncios para começar a análise.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-6">
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
          { id: 1, label: "Preferências" },
          { id: 2, label: "Conectar Facebook" },
          { id: 3, label: "Critério de validação" },
          { id: 4, label: "Carregar Pack" },
        ]}
        currentStepId={step}
        variant="visual"
        onStepClick={(stepId) => setStep(stepId as Step)}
      />

      {step === 1 && <InitialSettingsStep onContinue={() => setStep(2)} />}
      {step === 2 && <FacebookStep onContinue={() => setStep(3)} onBack={() => setStep(1)} />}
      {step === 3 && <ValidationStep onContinue={() => setStep(4)} onBack={() => setStep(2)} />}
      {step === 4 && <SuccessStep onBack={() => setStep(3)} />}
    </div>
  );
}
