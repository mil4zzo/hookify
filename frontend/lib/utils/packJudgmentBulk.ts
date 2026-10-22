/**
 * Critérios de julgamento em MASSA (Biblioteca → Mais → Critérios de julgamento):
 * o que o diálogo mostra ao abrir para N packs, o que o save manda e como resume
 * o resultado. Funções puras, para o teste prender as decisões.
 *
 * Três estados por campo, decididos pelo texto comparado com o da ABERTURA:
 *   - igual ao que abriu   → chave ausente  → cada pack mantém o que tem;
 *   - diferente, com valor → define em todos;
 *   - diferente, vazio     → limpa em todos (só alcançável onde os packs
 *     concordavam: o campo abriu com o valor comum e foi apagado).
 * Onde os packs discordam o campo abre vazio, e voltar a vazio é "deixei como
 * veio". A regra anterior era "quem mexeu no campo": digitar e apagar num campo
 * divergente limpava o corte de todos os packs sem ninguém querer.
 *
 * O CPR alvo vai como PATCH por evento (valor define, `null` remove): os packs
 * não têm os mesmos eventos de conversão, e mandar o mapa inteiro apagaria a meta
 * dos eventos que só alguns têm. O backend funde com o mapa atual de cada pack.
 */

import { normalizeMqlLeadscoreMin, resolveJudgment } from "@/lib/judgment/resolveJudgment";
import type { AdsPack } from "@/lib/types";
import { normalizeLeadEconomics, type LeadEconomics } from "./leadEconomics";
import type { LeadEconomicsPayloadDecision } from "./leadEconomicsDraft";
import { formatActionTypeLabel, parseJudgmentNumber, type PackJudgmentFormValues } from "./packJudgmentForm";

// ── Abertura ─────────────────────────────────────────────────────────────────

export interface BulkJudgmentSeed {
  /** Campos pré-preenchidos só onde TODOS os packs concordam; vazio onde discordam. */
  form: PackJudgmentFormValues;
  /** União dos eventos de conversão dos packs, na ordem em que aparecem. */
  conversionTypes: string[];
  divergent: { mql: boolean; targetKeys: string[]; economics: boolean };
  /** Valores distintos do corte entre os packs (para dizer "70, 80 e não definido"). */
  mqlValues: Array<number | null>;
  /** O cadastro acordado por todos (já normalizado); null se discordam ou ninguém tem. */
  economicsSaved: LeadEconomics | null;
  /** Algum pack tem QUALQUER coisa gravada na economia do lead (é o que deixa apagar). */
  economicsRawExists: boolean;
  packsWithSheet: number;
}

export function seedBulkJudgment(packs: readonly AdsPack[]): BulkJudgmentSeed {
  const resolved = resolveJudgment([...packs]);
  const conversionTypes: string[] = [];
  const seen = new Set<string>();
  for (const pack of packs) {
    for (const type of Array.isArray(pack.conversion_types) ? pack.conversion_types : []) {
      if (!seen.has(type)) {
        seen.add(type);
        conversionTypes.push(type);
      }
    }
  }
  const targets: Record<string, string> = {};
  for (const type of conversionTypes) {
    const agreed = resolved.targetCprByActionType[type];
    targets[type] = agreed !== undefined ? String(agreed) : "";
  }

  const mqlValues: Array<number | null> = [];
  for (const pack of packs) {
    // Normalizado como na resolução: "70" (texto) e 70 não são dois cortes.
    const value = normalizeMqlLeadscoreMin(pack.mql_leadscore_min);
    if (!mqlValues.includes(value)) mqlValues.push(value);
  }

  return {
    form: { mql: resolved.mqlLeadscoreMin !== null ? String(resolved.mqlLeadscoreMin) : "", targets },
    conversionTypes,
    divergent: {
      mql: resolved.divergent.mqlLeadscoreMin,
      targetKeys: resolved.divergentTargetCprKeys,
      economics: resolved.divergent.leadEconomics,
    },
    mqlValues,
    economicsSaved: resolved.leadEconomics,
    economicsRawExists: packs.some((pack) => pack.lead_economics !== null && pack.lead_economics !== undefined),
    packsWithSheet: packs.filter((pack) => !!pack.sheet_integration).length,
  };
}

