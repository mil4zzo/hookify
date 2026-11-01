import { enUS, ptBR } from "date-fns/locale";
import type { Locale } from "date-fns";
import { getAppLocale } from "@/lib/i18n/locale";

/** Locale do date-fns acompanhando o idioma do app (espanhol ainda cai no inglês). */
export function getDateFnsLocale(): Locale {
  return getAppLocale().startsWith("pt") ? ptBR : enUS;
}
