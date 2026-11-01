import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { createTranslator } from "next-intl";
import { LOCALE_COOKIE, resolveLocale } from "./config";
import { getMessages } from "./messages";

/** Páginas legais são públicas: o servidor lê o idioma do cookie e renderiza já traduzido. */
export async function getLegalT() {
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const t = (createTranslator as any)({ locale, messages: getMessages(locale), namespace: "legal" });
  const rich = {
    b: (c: ReactNode) => <strong>{c}</strong>,
    f: (c: ReactNode) => <strong className="text-foreground">{c}</strong>,
  };
  return { t: t as unknown as (key: string) => string, r: (key: string) => (t as any).rich(key, rich) as ReactNode, locale };
}
