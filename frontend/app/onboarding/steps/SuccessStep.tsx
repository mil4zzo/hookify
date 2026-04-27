"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { IconChevronRight, IconChevronLeft } from "@tabler/icons-react";
import { FormPageSection } from "@/components/common/layout";

export function SuccessStep(props: { onBack: () => void }) {
  const router = useRouter();

  const handleFinish = () => {
    router.replace("/packs?openDialog=true");
  };

  return (
    <FormPageSection title="Pronto para carregar seus anúncios" description="Seu ambiente inicial está configurado. Agora você pode carregar um Pack de Anúncios para começar a análise.">
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
    </FormPageSection>
  );
}
