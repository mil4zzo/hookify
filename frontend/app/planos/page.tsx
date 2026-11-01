"use client";

import { translate } from "@/lib/i18n/translate";
import { useTranslations } from "next-intl";
import { getAppLocale } from "@/lib/i18n/locale";
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

const STANDARD_FEATURES = ["packs", "manager", "insights"] as const;

const INSIDER_FEATURES = ["all", "explorer", "gold", "upload", "metaUsage"] as const;

const PAGE_LABELS: Record<string, string> = {
  "/explorer": "Explorer",
  "/gold": "G.O.L.D.",
  "/upload": "Upload",
  "/meta-usage": "Meta Usage",
};

type BillingPlan = "monthly" | "annual";

function PlanosContent() {
  const t = useTranslations("plans");
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
      toast.success(translate("plans.paymentConfirmed"));
      setActivating(true);
      // Clean query param from URL without full reload
      router.replace("/planos", { scroll: false });
    } else if (checkout === "cancel") {
      toast.info(translate("plans.checkoutCanceled"));
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
        toast.success(translate("plans.activated"));
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
          toast.success(translate("plans.activated"));
          setActivating(false);
        } else if (attempts >= 6) {
          clearInterval(interval);
          setActivating(false);
          toast.info(translate("plans.activationSlow"));
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
        toast.info(translate("plans.alreadySubscribed"));
        queryClient.invalidateQueries({ queryKey: ["user-tier"] });
        await handlePortal();
        return;
      }
      toast.error(translate("plans.checkoutError"));
      setLoading(null);
    }
  }

  async function handlePortal() {
    setLoading("portal");
    try {
      const { url } = await api.billing.createPortalSession();
      window.location.href = url;
    } catch {
      toast.error(translate("plans.portalError"));
      setLoading(null);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(getAppLocale(), { day: "2-digit", month: "long", year: "numeric" });
  }

  return (
    <PageContainer
      variant="standard"
      title={t("title")}
      description={
        blockedPage
          ? t("blocked", { page: blockedPage })
          : t("choose")
      }
      icon={<PageIcon icon={IconSparkles} />}
    >
      {/* Payment action required banner */}
      {requiresAction && (
        <Alert variant="destructive" className="max-w-2xl mb-4">
          <IconAlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("actionRequired")}</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-4 flex-wrap">
            <span>{t("actionRequiredBody")}</span>
            <Button size="sm" variant="destructive" onClick={handlePortal} disabled={loading === "portal"}>
              {loading === "portal" ? (
                <IconLoader2 className="w-3 h-3 animate-spin mr-1" />
              ) : (
                <IconExternalLink className="w-3 h-3 mr-1" />
              )}
              {t("authenticate")}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Cancel at period end notice */}
      {cancelAtPeriodEnd && expiresAt && !requiresAction && (
        <Alert className="max-w-2xl mb-4">
          <AlertDescription>
            {t.rich("canceledNotice", { date: formatDate(expiresAt), b: (c) => <strong>{c}</strong> })}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
        {/* Standard */}
        <StandardCard padding="lg">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Standard</h2>
            {!isInsider && <Badge variant="outline">{t("current")}</Badge>}
          </div>
          <ul className="space-y-2">
            {STANDARD_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                <IconCheck className="w-4 h-4 text-success mt-0.5 shrink-0" />
                <span>{t(`standardFeatures.${f}`)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm font-medium text-foreground">{t("free")}</p>
        </StandardCard>

        {/* Insider */}
        <StandardCard padding="lg" variant="muted">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-foreground">Insider</h2>
            {isInsider ? (
              <Badge>{t("current")}</Badge>
            ) : (
              <Badge>{t("recommended")}</Badge>
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
                <span className={i > 0 ? "text-foreground" : ""}>{t(`insiderFeatures.${f}`)}</span>
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
              {t("manage")}
            </Button>
          ) : (
            <div className="space-y-3">
              {/* Plan toggle */}
              <div className="flex items-center gap-2 bg-background rounded-md p-1 border border-border">
                <button
                  className={`flex-1 text-xs font-medium py-1.5 rounded-sm transition-colors ${
                    selectedPlan === "monthly"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setSelectedPlan("monthly")}
                >
                  {t("monthly")}
                </button>
                <button
                  className={`flex-1 text-xs font-medium py-1.5 rounded-sm transition-colors ${
                    selectedPlan === "annual"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => setSelectedPlan("annual")}
                >
                  {t("annual")}
                  <span className="ml-1 text-2xs opacity-80">−32%</span>
                </button>
              </div>

              {/* Price display */}
              <div className="text-center">
                {selectedPlan === "monthly" ? (
                  <span className="text-lg font-bold text-foreground">
                    R$97<span className="text-sm font-normal text-muted-foreground">{t("perMonth")}</span>
                  </span>
                ) : (
                  <div>
                    <span className="text-lg font-bold text-foreground">
                      R$790<span className="text-sm font-normal text-muted-foreground">{t("perYear")}</span>
                    </span>
                    <p className="text-xs text-muted-foreground">
                      {t("equivalent")}
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
                {t("subscribe")}
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
                    {t("payPix")}
                  </Button>
                  <p className="text-2xs text-muted-foreground text-center">
                    {t("pixNote")}
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