/** "70, 80 e não definido" — os cortes que os packs têm hoje, para explicar a divergência. */
export function describeMqlValues(values: ReadonlyArray<number | null>): string {
  const parts = values.map((value) => (value === null ? "não definido" : String(value)));
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

// ── O que o save faz com cada campo ──────────────────────────────────────────

export type BulkFieldEffect = "keep" | "set" | "clear";

/** O efeito de um campo no lote: igual à abertura não muda; diferente e vazio limpa. */
export function bulkFieldEffect(initialRaw: string, raw: string): BulkFieldEffect {
  if (raw.trim() === initialRaw.trim()) return "keep";
  return raw.trim() ? "set" : "clear";
}

/** Eventos cujo CPR alvo difere do que abriu (os únicos que vão no patch). */
export function changedBulkTargets(initial: PackJudgmentFormValues, form: PackJudgmentFormValues): string[] {
  return Object.keys(form.targets).filter((type) => bulkFieldEffect(initial.targets[type] ?? "", form.targets[type] ?? "") !== "keep");
}

/** Corpo do `POST /analytics/packs/bulk-judgment` (sem `pack_ids`). */
export interface BulkPackJudgmentPayload {
  mql_leadscore_min?: number | null;
  /** Patch por evento: valor define, `null` remove. */
  target_cpr?: Record<string, number | null>;
  lead_economics?: LeadEconomics | null;
}

export type BulkPackJudgmentPayloadResult =
  | { kind: "ok"; payload: BulkPackJudgmentPayload }
  /** Nada foi mexido: não há o que mandar (e não se fecha dizendo "salvo"). */
  | { kind: "empty" }
  | { kind: "error"; message: string; field: "mql" | "target" | "economics" };

/**
 * Formulário em massa → payload, ou o primeiro erro (na ordem da tela). Só os
 * campos que DIFEREM da abertura entram; a economia segue a decisão D21 do
 * diálogo (`omit` = não mexe, `set` com null = apaga em todos).
 */
export function buildBulkPackJudgmentPayload(
  form: PackJudgmentFormValues,
  initial: PackJudgmentFormValues,
  economics: LeadEconomicsPayloadDecision,
): BulkPackJudgmentPayloadResult {
  const payload: BulkPackJudgmentPayload = {};

  if (bulkFieldEffect(initial.mql, form.mql) !== "keep") {
    if (form.mql.trim()) {
      const parsed = parseJudgmentNumber(form.mql);
      if (parsed === null || parsed < 0) {
        return { kind: "error", field: "mql", message: "Informe um leadscore mínimo válido (número maior ou igual a zero)." };
      }
      payload.mql_leadscore_min = parsed;
    } else {
      payload.mql_leadscore_min = null;
    }
  }

  const targetPatch: Record<string, number | null> = {};
  for (const type of changedBulkTargets(initial, form)) {
    const raw = form.targets[type] ?? "";
    if (!raw.trim()) {
      targetPatch[type] = null;
      continue;
    }
    const parsed = parseJudgmentNumber(raw);
    if (parsed === null || parsed <= 0) {
      return { kind: "error", field: "target", message: `O CPR alvo de "${formatActionTypeLabel(type)}" precisa ser maior que zero.` };
    }
    targetPatch[type] = parsed;
  }
  if (Object.keys(targetPatch).length > 0) payload.target_cpr = targetPatch;

  if (economics.kind === "invalid") {
    return { kind: "error", field: "economics", message: economics.errors[0] ?? "Revise a economia do lead." };
  }
  if (economics.kind === "set") payload.lead_economics = economics.value;

  return Object.keys(payload).length === 0 ? { kind: "empty" } : { kind: "ok", payload };
}

// ── Moeda ────────────────────────────────────────────────────────────────────

/**
 * Moeda do ticket quando há N packs. Todos na mesma conta/moeda → ela. Contas com
 * moedas diferentes → a preferência de quem vê, com `mixed` para a tela avisar: o
 * ticket é um número só, e 3.000 em BRL não é 3.000 em USD. Nenhuma moeda
 * conhecida → preferência, como no pack único.
 */
export function resolveBulkPackCurrency(
  accountCurrencies: ReadonlyArray<string | null | undefined>,
  preferenceCurrency: string,
): { code: string; fromAccount: boolean; mixed: string[] } {
  const distinct: string[] = [];
  for (const raw of accountCurrencies) {
    const code = raw?.trim().toUpperCase();
    if (code && !distinct.includes(code)) distinct.push(code);
  }
  if (distinct.length === 1) return { code: distinct[0], fromAccount: true, mixed: [] };
  return { code: preferenceCurrency, fromAccount: false, mixed: distinct.length > 1 ? distinct : [] };
}

// ── Resultado ────────────────────────────────────────────────────────────────

export interface BulkPackJudgmentResult {
  pack_id: string;
  status: "updated" | "skipped" | "failed";
  /** `viewer`: você só lê este pack; `no_access`: pack que não é (mais) seu. */
  reason?: "viewer" | "no_access";
  error?: string;
  /** O que foi gravado NESTE pack (o CPR alvo já fundido com o que ele tinha). */
  judgment?: {
    mql_leadscore_min?: number | null;
    target_cpr?: Record<string, number> | null;
    lead_economics?: unknown;
  };
}

export interface BulkPackJudgmentResponse {
  results: BulkPackJudgmentResult[];
}

/** Patch do store a partir do que o backend gravou no pack. */
export function bulkJudgmentStorePatch(judgment: NonNullable<BulkPackJudgmentResult["judgment"]>): Partial<AdsPack> {
  const patch: Partial<AdsPack> = {};
  if ("mql_leadscore_min" in judgment) patch.mql_leadscore_min = judgment.mql_leadscore_min ?? null;
  if ("target_cpr" in judgment) patch.target_cpr = judgment.target_cpr ?? null;
  if ("lead_economics" in judgment) {
    // Canônico do backend; inválido (não deveria acontecer) vira "não configurado".
    patch.lead_economics = judgment.lead_economics === null ? null : normalizeLeadEconomics(judgment.lead_economics);
  }
  return patch;
}

export interface BulkJudgmentSummary {
  updated: string[];
  skipped: string[];
  failed: Array<{ name: string; error: string }>;
  headline: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function summarizeBulkJudgment(
  results: ReadonlyArray<BulkPackJudgmentResult>,
  packNames: Readonly<Record<string, string>>,
): BulkJudgmentSummary {
  const nameOf = (r: BulkPackJudgmentResult) => packNames[r.pack_id] || "Pack";
  const updated: string[] = [];
  const skipped: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  for (const r of results) {
    if (r.status === "updated") updated.push(nameOf(r));
    else if (r.status === "skipped") skipped.push(nameOf(r));
    else failed.push({ name: nameOf(r), error: r.error || "Erro ao salvar os critérios." });
  }
  const parts = [plural(updated.length, "pack atualizado", "packs atualizados")];
  if (skipped.length) parts.push(`${skipped.length} sem permissão`);
  if (failed.length) parts.push(plural(failed.length, "falhou", "falharam"));
  return { updated, skipped, failed, headline: parts.join(" · ") };
}
