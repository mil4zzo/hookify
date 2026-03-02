export interface FormatRelativeTimeResult {
  text: string;
  /** Preenchido quando a atualização foi há mais de 2 dias; usar em title/hover para mostrar data exata */
  tooltip?: string;
}

/**
 * Formata data/hora para exibição em tooltip: "Atualizado em DD/MM/YYYY às HH:mm"
 */
export function formatFullDateTimeTooltip(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `Atualizado em ${day}/${month}/${year} às ${hours}:${minutes}`;
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
    return { text: "Nunca atualizado" };
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
      return { text: "Atualizado agora" };
    }

    if (diffMinutes < 60) {
      const min = diffMinutes === 1 ? "min" : "mins";
      return { text: `Atualizado há ${diffMinutes} ${min}` };
    }

    // Tudo baseado em dia de calendário: ontem → "ontem às HH:mm"; mesmo dia 1h+ → "há Xh"; 2+ dias → "há X dias/meses/anos"
    const tooltip = formatFullDateTimeTooltip(date);
    if (isYesterday(date, now)) {
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      return { text: `Atualizado ontem às ${hours}:${minutes}`, tooltip };
    }

    // Mesmo dia (diffDays === 0) e já passou de 1h: "há Xh e Y min(s)"
    if (diffDays === 0) {
      const remainingMinutes = diffMinutes % 60;
      if (remainingMinutes === 0) {
        return { text: `Atualizado há ${diffHours}h` };
      }
      const min = remainingMinutes === 1 ? "min" : "mins";
      return { text: `Atualizado há ${diffHours}h e ${remainingMinutes} ${min}` };
    }

    // 2+ dias no calendário
    if (diffDays === 2) {
      return { text: "Atualizado há 2 dias", tooltip };
    }

    if (diffDays >= 3 && diffDays <= 29) {
      return { text: `Atualizado há ${diffDays} dias`, tooltip };
    }

    if (diffDays >= 30 && diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      const mes = months === 1 ? "mês" : "meses";
      return { text: `Atualizado há ${months} ${mes}`, tooltip };
    }

    const years = Math.floor(diffDays / 365);
    const ano = years === 1 ? "ano" : "anos";
    return { text: `Atualizado há ${years} ${ano}`, tooltip };
  } catch {
    return { text: "Data inválida" };
  }
}
