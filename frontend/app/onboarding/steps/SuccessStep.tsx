"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { IconChevronRight, IconChevronLeft, IconLoader2 } from "@tabler/icons-react";
import { FormPageSection } from "@/components/common/layout";
import { api } from "@/lib/api/endpoints";
import { useQueryClient } from "@tanstack/react-query";
import { patchOnboardingStatusCache } from "@/lib/hooks/useOnboardingStatus";
import { showError } from "@/lib/utils/toast";

export function SuccessStep(props: { onBack: () => void }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isFinishing, setIsFinishing] = useState(false);

  // Marcar a conclusao AQUI e nao so no passo 3: quem cai direto neste passo
  // (o calculo de passo inicial pode traze-lo para ca) sairia com
  // has_completed_onboarding=false e o gate do app o devolveria para o
  // onboarding — laco sem saida, sem nenhuma mensagem.
  const handleFinish = async () => {
    if (isFinishing) return;
    setIsFinishing(true);
    try {
      await api.onboarding.complete();
      patchOnboardingStatusCache(queryClient, { has_completed_onboarding: true });
      router.replace("/packs?openDialog=true");
    } catch (e) {
      setIsFinishing(false);
      showError(e as Error);
    }
  };

  return (
    <FormPageSection title="Pronto para carregar seus anúncios" description="Seu ambiente inicial está configurado. Agora você pode carregar um Pack de Anúncios para começar a análise.">
        <Button className="w-full flex items-center gap-2" size="lg" onClick={handleFinish} disabled={isFinishing}>
          {isFinishing ? <IconLoader2 className="w-4 h-4 animate-spin" /> : null}
          Carregue seu primeiro Pack de Anúncios
          {isFinishing ? null : <IconChevronRight className="w-4 h-4" />}
        </Button>
        <div className="flex justify-start">
          <Button variant="outline" onClick={props.onBack}>
            <IconChevronLeft className="w-4 h-4 mr-1" />
            Voltar
          </Button>
        </div>
    </FormPageSection>
  );
}
