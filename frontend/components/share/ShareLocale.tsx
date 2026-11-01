"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { pickLocale, setLocaleOverride, type AppLocale } from "@/lib/i18n/locale";
import { getMessages } from "@/lib/i18n/messages";

const STORAGE_KEY = "hookify-share-locale";
// Idiomas que o leitor pode escolher no seletor (os que o app tem completos).
// i18n-exception: é a lista de idiomas oferecidos ao leitor, não formatação
const CHOICES: readonly AppLocale[] = ["pt-BR", "en-US"];

const ShareLocaleContext = createContext<{ locale: AppLocale; toggle: () => void } | null>(null);

export function useShareLocale() {
  return useContext(ShareLocaleContext);
}

function readChoice(): AppLocale | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return CHOICES.find((choice) => choice === saved) ?? null;
  } catch {
    return null;
  }
}

/**
 * Página pública do link: o idioma é de quem LÊ (anônimo), não de quem criou o link.
 * Vem do navegador, com seletor para trocar (a escolha fica salva neste aparelho).
 * Só renderiza depois de saber o idioma: a página é noindex e o instante em branco é
 * menor do que mostrar português para quem lê em inglês.
 */
export function ShareLocale({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<AppLocale | null>(null);

  useEffect(() => {
    const next = readChoice() ?? pickLocale(navigator.languages?.length ? navigator.languages : [navigator.language]);
    setLocaleOverride(next);
    setLocale(next);
    return () => setLocaleOverride(null);
  }, []);

  useEffect(() => {
    if (locale) document.documentElement.lang = locale;
  }, [locale]);

  const toggle = useCallback(() => {
    setLocale((current) => {
      const next = CHOICES[(CHOICES.indexOf(current ?? CHOICES[0]) + 1) % CHOICES.length];
      setLocaleOverride(next);
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // sem armazenamento: a troca vale só nesta visita
      }
      return next;
    });
  }, []);

  const messages = useMemo(() => (locale ? getMessages(locale) : null), [locale]);
  const value = useMemo(() => (locale ? { locale, toggle } : null), [locale, toggle]);
  if (!locale || !messages || !value) return null;

  return (
    <ShareLocaleContext.Provider value={value}>
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC" onError={() => {}}>
        {children}
      </NextIntlClientProvider>
    </ShareLocaleContext.Provider>
  );
}
