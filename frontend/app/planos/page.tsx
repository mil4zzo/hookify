"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageContainer } from "@/components/common/PageContainer";
import { PageIcon } from "@/lib/utils/pageIcon";
import { StandardCard } from "@/components/common/StandardCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useUserTier } from "@/lib/hooks/useUserTier";
import { api } from "@/lib/api/endpoints";
import {
  IconSparkles,
  IconCheck,
  IconLock,
  IconLoader2,
  IconExternalLink,
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

type BillingPlan = "monthly" | "annual";

function PlanosContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: tier } = useUserTier();

  const from = searchParams.get("from");
  const checkout = searchParams.get("checkout");
  const blockedPage = from ? PAGE_LABELS[from] : null;
  const isInsider = tier === "insider" || tier === "admin";

  const [selectedPlan, setSelectedPlan] = useState<BillingPlan>("monthly");
  const [loading, setLoading] = useState<"checkout" | "portal" | null>(null);

  // Handle return from Stripe Checkout
  useEffect(() => {
    if (checkout === "success") {
      toast.success("Pagamento confirmado! Ativando sua conta Insider...");
      // Invalidate and retry until tier flips (webhook may lag a few seconds)
      let attempts = 0;
      const interval = setInterval(async () => {
        await queryClient.invalidateQueries({ queryKey: ["user-tier"] });
        attempts++;
        if (attempts >= 8) clearInterval(interval);
      }, 2000);
      // Clean query param from URL without full reload
      router.replace("/planos", { scroll: false });
    } else if (checkout === "cancel") {
      toast.info("Assinatura cancelada. Você pode tentar novamente quando quiser.");
      router.replace("/planos", { scroll: false });
    }
  }, [checkout, queryClient, router]);

  async function handleCheckout() {
    setLoading("checkout");
    try {
      const { url } = await api.billing.createCheckoutSession(selectedPlan);
      window.location.href = url;
    } catch {
      toast.error("Não foi possível iniciar o checkout. Tente novamente.");
      setLoading(null);
    }
  }

  async function handlePortal() {
    setLoading("portal");
    try {
      const { url } = await api.billing.createPortalSession();
      window.location.href = url;
    } catch {
      toast.error("Não foi possível abrir o portal. Tente novamente.");
      setLoading(null);
    }
  }

  return (
    <PageContainer
      variant="standard"
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
            {!isInsider && <Badge variant="outline">Seu plano atual</Badge>}
          </div>
          <ul className="space-y-2">
            {STANDARD_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                <IconCheck className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm font-medium text-foreground">Grátis</p>
        </StandardCard>

        {/* Insider */}
        <StandardCard padding="lg" variant="muted">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Insider</h2>
            {isInsider ? (
              <Badge>Seu plano atual</Badge>
            ) : (
              <Badge>Recomendado</Badge>
            )}
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

          {isInsider ? (
            <Button
              variant="outline"
              className="w-full"
              onClick={handlePortal}
              disabled={loading === "portal"}
            >
              {loading === "portal" ? (
                <IconLoader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <IconExternalLink className="w-4 h-4 mr-2" />
              )}
              Gerenciar assinatura
            </Button>
          ) : (
            <div className="space-y-3">
              {/* Plan toggle */}
              <div className="flex items-center gap-2 bg-background rounded-md p-1 border border-border">
                <button
                  className={`flex-1 text-xs font-medium py-1.5 rounded transition-colors ${
                    selectedPlan === "monthly"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setSelectedPlan("monthly")}
                >
                  Mensal
                </button>
                <button
                  className={`flex-1 text-xs font-medium py-1.5 rounded transition-colors ${
                    selectedPlan === "annual"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setSelectedPlan("annual")}
                >
                  Anual
                  <span className="ml-1 text-[10px] opacity-80">−32%</span>
                </button>
              </div>

              {/* Price display */}
              <div className="text-center">
                {selectedPlan === "monthly" ? (
                  <span className="text-lg font-bold text-foreground">
                    R$97<span className="text-sm font-normal text-muted-foreground">/mês</span>
                  </span>
                ) : (
                  <div>
                    <span className="text-lg font-bold text-foreground">
                      R$790<span className="text-sm font-normal text-muted-foreground">/ano</span>
                    </span>
                    <p className="text-xs text-muted-foreground">
                      Equivale a R$65,83/mês · parcelamento disponível
                    </p>
                  </div>
                )}
              </div>

              <Button
                className="w-full"
                onClick={handleCheckout}
                disabled={loading === "checkout"}
              >
                {loading === "checkout" && (
                  <IconLoader2 className="w-4 h-4 animate-spin mr-2" />
                )}
                Assinar Insider
              </Button>
            </div>
          )}
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
