/**
 * Resolução da configuração de julgamento a partir dos packs selecionados.
 *
 * O critério de julgamento é INERENTE ao pack (migration 110). Não há mais
 * herança de `user_preferences`: o corte de leadscore descreve a planilha que
 * produziu o dado, e a meta de CPR descreve o negócio daquele conjunto de
 * campanhas. `validation_criteria` e `diagnostic_cost_metric` continuam no
 * usuário — são controles de visualização e não passam por aqui.
 *
 * `null` significa NÃO DEFINIDO, nunca zero. Zero afirmaria "todo lead é MQL",
 * derrubando o CPMQL para um número excelente e falso. Sem valor, MQL e CPMQL
 * ficam INDISPONÍVEIS.
 *
 * A regra de conflito é a mesma dos outros dois lugares onde ela existe —
 * `_resolve_mql_leadscore_min` (backend) e `public.resolve_pack_mql_leadscore_min`
 * (SQL). Os três precisam concordar, senão o número da tabela diverge do número
 * do gráfico:
 *
 *   0 packs                      -> null
 *   todos concordam              -> esse valor
 *   discordam entre si           -> null, com `divergent` marcado
 */

/** Configuração gravada no pack. null/ausente = não definido. */
export interface PackJudgmentConfig {
  mql_leadscore_min?: number | string | null;
  target_cpr?: Record<string, number> | null;
}

export type JudgmentField = "mqlLeadscoreMin" | "targetCprByActionType";

export interface ResolvedJudgment {
  /** Corte de leadscore para MQL. null = não definido ou packs discordam. */
  mqlLeadscoreMin: number | null;
  /** Meta de CPR por action_type. Chave ausente = sem meta acordada para o tipo. */
  targetCprByActionType: Record<string, number>;
  /** Por campo: os packs selecionados discordam entre si? */
  divergent: Record<JudgmentField, boolean>;
  /** Algum campo divergente. */
  hasDivergence: boolean;
  /** action_types cuja meta foi descartada por divergência — para a UI explicar. */
  divergentTargetCprKeys: string[];
}

export const JUDGMENT_FIELD_LABELS: Record<JudgmentField, string> = {
  mqlLeadscoreMin: "Leadscore mínimo para MQL",
  targetCprByActionType: "CPR alvo",
};

// ── Normalizadores ────────────────────────────────────────────────────────────
// Valor inválido (negativo, NaN, tipo errado) vira "não definido" em vez de
// propagar lixo para o julgamento.

export function normalizeMqlLeadscoreMin(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function normalizeTargetCpr(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [actionType, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n) && n > 0) out[actionType] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ── Resolução ─────────────────────────────────────────────────────────────────

function resolveMql(packs: PackJudgmentConfig[]): { value: number | null; divergent: boolean } {
  if (packs.length === 0) return { value: null, divergent: false };

  const distinct = new Set<number | null>();
  for (const pack of packs) distinct.add(normalizeMqlLeadscoreMin(pack.mql_leadscore_min));

  if (distinct.size === 1) {
    // Pode ser null: pack único sem corte definido. Não é divergência — é ausência.
    return { value: Array.from(distinct)[0], divergent: false };
  }
  return { value: null, divergent: true };
}

/**
 * Meta de CPR resolvida POR CHAVE.
 *
 * Tudo-ou-nada descartaria metas perfeitamente acordadas por causa de um único
 * action_type divergente. Cada tipo de conversão resolve sozinho.
 *
 * Um pack que não define a chave conta como discordância, não como omissão: "sem
 * meta" contradiz "meta de 15" tanto quanto "meta de 30" contradiz.
 */
function resolveTargetCpr(packs: PackJudgmentConfig[]): {
  value: Record<string, number>;
  divergent: boolean;
  divergentKeys: string[];
} {
  if (packs.length === 0) {
    return { value: {}, divergent: false, divergentKeys: [] };
  }

  const normalized = packs.map((pack) => normalizeTargetCpr(pack.target_cpr) ?? {});
  const allKeys = new Set<string>();
  for (const map of normalized) for (const key of Object.keys(map)) allKeys.add(key);

  const value: Record<string, number> = {};
  const divergentKeys: string[] = [];

  for (const key of allKeys) {
    const values = new Set(normalized.map((map) => map[key] ?? null));
    const only = values.size === 1 ? Array.from(values)[0] : null;
    if (only !== null) value[key] = only;
    else divergentKeys.push(key);
  }

  divergentKeys.sort();
  return { value, divergent: divergentKeys.length > 0, divergentKeys };
}

export function resolveJudgment(packs: PackJudgmentConfig[]): ResolvedJudgment {
  const safePacks = Array.isArray(packs) ? packs.filter(Boolean) : [];

  const mql = resolveMql(safePacks);
  const target = resolveTargetCpr(safePacks);

  const divergent: Record<JudgmentField, boolean> = {
    mqlLeadscoreMin: mql.divergent,
    targetCprByActionType: target.divergent,
  };

  return {
    mqlLeadscoreMin: mql.value,
    targetCprByActionType: target.value,
    divergent,
    hasDivergence: Object.values(divergent).some(Boolean),
    divergentTargetCprKeys: target.divergentKeys,
  };
}
