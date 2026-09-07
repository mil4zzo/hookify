import type { DateColumnProbe } from "@/lib/api/schemas";

/**
 * Regras do farol da coluna de data. Separado do componente porque é a parte
 * que decide (e a que erra em silêncio se estiver errada) — aqui ela é testável
 * sem montar React.
 */

/** Dias em comum entre duas janelas fechadas (inclusivas). 0 = não se cruzam. */
export function overlapDays(
  aStart?: string | null,
  aStop?: string | null,
  bStart?: string | null,
  bStop?: string | null,
): number | null {
  if (!aStart || !aStop || !bStart || !bStop) return null;
  // Datas ISO comparam corretamente como string; só o total vira aritmética.
  const start = aStart > bStart ? aStart : bStart;
  const stop = aStop < bStop ? aStop : bStop;
  if (start > stop) return 0;
  const ms = Date.parse(`${stop}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 86_400_000) + 1;
}

export type HealthTone = "ok" | "warn" | "error";

export interface HealthVerdict {
  tone: HealthTone;
  headline: string;
}

/**
 * Resume a saúde da coluna numa frase. Nunca bloqueia a importação: planilha que
 * ainda vai encher é caso legítimo, e um aviso que dá falso positivo só treina o
 * usuário a ignorar avisos.
 */
export function buildVerdict(
  probe: DateColumnProbe,
  selectedFormat: string,
  overlap: number | null,
): HealthVerdict {
  switch (probe.format_verdict) {
    case "empty":
      return { tone: "error", headline: "Essa coluna está vazia" };
    case "unreadable":
      return { tone: "error", headline: "Não consegui ler datas nessa coluna" };
    case "conflicting":
      return { tone: "error", headline: "Essa coluna mistura dois formatos de data" };
    case "ambiguous":
      return { tone: "warn", headline: "Escolha o formato: os dados não decidem sozinhos" };
    default:
      break;
  }

  // Discordância com o formato provado vem antes de tudo: é o único erro daqui
  // que corrompe em silêncio (dias 1–12 parseiam e vão para o dia errado).
  if (selectedFormat && selectedFormat !== probe.resolved_format) {
    return { tone: "error", headline: "O formato escolhido não bate com os dados" };
  }
  if (probe.readable_cells < probe.non_empty_cells) {
    return { tone: "warn", headline: "Algumas linhas têm data que não consigo ler" };
  }
  if (overlap === 0) {
    return { tone: "warn", headline: "A planilha não cobre o período do pack" };
  }
  return { tone: "ok", headline: "Tudo certo" };
}
