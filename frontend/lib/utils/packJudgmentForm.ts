/**
 * Formulário da configuração do pack (`PackJudgmentDialog`): o que ele mostra ao
 * abrir, quando há alteração a proteger, em que moeda o dinheiro é digitado e o que
 * o save manda. Funções puras, para o teste cobrir o que o diálogo decide.
 */

import type { AdsPack } from "@/lib/types";
import type { LeadEconomics } from "./leadEconomics";
import type { LeadEconomicsPayloadDecision } from "./leadEconomicsDraft";

/** Corte de MQL e CPR alvo como TEXTO, do jeito que os campos guardam. */
export interface PackJudgmentFormValues {
  mql: string;
  /** Um texto por evento de conversão do pack ("" = sem meta). */
  targets: Record<string, string>;
}

/** O que os campos mostram ao abrir o diálogo para este pack. */
export function packJudgmentFormValues(
  pack: Pick<AdsPack, "mql_leadscore_min" | "target_cpr">,
  conversionTypes: readonly string[],
): PackJudgmentFormValues {
  const mql = pack.mql_leadscore_min;
  const packTarget = pack.target_cpr && typeof pack.target_cpr === "object" ? pack.target_cpr : null;
  const targets: Record<string, string> = {};
  for (const type of conversionTypes) {
    const value = packTarget?.[type];
    targets[type] = value !== undefined && value !== null ? String(value) : "";
  }
  return { mql: mql !== null && mql !== undefined ? String(mql) : "", targets };
}

/**
 * O corte de MQL ou algum CPR alvo foi mexido desde que o diálogo abriu? Compara o
 * texto (aparado): reescrever "70" como "70.0" conta como alteração — é o lado
 * seguro, o pior caso é o diálogo não fechar por Esc.
 */
export function isPackJudgmentFormDirty(initial: PackJudgmentFormValues, current: PackJudgmentFormValues): boolean {
  if (initial.mql.trim() !== current.mql.trim()) return true;
  const types = new Set([...Object.keys(initial.targets), ...Object.keys(current.targets)]);
  for (const type of types) {
    if ((initial.targets[type] ?? "").trim() !== (current.targets[type] ?? "").trim()) return true;
  }
  return false;
}

/**
 * Moeda da CONTA de anúncios do pack. O ticket da economia do lead é comparado com
 * o gasto da Meta, que vem na moeda da conta — não na preferência de quem vê (que
 * só acompanha a conta quando TODAS as contas do usuário têm a mesma moeda).
 *
 * `null` quando a conta não está na lista de quem vê (pack compartilhado de conta
 * alheia) ou ainda não tem moeda sincronizada: aí o diálogo cai na preferência.
 */
export function findAdAccountCurrency(
  accounts: ReadonlyArray<{ id: string; currency?: string | null }> | null | undefined,
  adaccountId: string | null | undefined,
): string | null {
  if (!adaccountId || !Array.isArray(accounts)) return null;
  const currency = accounts.find((account) => account?.id === adaccountId)?.currency?.trim();
  return currency ? currency.toUpperCase() : null;
}

/**
 * Moeda em que o diálogo mostra o ticket, e DE ONDE ela veio. `fromAccount: false` é
 * a preferência de quem vê, usada quando não deu para achar a moeda da conta do pack
 * (pack compartilhado de conta alheia, conta ainda sem moeda): a tela avisa, porque
 * um ticket digitado em R$ num pack que gasta em US$ daria um teto errado sem erro
 * nenhum.
 */
export function resolvePackCurrency(
  accountCurrency: string | null | undefined,
  preferenceCurrency: string,
): { code: string; fromAccount: boolean } {
  const account = accountCurrency?.trim();
  return account ? { code: account.toUpperCase(), fromAccount: true } : { code: preferenceCurrency, fromAccount: false };
}

// ── O que o save manda ───────────────────────────────────────────────────────

/** Remove o prefixo "conversion:"/"action:" do rótulo exibido. */
export function formatActionTypeLabel(option: string): string {
  return option.includes(":") ? option.split(":", 2)[1] : option;
}

/** Número de um campo do formulário (corte de MQL, CPR alvo): vazio ou lixo → `null`. */
export function parseJudgmentNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Corpo do PATCH de `/analytics/packs/{id}/judgment`. */
export interface PackJudgmentPayload {
  mql_leadscore_min: number | null;
  target_cpr: Record<string, number> | null;
  /** AUSENTE = não mexer na coluna (D21); `null` = apagar o cadastro. */
  lead_economics?: LeadEconomics | null;
}

export type PackJudgmentPayloadResult =
  | { kind: "ok"; payload: PackJudgmentPayload }
  /** Não salva. `field` diz o que acusar — "economics" também abre os erros nos campos do editor. */
  | { kind: "error"; message: string; field: "mql" | "target" | "economics" };

/**
 * Formulário → payload do save, ou o primeiro erro (na ordem da tela: corte de MQL,
 * CPR alvo, economia do lead).
 *
 * Corte e CPR alvo vão sempre: `null` explícito é o que LIMPA o valor. A economia só
 * vai quando MUDOU (D21) — a chave fica AUSENTE no "omit", nunca `null` (que apagaria
 * o cadastro gravado, e derrubaria o save inteiro num banco ainda sem a coluna).
 */
export function buildPackJudgmentPayload(
  form: PackJudgmentFormValues,
  economics: LeadEconomicsPayloadDecision,
): PackJudgmentPayloadResult {
  let mql: number | null = null;
  if (form.mql.trim()) {
    const parsed = parseJudgmentNumber(form.mql);
    if (parsed === null || parsed < 0) {
      return { kind: "error", field: "mql", message: "Informe um leadscore mínimo válido (número maior ou igual a zero)." };
    }
    mql = parsed;
  }

  const targets: Record<string, number> = {};
  for (const [type, raw] of Object.entries(form.targets)) {
    const parsed = parseJudgmentNumber(raw);
    if (parsed === null) continue; // vazio = sem meta para esse evento
    if (parsed <= 0) {
      return { kind: "error", field: "target", message: `O CPR alvo de "${formatActionTypeLabel(type)}" precisa ser maior que zero.` };
    }
    targets[type] = parsed;
  }

  if (economics.kind === "invalid") {
    return { kind: "error", field: "economics", message: economics.errors[0] ?? "Revise a economia do lead." };
  }

  const payload: PackJudgmentPayload = {
    mql_leadscore_min: mql,
    target_cpr: Object.keys(targets).length > 0 ? targets : null,
  };
  if (economics.kind === "set") payload.lead_economics = economics.value;
  return { kind: "ok", payload };
}
