"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useSettingsStore } from "@/lib/store/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { IconChevronRight, IconLoader2 } from "@tabler/icons-react";
import { FormPageSection } from "@/components/common/layout";
import { api } from "@/lib/api/endpoints";
import { useQueryClient } from "@tanstack/react-query";
import { patchOnboardingStatusCache } from "@/lib/hooks/useOnboardingStatus";
import { showError, showSuccess } from "@/lib/utils/toast";

const CURRENCY_CODES = ["USD", "EUR", "GBP", "BRL", "MXN", "CAD", "AUD", "JPY", "CNY"] as const;

export function InitialSettingsStep(props: { onContinue: () => void }) {
  const t = useTranslations("onboarding.settings");
  const tCurrencies = useTranslations("onboarding.currencies");
  const tc = useTranslations("common");
  const [language, setLanguage] = useState<string>("pt-BR");
  const [currency, setCurrency] = useState<string>("BRL");
  const [niche, setNiche] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const queryClient = useQueryClient();

  // O idioma escolhido vale na hora: o resto do onboarding já aparece nele.
  const handleLanguageChange = (value: string) => {
    setLanguage(value);
    useSettingsStore.getState().setLanguage(value);
  };

  const handleSave = async () => {
    if (!language || !currency) {
      showError({ message: t("requiredFields") });
      return;
    }

    setIsSaving(true);
    try {
      await api.onboarding.saveInitialSettings({
        language,
        currency,
        niche: niche || "",
      });
      patchOnboardingStatusCache(queryClient, { initial_settings_configured: true });
      showSuccess(t("saved"));
      props.onContinue();
    } catch (e: any) {
      showError(e);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <FormPageSection
      title={t("title")}
      description={t.rich("description", { b: (chunks) => <strong>{chunks}</strong> })}
      density="spacious"
    >
        {/* Idioma */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("language")}</label>
          <Select value={language} onValueChange={handleLanguageChange} disabled={isSaving}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("languagePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pt-BR">Português</SelectItem>
              <SelectItem value="en-US">English</SelectItem>
              <SelectItem value="es-ES" disabled>
                Espanhol
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t("languageHint")}</p>
        </div>

        {/* Moeda */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("currency")}</label>
          <Select value={currency} onValueChange={setCurrency} disabled={isSaving}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("currencyPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {CURRENCY_CODES.map((code) => (
                <SelectItem key={code} value={code}>
                  {tCurrencies(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t("currencyHint")}</p>
        </div>

        {/* Nicho */}
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("niche")}</label>
          <Input type="text" placeholder={t("nichePlaceholder")} value={niche} onChange={(e) => setNiche(e.target.value)} disabled={isSaving} />
          <p className="text-xs text-muted-foreground">{t("nicheHint")}</p>
        </div>

        <div className="flex justify-end">
          <Button variant="default" className="flex items-center gap-1" onClick={handleSave} disabled={isSaving || !language || !currency}>
            {isSaving ? (
              <>
                <IconLoader2 className="w-4 h-4 animate-spin" />
                {tc("saving")}
              </>
            ) : (
              <>
                <span>{tc("continue")}</span>
                <IconChevronRight className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>
    </FormPageSection>
  );
}
