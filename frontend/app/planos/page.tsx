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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useUserTier, useSubscription, type SubscriptionData } from "@/lib/hooks/useUserTier";
import { api } from "@/lib/api/endpoints";
import { env } from "@/lib/config/env";
import {
  IconSparkles,
  IconCheck,
  IconLock,
  IconLoader2,
  IconExternalLink,
  IconAlertTriangle,
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
  const { data: sub } = useSubscription();

  const from = searchParams.get("from");
  const checkout = searchParams.get("checkout");
  const blockedPage = from ? PAGE_LABELS[from] : null;

  // A user is treated as insider for UI purposes if effective tier says so,
  // OR if they have a stripe sub in past_due/requires_action (still in grace — show "Manage")
  const isInsider = tier === "insider" || tier === "admin";
  const hasActiveStripeSub =
    isInsider ||
    sub?.stripe_status === "past_due" ||
    sub?.stripe_status === "requires_action";

  const requiresAction = sub?.stripe_status === "requires_action";
  const cancelAtPeriodEnd = sub?.cancel_at_period_end === true;
  const expiresAt = sub?.expires_at;

  const [selectedPlan, setSelectedPlan] = useState<BillingPlan>("monthly");
  const [loading, setLoading] = useState<"checkout" | "pix" | "portal" | null>(null);
  const [activating, setActivating] = useState(false);

  // Handle return from Stripe Checkout (URL param → toast + kick off activation)
  useEffect(() => {
    if (checkout === "success") {
      toast.success("Pagamento confirmado! Ativando sua conta Insider...");
      setActivating(true);
      // Clean query param from URL without full reload
      router.replace("/planos", { scroll: false });
    } else if (checkout === "cancel") {
      toast.info("Assinatura cancelada. Você pode tentar novamente quando quiser.");
      router.replace("/planos", { scroll: false });
    }
  }, [checkout, router]);

  // Activation: reconcile directly with Stripe (doesn't depend on the webhook
  // having arrived), then briefly poll as fallback. Separate effect so the URL
  // cleanup above doesn't cancel it; cleanup covers unmount mid-poll.
  useEffect(() => {
    if (!activating) return;
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    const isActivated = () => {
      const data = queryClient.getQueryData<SubscriptionData>(["user-tier"]);
      return data?.effectiveTier === "insider" || data?.effectiveTier === "admin";
    };

    (async () => {
      let confirmed = false;
      try {
        const res = await api.billing.syncSubscription();
        confirmed = res.tier === "insider" || res.tier === "admin";
      } catch {
        // sync indisponível — o webhook continua sendo o caminho de ativação
      }
      if (cancelled) return;
      await queryClient.invalidateQueries({ queryKey: ["user-tier"] });
      if (cancelled) return;
      if (confirmed || isActivated()) {
        toast.success("Conta Insider ativada!");
        setActivating(false);
        return;
      }
      // Fallback: webhook pode estar a caminho — poll por ~15s
      let attempts = 0;
      interval = setInterval(async () => {
        attempts++;
        await queryClient.invalidateQueries({ queryKey: ["user-tier"] });
        if (cancelled) return;
        if (isActivated()) {
          clearInterval(interval);
          toast.success("Conta Insider ativada!");
          setActivating(false);
        } else if (attempts >= 6) {
          clearInterval(interval);
          setActivating(false);
          toast.info(
            "A ativação está demorando um pouco mais que o normal. Atualize a página em instantes."
          );
        }
      }, 2500);
    })();

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [activating, queryClient]);

  async function handleCheckout(paymentMethod: "card" | "pix" = "card") {
    setLoading(paymentMethod === "pix" ? "pix" : "checkout");
    try {
      const { url } = await api.billing.createCheckoutSession(selectedPlan, paymentMethod);
      window.location.href = url;
    } catch (err) {
      // 409 = já existe assinatura ativa (aba antiga/estado desatualizado) —
      // duplicar cobraria duas vezes; o portal é o lugar certo para gerenciar
      if ((err as { status?: number })?.status === 409) {
        toast.info("Você já tem uma assinatura ativa. Abrindo o portal...");
        queryClient.invalidateQueries({ queryKey: ["user-tier"] });
        await handlePortal();
        return;
      }
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

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
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
      {/* Payment action required banner */}
      {requiresAction && (
        <Alert variant="destructive" className="max-w-2xl mb-4">
          <IconAlertTriangle className="h-4 w-4" />
          <AlertTitle>Ação necessária — autenticação de pagamento</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-4 flex-wrap">
            <span>
              Seu último pagamento exige autenticação 3DS. Complete-o antes do vencimento
              para manter o acesso Insider.
            </span>
            <Button size="sm" variant="destructive" onClick={handlePortal} disabled={loading === "portal"}>
              {loading === "portal" ? (
                <IconLoader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <IconExternalLink className="w-3 h-3 mr-1" />
              )}
              Autenticar pagamento
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Cancel at period end notice */}
      {cancelAtPeriodEnd && expiresAt && !requiresAction && (
        <Alert className="max-w-2xl mb-4">
          <AlertDescription>
            Seu plano Insider foi cancelado e permanece ativo até{" "}
            <strong>{formatDate(expiresAt)}</strong>. Reative no portal para continuar.
          </AlertDescription>
        </Alert>
      )}

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
                <IconCheck className="w-4 h-4 text-success mt-0.5 shrink-0" />
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
                  <IconCheck className="w-4 h-4 text-success mt-0.5 shrink-0" />
                ) : (
                  <IconLock className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                )}
                <span className={i > 0 ? "text-foreground" : ""}>{f}</span>
              </li>
            ))}
          </ul>

          {/* Show "Manage" when user has or had an active Stripe subscription —
              prevents creating a duplicate subscription after grace period expires */}
          {hasActiveStripeSub ? (
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
                  <span className="ml-1 text-2xs opacity-80">−32%</span>
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
                onClick={() => handleCheckout("card")}
                disabled={loading === "checkout" || loading === "pix"}
              >
                {loading === "checkout" && (
                  <IconLoader2 className="w-4 h-4 animate-spin mr-2" />
                )}
                Assinar Insider
              </Button>

              {/* Pix: pagamento avulso de 12 meses (Pix não suporta recorrência) */}
              {selectedPlan === "annual" && env.BILLING_PIX_ENABLED && (
                <>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => handleCheckout("pix")}
                    disabled={loading === "checkout" || loading === "pix"}
                  >
                    {loading === "pix" && (
                      <IconLoader2 className="w-4 h-4 animate-spin mr-2" />
                    )}
                    Pagar anual com Pix
                  </Button>
                  <p className="text-2xs text-muted-foreground text-center">
                    Pix: 12 meses de acesso, sem renovação automática.
                  </p>
                </>
              )}
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
