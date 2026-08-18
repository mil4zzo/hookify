import {
  DEFAULT_DIAGNOSTIC_COST_METRIC,
  DEFAULT_MQL_LEADSCORE_MIN,
  DEFAULT_TARGET_CPR_BY_ACTION_TYPE,
  type DiagnosticCostMetric,
} from "@/lib/store/userPreferences";

/**
 * Resolução de configuração de julgamento com herança.
 *
 * `user_preferences` é o PADRÃO; cada pack pode sobrescrever. Coluna nula no
 * pack = herda. A regra de conflito para seleção múltipla é a mesma aplicada no
 * backend (`_resolve_mql_leadscore_min`) e no SQL
 * (`public.resolve_pack_mql_leadscore_min`) — os três precisam concordar, senão
 * o número da tabela diverge do número do gráfico:
 *
 *   0 packs                      -> padrão do usuário
 *   todos resolvem para o mesmo  -> esse valor
 *   divergem entre si            -> padrão do usuário, com `divergent` marcado
 *
 * Divergência cai no padrão em vez de erro porque julgamento não pode quebrar a
 * leitura — a UI é quem avisa que os packs discordam.
 */

/** Override gravado no pack. null/undefined = herda do usuário. */
export interface PackJudgmentOverride {
  mql_leadscore_min?: number | string | null;
  target_cpr?: Record<string, number> | null;
  diagnostic_cost_metric?: string | null;
}

export interface JudgmentDefaults {
  mqlLeadscoreMin: number;
  targetCprByActionType: Record<string, number>;
  diagnosticCostMetric: DiagnosticCostMetric;
}

export type JudgmentField = keyof JudgmentDefaults;

export type JudgmentSource = "user" | "pack";

export interface ResolvedJudgment extends JudgmentDefaults {
  /** Por campo: os packs selecionados discordam entre si? */
  divergent: Record<JudgmentField, boolean>;
  /** Algum campo divergente. */
  hasDivergence: boolean;
  /** Por campo: o valor efetivo veio de um override de pack ou do padrão do usuário? */
  source: Record<JudgmentField, JudgmentSource>;
}

export const JUDGMENT_FIELD_LABELS: Record<JudgmentField, string> = {
  mqlLeadscoreMin: "Leadscore mínimo para MQL",
  targetCprByActionType: "CPR alvo",
  diagnosticCostMetric: "Métrica de custo do diagnóstico",
};

// ── Normalizadores ────────────────────────────────────────────────────────────
// Um override inválido (negativo, NaN, tipo errado) é tratado como "sem override"
// em vez de propagar lixo para o julgamento.

export function normalizeMqlOverride(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export function normalizeTargetCprOverride(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [actionType, value] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n) && n > 0) out[actionType] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function normalizeDiagnosticCostMetricOverride(raw: unknown): DiagnosticCostMetric | null {
  return raw === "cpr" || raw === "cpmql" ? raw : null;
}

// ── Resolução genérica ────────────────────────────────────────────────────────

function resolveField<T>(
  packs: PackJudgmentOverride[],
  readOverride: (pack: PackJudgmentOverride) => T | null,
  fallback: T,
  identityOf: (value: T) => string
): { value: T; divergent: boolean; source: JudgmentSource } {
  if (packs.length === 0) {
    return { value: fallback, divergent: false, source: "user" };
  }

  const distinct = new Map<string, T>();
  let hasOverride = false;

  for (const pack of packs) {
    const override = readOverride(pack);
    const effective = override === null ? fallback : override;
    if (override !== null) hasOverride = true;
    distinct.set(identityOf(effective), effective);
  }

  if (distinct.size === 1) {
    const [value] = Array.from(distinct.values());
    // Quando nenhum pack sobrescreveu, o valor É o padrão — reportar 'pack' aqui
    // faria a UI dizer "vindo do pack" para quem nunca configurou nada.
    return { value, divergent: false, source: hasOverride ? "pack" : "user" };
  }

  return { value: fallback, divergent: true, source: "user" };
}

/** Chave estável para comparar mapas de CPR alvo independente da ordem das chaves. */
function targetCprIdentity(value: Record<string, number>): string {
  return JSON.stringify(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => [k, v])
  );
}

export function resolveJudgment(
  packs: PackJudgmentOverride[],
  defaults: Partial<JudgmentDefaults> | null | undefined
): ResolvedJudgment {
  const fallbackMql = normalizeMqlOverride(defaults?.mqlLeadscoreMin) ?? DEFAULT_MQL_LEADSCORE_MIN;
  const fallbackTarget = defaults?.targetCprByActionType ?? DEFAULT_TARGET_CPR_BY_ACTION_TYPE;
  const fallbackMetric = normalizeDiagnosticCostMetricOverride(defaults?.diagnosticCostMetric) ?? DEFAULT_DIAGNOSTIC_COST_METRIC;

  const safePacks = Array.isArray(packs) ? packs.filter(Boolean) : [];

  const mql = resolveField(
    safePacks,
    (pack) => normalizeMqlOverride(pack.mql_leadscore_min),
    fallbackMql,
    (value) => String(value)
  );

  const target = resolveField(
    safePacks,
    (pack) => normalizeTargetCprOverride(pack.target_cpr),
    fallbackTarget,
    targetCprIdentity
  );

  const metric = resolveField(
    safePacks,
    (pack) => normalizeDiagnosticCostMetricOverride(pack.diagnostic_cost_metric),
    fallbackMetric,
    (value) => value
  );

  const divergent: Record<JudgmentField, boolean> = {
    mqlLeadscoreMin: mql.divergent,
    targetCprByActionType: target.divergent,
    diagnosticCostMetric: metric.divergent,
  };

  return {
    mqlLeadscoreMin: mql.value,
    targetCprByActionType: target.value,
    diagnosticCostMetric: metric.value,
    divergent,
    hasDivergence: Object.values(divergent).some(Boolean),
    source: {
      mqlLeadscoreMin: mql.source,
      targetCprByActionType: target.source,
      diagnosticCostMetric: metric.source,
    },
  };
}
