import { computeAdDerivedMetrics } from "@/lib/utils/goldClassification";
import type { GoldBucket } from "@/lib/utils/goldClassification";
import type { RankingsItem, RankingsResponse } from "@/lib/api/schemas";
import type { OpportunityRow } from "@/lib/utils/opportunity";

export type Verdict = "gem" | "otimizar" | "licao" | "descartar" | "observar";

// Alavancas de custo (decomposição do CPR): só estas têm cpr_if_*_only.
export type FixLeverKey = "website_ctr" | "connect_rate" | "page_conv";
// Pontos fortes a reciclar incluem o Hook (não entra no CPR, mas é um eixo do veredito).
export type StrongLeverKey = "hook" | "website_ctr" | "connect_rate" | "page_conv";

export type ActionItem = {
  ad: RankingsItem;
  verdict: Verdict;
  sourceBucket: GoldBucket | "not_validated";
  costActual: number;
  costTarget?: number;
  lowData: boolean;
  // otimizar: métricas abaixo da média que podem ser melhoradas, ordenadas por impacto (maior ganho de CPR primeiro)
  fixLevers: FixLeverKey[];
  // licao: métricas acima da média que valem reciclar, ordenadas da mais forte para a menos forte
  strongLevers: StrongLeverKey[];
  costPotential?: number;
  impactSavings?: number;
  priority: number;
};

export type ActionPlan = Record<Verdict, ActionItem[]>;

// Cascata hierárquica §8.6 — eixo absoluto é PRIMÁRIO.
// Chamada apenas quando alvo > 0 e custo é finito.
export function classifyActionVerdict(
  custo: number,
  alvo: number,
  metricsAboveCount: number
): "gem" | "otimizar" | "licao" | "descartar" {
  if (custo <= alvo) {
    return metricsAboveCount === 3 ? "gem" : "otimizar";
  }
  return metricsAboveCount === 0 ? "descartar" : "licao";
}

const BUCKET_FALLBACK: Record<GoldBucket, Verdict> = {
  golds: "gem",
  oportunidades: "otimizar",
  licoes: "licao",
  descartes: "descartar",
  neutros: "observar",
};

function countMetricsAbove(
  ad: RankingsItem,
  averages: RankingsResponse["averages"],
  actionType: string
): number {
  const m = computeAdDerivedMetrics(ad, actionType);
  const avgHook = averages?.hook ?? null;
  const avgWctr = averages?.website_ctr ?? null;
  const avgPconv = averages?.per_action_type?.[actionType]?.page_conv ?? null;
  if (avgHook === null || avgWctr === null || avgPconv === null) return 0;
  return [m.hook > avgHook, m.website_ctr > avgWctr, m.page_conv > avgPconv].filter(Boolean).length;
}

// Alavancas a corrigir (otimizar): todas as métricas abaixo da média, ordenadas por impacto.
// Menor CPR-se-corrigida-sozinha = maior ganho → vem primeiro.
function pickFixLevers(row: OpportunityRow | undefined): FixLeverKey[] {
  if (!row) return [];
  const candidates: [FixLeverKey, number][] = [];
  if (row.below_avg_flags.website_ctr) candidates.push(["website_ctr", row.cpr_if_website_ctr_only]);
  if (row.below_avg_flags.connect_rate) candidates.push(["connect_rate", row.cpr_if_connect_rate_only]);
  if (row.below_avg_flags.page_conv) candidates.push(["page_conv", row.cpr_if_page_conv_only]);
  return candidates.sort((a, b) => a[1] - b[1]).map(([lever]) => lever);
}

// Pontos fortes a reciclar (licao): todas as métricas ACIMA da média, ordenadas da mais
// forte para a menos forte pela margem relativa acima da média.
function pickStrongLevers(
  row: OpportunityRow | undefined,
  averages: RankingsResponse["averages"],
  actionType: string
): StrongLeverKey[] {
  if (!row) return [];
  const avgHook = averages?.hook ?? 0;
  const avgWctr = averages?.website_ctr ?? 0;
  const avgConn = averages?.connect_rate ?? 0;
  const avgPconv = averages?.per_action_type?.[actionType]?.page_conv ?? 0;
  const candidates: [StrongLeverKey, number][] = [];
  if (avgHook > 0 && row.hook > avgHook) candidates.push(["hook", (row.hook - avgHook) / avgHook]);
  if (avgWctr > 0 && row.website_ctr > avgWctr) candidates.push(["website_ctr", (row.website_ctr - avgWctr) / avgWctr]);
  if (avgConn > 0 && row.connect_rate > avgConn) candidates.push(["connect_rate", (row.connect_rate - avgConn) / avgConn]);
  if (avgPconv > 0 && row.page_conv > avgPconv) candidates.push(["page_conv", (row.page_conv - avgPconv) / avgPconv]);
  return candidates.sort((a, b) => b[1] - a[1]).map(([lever]) => lever);
}

