"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { useSettingsStore } from "@/lib/store/settings";
import { DEFAULT_LOCALE, isSupportedLocale } from "@/lib/i18n/locale";
import { getMessages } from "@/lib/i18n/messages";

/**
 * Textos do app no idioma da preferência do usuário (a mesma de `getAppLocale()`).
 *
 * Antes de montar no navegador usa o idioma padrão: o servidor não sabe o idioma
 * salvo, e renderizar outro na primeira passada deixaria o HTML diferente do que o
 * React espera (aviso de hidratação e texto piscando). Depois do primeiro render o
 * idioma real entra.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const language = useSettingsStore((state) => state.settings.language);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const locale = mounted && isSupportedLocale(language) ? language : DEFAULT_LOCALE;
  const messages = useMemo(() => getMessages(locale), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC" onError={() => {}}>
      {children}
    </NextIntlClientProvider>
  );
}
