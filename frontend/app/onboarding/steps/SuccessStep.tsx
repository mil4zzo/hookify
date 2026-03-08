"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconChevronRight, IconChevronLeft } from "@tabler/icons-react";

export function SuccessStep(props: { onBack: () => void }) {
  const router = useRouter();

  const handleFinish = () => {
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
