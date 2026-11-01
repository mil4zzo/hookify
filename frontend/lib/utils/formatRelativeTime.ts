import { translate } from "@/lib/i18n/translate";
import { formatLocaleDate } from "@/lib/i18n/locale";

export interface FormatRelativeTimeResult {
  text: string;
  /** Preenchido quando a atualização foi há mais de 2 dias; usar em title/hover para mostrar data exata */
  tooltip?: string;
}

function hhmm(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Formata data/hora para exibição em tooltip: "Atualizado em DD/MM/YYYY às HH:mm"
 */
export function formatFullDateTimeTooltip(date: Date): string {
  const dateText = formatLocaleDate(date, { day: "2-digit", month: "2-digit", year: "numeric" });
  return translate("utils.relativeTime.fullDate", { date: dateText, time: hhmm(date) });
}

function isYesterday(date: Date, now: Date): boolean {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const dateDayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return dateDayStart.getTime() === yesterdayStart.getTime();
}

/**
 * Formata o tempo relativo desde uma data até agora.
 * Para atualizações há mais de 2 dias, retorna tooltip com a data exata (exibir no hover).
 *
 * @param dateTimeString - Data/hora no formato ISO string (ex: "2024-01-15T10:30:00Z")
 * @returns Objeto com text (texto principal) e tooltip opcional (data exata para hover)
 */
export function formatRelativeTime(dateTimeString: string): FormatRelativeTimeResult {
  if (!dateTimeString) {
    return { text: translate("utils.relativeTime.never") };
  }

  try {
    const date = new Date(dateTimeString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();

    if (diffMs < 0) {
      return {
        text: formatFullDateTimeTooltip(date),
      };
    }

    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMinutes < 1) {
      return { text: translate("utils.relativeTime.now") };
    }

    if (diffMinutes < 60) {
      return { text: translate("utils.relativeTime.minutes", { count: diffMinutes }) };
    }

    // Tudo baseado em dia de calendário: ontem → "ontem às HH:mm"; mesmo dia 1h+ → "há Xh"; 2+ dias → "há X dias/meses/anos"
    const tooltip = formatFullDateTimeTooltip(date);
    if (isYesterday(date, now)) {
      return { text: translate("utils.relativeTime.yesterday", { time: hhmm(date) }), tooltip };
    }

    // Mesmo dia (diffDays === 0) e já passou de 1h: "há Xh e Y min(s)"
    if (diffDays === 0) {
      const remainingMinutes = diffMinutes % 60;
      if (remainingMinutes === 0) {
        return { text: translate("utils.relativeTime.hours", { hours: diffHours }) };
      }
      return { text: translate("utils.relativeTime.hoursMinutes", { hours: diffHours, minutes: remainingMinutes }) };
    }

    // diffDays === 1 mas NÃO é ontem no calendário (timestamp de ~24-48h atrás que cai no
    // anteontem por fuso/borda de dia). Sem este ramo, cai no cálculo de anos abaixo e vira
    // "Atualizado há 0 anos" (Math.floor(1/365) === 0) — texto sem sentido.
    if (diffDays === 1) {
      return { text: translate("utils.relativeTime.days", { count: 1 }), tooltip };
    }

    // 2+ dias no calendário
    if (diffDays === 2) {
      return { text: translate("utils.relativeTime.days", { count: 2 }), tooltip };
    }

    if (diffDays >= 3 && diffDays <= 29) {
      return { text: translate("utils.relativeTime.days", { count: diffDays }), tooltip };
    }

    if (diffDays >= 30 && diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return { text: translate("utils.relativeTime.months", { count: months }), tooltip };
    }

    const years = Math.floor(diffDays / 365);
    return { text: translate("utils.relativeTime.years", { count: years }), tooltip };
  } catch {
    return { text: translate("utils.relativeTime.invalid") };
  }
}
