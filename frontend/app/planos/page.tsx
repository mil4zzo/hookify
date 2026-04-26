"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageContainer } from "@/components/common/PageContainer";
import { PageIcon } from "@/lib/utils/pageIcon";
import { StandardCard } from "@/components/common/StandardCard";
import { Badge } from "@/components/ui/badge";
import {
  IconSparkles,
  IconCheck,
  IconLock,
} from "@tabler/icons-react";

const STANDARD_FEATURES = [
  "Packs — importe e gerencie seus anúncios",
  "Manager — análise de performance com agrupamentos",
  "Insights — oportunidades e gems dos seus criativos",
];

const INSIDER_FEATURES = [
  "Tudo do Standard",
  "Explorer — análise profunda de criativos",
  "G.O.L.D. — rankings dos melhores anúncios",
  "Upload — criação de anúncios em massa",
  "Meta Usage — monitoramento da API",
];

const PAGE_LABELS: Record<string, string> = {
  "/explorer": "Explorer",
  "/gold": "G.O.L.D.",
  "/upload": "Upload",
  "/meta-usage": "Meta Usage",
};

function PlanosContent() {
  const searchParams = useSearchParams();
  const from = searchParams.get("from");
  const blockedPage = from ? PAGE_LABELS[from] : null;

  return (
    <PageContainer
      title="Planos"
      description={
        blockedPage
          ? `Você precisa do plano Insider para acessar ${blockedPage}.`
          : "Escolha o plano ideal para o seu negócio."
      }
      icon={<PageIcon icon={IconSparkles} />}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
        {/* Standard */}
        <StandardCard padding="lg">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Standard</h2>
            <Badge variant="outline">Seu plano atual</Badge>
          </div>
          <ul className="space-y-2">
            {STANDARD_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                <IconCheck className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </StandardCard>

        {/* Insider */}
        <StandardCard padding="lg" variant="muted">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Insider</h2>
            <Badge>Recomendado</Badge>
          </div>
          <ul className="space-y-2 mb-5">
            {INSIDER_FEATURES.map((f, i) => (
              <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                {i === 0 ? (
                  <IconCheck className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                ) : (
                  <IconLock className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                )}
                <span className={i > 0 ? "text-foreground" : ""}>{f}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Quer acesso Insider?{" "}
            <a href="mailto:1milhaocom30@gmail.com" className="text-primary underline underline-offset-2">
              Entre em contato
            </a>
            .
          </p>
        </StandardCard>
      </div>
    </PageContainer>
  );
}

export default function PlanosPage() {
  return (
    <Suspense>
      <PlanosContent />
    </Suspense>
  );
}