export function buildActionPlan(params: {
  buckets: Record<GoldBucket, RankingsItem[]>;
  opportunityRows: OpportunityRow[];
  notValidated: RankingsItem[];
  targetCprByActionType?: Record<string, number>;
  actionType: string;
  averages: RankingsResponse["averages"];
}): ActionPlan {
  const { buckets, opportunityRows, notValidated, targetCprByActionType, actionType, averages } = params;

  const targetCpr = actionType ? targetCprByActionType?.[actionType] : undefined;
  const hasTarget = typeof targetCpr === "number" && targetCpr > 0;

  const oppById = new Map<string, OpportunityRow>();
  const oppByName = new Map<string, OpportunityRow>();
  for (const row of opportunityRows) {
    if (row.ad_id) oppById.set(row.ad_id, row);
    if (row.ad_name) oppByName.set(row.ad_name, row);
  }

  const plan: ActionPlan = { gem: [], otimizar: [], licao: [], descartar: [], observar: [] };

  const findOpp = (ad: RankingsItem) => {
    const id = (ad as any).ad_id as string | undefined;
    const name = (ad as any).ad_name as string | undefined;
    return (id && oppById.get(id)) || (name && oppByName.get(name)) || undefined;
  };

  for (const [bucket, ads] of Object.entries(buckets) as [GoldBucket, RankingsItem[]][]) {
    for (const ad of ads) {
      const raw = ad as any;
      const impressions = Number(raw.impressions || 0);
      const spend = Number(raw.spend || 0);
      const results = actionType ? Number(raw.conversions?.[actionType] || 0) : 0;
      const costActual = results > 0 ? spend / results : Infinity;
      const opp = findOpp(ad);

      let verdict: Verdict;
      if (hasTarget && Number.isFinite(costActual)) {
        verdict = classifyActionVerdict(costActual, targetCpr!, countMetricsAbove(ad, averages, actionType));
      } else {
        verdict = BUCKET_FALLBACK[bucket];
      }

      plan[verdict].push({
        ad,
        verdict,
        sourceBucket: bucket,
        costActual: Number.isFinite(costActual) ? costActual : 0,
        costTarget: hasTarget ? targetCpr : undefined,
        lowData: impressions < 3000,
        fixLevers: verdict === "otimizar" ? pickFixLevers(opp) : [],
        strongLevers: verdict === "licao" ? pickStrongLevers(opp, averages, actionType) : [],
        costPotential: opp?.cpr_potential,
        impactSavings: opp?.impact_abs_savings,
        priority: 0,
      });
    }
  }

  for (const ad of notValidated) {
    const raw = ad as any;
    const spend = Number(raw.spend || 0);
    const results = actionType ? Number(raw.conversions?.[actionType] || 0) : 0;
    plan.observar.push({
      ad,
      verdict: "observar",
      sourceBucket: "not_validated",
      costActual: results > 0 ? spend / results : 0,
      lowData: Number(raw.impressions || 0) < 3000,
      fixLevers: [],
      strongLevers: [],
      priority: 0,
    });
  }

  const bySpend = (items: ActionItem[]) => {
    items.sort((a, b) => Number((b.ad as any).spend || 0) - Number((a.ad as any).spend || 0));
    items.forEach((it, i) => { it.priority = i; });
  };

  const bySavings = (items: ActionItem[]) => {
    items.sort((a, b) => {
      const d = (b.impactSavings ?? 0) - (a.impactSavings ?? 0);
      return d !== 0 ? d : Number((b.ad as any).spend || 0) - Number((a.ad as any).spend || 0);
    });
    items.forEach((it, i) => { it.priority = i; });
  };

  bySpend(plan.gem);
  bySavings(plan.otimizar);
  bySavings(plan.licao);
  bySpend(plan.descartar);
  bySpend(plan.observar);

  return plan;
}
