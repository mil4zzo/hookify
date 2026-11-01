"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { useSettingsStore } from "@/lib/store/settings";
import { LOCALE_COOKIE, isSupportedLocale, type AppLocale } from "@/lib/i18n/config";
import { getMessages } from "@/lib/i18n/messages";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/**
 * Textos do app no idioma da preferência do usuário (a mesma de `getAppLocale()`).
 *
 * O servidor lê o idioma do cookie e já entrega a página nele (`initialLocale`): quem
 * usa o app em inglês não vê o português piscar. A preferência salva (`settings.language`)
 * continua mandando — quando ela muda, o cookie acompanha, para a próxima visita já
 * nascer certa. Só no primeiro acesso de um aparelho novo (sem cookie) há uma troca
 * depois que a preferência chega do banco.
 */
export function I18nProvider({ initialLocale, children }: { initialLocale: AppLocale; children: ReactNode }) {
  const language = useSettingsStore((state) => state.settings.language);
  const [locale, setLocale] = useState<AppLocale>(initialLocale);

  useEffect(() => {
    if (isSupportedLocale(language)) setLocale(language);
  }, [language]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
  }, [locale]);

  const messages = useMemo(() => getMessages(locale), [locale]);

  return (
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC" onError={() => {}}>
      {children}
    </NextIntlClientProvider>
  );
}
