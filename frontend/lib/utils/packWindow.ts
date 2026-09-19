/**
 * Edição do período do pack — espelho de `services/pack_window.plan_window_edit`.
 *
 * O backend decide o que pedir à Meta; este módulo reproduz a MESMA regra para o
 * diálogo mostrar as datas que vão ser pedidas de fato (e o que sai do pack, na
 * Etapa 2). Se um lado mudar sem o outro, o diálogo promete uma coisa e o job
 * faz outra.
 *
 * Regra da borda (medida em 2026-09-07 no caminho de produção): a Meta só
 * atribui a conversão ao dia se o clique estiver dentro da janela pedida. Então
 * todo dia gravado pela primeira vez precisa de N dias de história antes dele —
 * menos o início do pack, que é onde o Gerenciador também começa.
 */
import { addDays, subDays } from "date-fns";
import { formatDateLocal } from "./dateFilters";
import { lookbackDaysForPack, type RefreshWindowSource } from "./refreshWindow";

export interface WindowEditPlan {
  newStart: string;
  newStop: string;
  /** Fatia pedida à Meta (since, until) — null quando só reduz. */
  fetch: [string, string] | null;
  lookbackDays: number;
  /** Etapa 2 — apaga dias < newStart. */
  deleteBefore: string | null;
  /** Etapa 2 — apaga dias > newStop. */
  deleteAfter: string | null;
  /** Etapa 2 — dias em que par ausente na resposta sai do pack. */
  head: [string, string] | null;
  /** Terminar antes de hoje desliga o "manter atualizado". */
  autoRefreshOff: boolean;
  reduces: boolean;
}

export type WindowEditError =
  | "datas_invalidas"
  | "inicio_depois_do_fim"
  | "fim_no_futuro"
  | "mesmo_periodo"
  | "pack_sem_periodo";

const day = (s: string) => new Date(`${s}T12:00:00`);
const iso = (d: Date) => formatDateLocal(d);
const minIso = (a: string, b: string) => (a < b ? a : b);
const maxIso = (a: string, b: string) => (a > b ? a : b);
const isIsoDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Plano da edição, ou o motivo de não haver plano. Puro; não chama nada.
 */
export function planWindowEdit(
  pack: RefreshWindowSource | null | undefined,
  newStart: string,
  newStop: string,
  today: string,
): { plan: WindowEditPlan; error?: undefined } | { plan?: undefined; error: WindowEditError } {
  if (!isIsoDay(newStart) || !isIsoDay(newStop)) return { error: "datas_invalidas" };
  if (newStart > newStop) return { error: "inicio_depois_do_fim" };
  if (newStop > today) return { error: "fim_no_futuro" };
  const oldStart = (pack?.date_start || "").slice(0, 10);
  const oldStop = (pack?.date_stop || "").slice(0, 10);
  if (!isIsoDay(oldStart) || !isIsoDay(oldStop)) return { error: "pack_sem_periodo" };
  if (newStart === oldStart && newStop === oldStop) return { error: "mesmo_periodo" };

  const n = lookbackDaysForPack(pack);
  const slices: Array<[string, string]> = [];
  let deleteBefore: string | null = null;
  let deleteAfter: string | null = null;
  let head: [string, string] | null = null;

  if (newStart < oldStart) {
    // Emenda: os N primeiros dias antigos ganham os cliques do período novo.
    slices.push([newStart, minIso(iso(addDays(day(oldStart), n - 1)), newStop)]);
  } else if (newStart > oldStart) {
    deleteBefore = newStart;
    head = [newStart, minIso(iso(addDays(day(newStart), n - 1)), newStop)];
    slices.push(head);
  }

  if (newStop > oldStop) {
    // O primeiro dia novo (oldStop + 1) precisa de N dias de clique em cena.
    slices.push([maxIso(iso(subDays(day(oldStop), n - 1)), newStart), newStop]);
  } else if (newStop < oldStop) {
    deleteAfter = newStop;
  }

  let fetch: [string, string] | null = null;
  if (slices.length > 0) {
    fetch = [
      slices.map((s) => s[0]).reduce(minIso),
      slices.map((s) => s[1]).reduce(maxIso),
    ];
  }

  return {
    plan: {
      newStart,
      newStop,
      fetch,
      lookbackDays: n,
      deleteBefore,
      deleteAfter,
      head,
      autoRefreshOff: newStop < today,
      reduces: deleteBefore !== null || deleteAfter !== null,
    },
  };
}

/** Mensagem curta para o diálogo, por erro. */
export function windowEditErrorMessage(error: WindowEditError): string {
  switch (error) {
    case "datas_invalidas":
      return "Escolha as duas datas.";
    case "inicio_depois_do_fim":
      return "A data inicial não pode ser depois da data final.";
    case "fim_no_futuro":
      return "A data final não pode estar no futuro.";
    case "mesmo_periodo":
      return "Este já é o período do pack.";
    case "pack_sem_periodo":
      return "Este pack não tem período definido.";
  }
}
