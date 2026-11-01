import { translate } from "@/lib/i18n/translate";

export type MetricPolarity = "higher" | "lower" | "neutral";

export type MetricFormatKind = "currency" | "ratioPercent" | "rawPercent" | "integer" | "decimal";

export type MetricKey =
  | "score"
  | "spend"
  | "cpm"
  | "frequency"
  | "scroll_stop"
  | "hook"
  | "hold_rate"
  | "video_watched_p50"
  | "video_watched_p75"
  | "ctr"
  | "website_ctr"
  | "connect_rate"
  | "page_conv"
  | "cpmql"
  | "cpr"
  | "cpc"
  | "cplc"
  | "mqls"
  | "results"
  | "impressions"
  | "clicks"
  | "lpv"
  | "plays"
  | "thruplays"
  | "reach"
  | "leadscore_avg"
  | "mql_rate"
  | "cpl_ceiling"
  | "cpl_actual"
  | "leads_scored"
  | "lead_margin";

export interface MetricDefinition {
  key: MetricKey;
  aliases?: readonly string[];
  label: string;
  shortLabel?: string;
  didacticDescription?: string;
  technicalDescription?: string;
  polarity: MetricPolarity;
  formatKind: MetricFormatKind;
  requiresActionType?: boolean;
  requiresSheetIntegration?: boolean;
  /**
   * Só existe com a economia do lead cadastrada em algum pack selecionado
   * (CPL Max e Margem). Vale junto com `requiresSheetIntegration`: sem
   * planilha não há nota, e sem nota não há conta.
   */
  requiresLeadEconomics?: boolean;
  /**
   * Métrica que só existe em VÍDEO: numerador e denominador vêm de `plays`.
   * Num anúncio de imagem ela não é zero — ela NÃO SE APLICA, e a tela diz isso
   * com um ícone de formato em vez do travessão de "sem dado".
   * Ver documentation/plano-filtros-unificados.md.
   */
  requiresVideo?: boolean;
  /**
   * Não mede qualidade, então NUNCA ganha cor de "melhor/pior que a média" em lugar
   * nenhum (célula, barras, cartão do modal, link público). Volume só reflete quanto de
   * verba o anúncio recebeu; frequência alta é fadiga, não acerto. É a ÚNICA fonte desta
   * regra: telas perguntam a `isColorlessMetricKey`, não mantêm lista própria.
   */
  colorless?: boolean;
}

export const METRIC_DEFINITIONS: Record<MetricKey, MetricDefinition> = {
  score: {
    key: "score",
    label: "Score",
    get didacticDescription() {
      return translate("metrics.defs.score.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.score.t");
    },
    polarity: "higher",
    formatKind: "decimal",
  },
  spend: {
    key: "spend",
    get label() {
      return translate("metrics.defs.spend.l");
    },
    get didacticDescription() {
      return translate("metrics.defs.spend.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.spend.t");
    },
    polarity: "neutral",
    formatKind: "currency",
  },
  cpm: {
    key: "cpm",
    label: "CPM",
    get didacticDescription() {
      return translate("metrics.defs.cpm.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.cpm.t");
    },
    polarity: "lower",
    formatKind: "currency",
  },
  frequency: {
    key: "frequency",
    get label() {
      return translate("metrics.defs.frequency.l");
    },
    get didacticDescription() {
      return translate("metrics.defs.frequency.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.frequency.t");
    },
    polarity: "neutral",
    colorless: true,
    formatKind: "decimal",
  },
  scroll_stop: {
    key: "scroll_stop",
    label: "Scroll Stop",
    get didacticDescription() {
      return translate("metrics.defs.scroll_stop.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.scroll_stop.t");
    },
    polarity: "higher",
    formatKind: "ratioPercent",
    requiresVideo: true,
  },
  hook: {
    key: "hook",
    label: "Hook",
    get didacticDescription() {
      return translate("metrics.defs.hook.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.hook.t");
    },
    polarity: "higher",
    formatKind: "ratioPercent",
    requiresVideo: true,
  },
  hold_rate: {
    key: "hold_rate",
    label: "Hold Rate",
    get didacticDescription() {
      return translate("metrics.defs.hold_rate.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.hold_rate.t");
    },
    polarity: "higher",
    formatKind: "ratioPercent",
    requiresVideo: true,
  },
  video_watched_p50: {
    key: "video_watched_p50",
    label: "50% View",
    get didacticDescription() {
      return translate("metrics.defs.video_watched_p50.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.video_watched_p50.t");
    },
    polarity: "higher",
    formatKind: "rawPercent",
    requiresVideo: true,
  },
  video_watched_p75: {
    key: "video_watched_p75",
    label: "75% View",
    get didacticDescription() {
      return translate("metrics.defs.video_watched_p75.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.video_watched_p75.t");
    },
    polarity: "higher",
    formatKind: "rawPercent",
    requiresVideo: true,
  },
  ctr: {
    key: "ctr",
    label: "CTR",
    get didacticDescription() {
      return translate("metrics.defs.ctr.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.ctr.t");
    },
    polarity: "higher",
    formatKind: "ratioPercent",
  },
  website_ctr: {
    key: "website_ctr",
    aliases: ["link_ctr"],
    get label() {
      return translate("metrics.defs.website_ctr.l");
    },
    get shortLabel() {
      return translate("metrics.defs.website_ctr.s");
    },
    get didacticDescription() {
      return translate("metrics.defs.website_ctr.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.website_ctr.t");
    },
    polarity: "higher",
    formatKind: "ratioPercent",
  },
  connect_rate: {
    key: "connect_rate",
    label: "Connect Rate",
    shortLabel: "Connect",
    get didacticDescription() {
      return translate("metrics.defs.connect_rate.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.connect_rate.t");
    },
    polarity: "higher",
    formatKind: "ratioPercent",
  },
  page_conv: {
    key: "page_conv",
    get label() {
      return translate("metrics.defs.page_conv.l");
    },
    get shortLabel() {
      return translate("metrics.defs.page_conv.s");
    },
    get didacticDescription() {
      return translate("metrics.defs.page_conv.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.page_conv.t");
    },
    polarity: "higher",
    formatKind: "ratioPercent",
    requiresActionType: true,
  },
  cpmql: {
    key: "cpmql",
    label: "CPMQL",
    get didacticDescription() {
      return translate("metrics.defs.cpmql.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.cpmql.t");
    },
    polarity: "lower",
    formatKind: "currency",
    requiresSheetIntegration: true,
  },
  cpr: {
    key: "cpr",
    label: "CPR",
    get didacticDescription() {
      return translate("metrics.defs.cpr.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.cpr.t");
    },
    polarity: "lower",
    formatKind: "currency",
    requiresActionType: true,
  },
  cpc: {
    key: "cpc",
    label: "CPC",
    get didacticDescription() {
      return translate("metrics.defs.cpc.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.cpc.t");
    },
    polarity: "lower",
    formatKind: "currency",
  },
  cplc: {
    key: "cplc",
    label: "CPLC",
    get didacticDescription() {
      return translate("metrics.defs.cplc.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.cplc.t");
    },
    polarity: "lower",
    formatKind: "currency",
  },
  mqls: {
    key: "mqls",
    label: "MQLs",
    get didacticDescription() {
      return translate("metrics.defs.mqls.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.mqls.t");
    },
    polarity: "higher",
    colorless: true,
    formatKind: "integer",
    requiresSheetIntegration: true,
  },
  results: {
    key: "results",
    get label() {
      return translate("metrics.defs.results.l");
    },
    get didacticDescription() {
      return translate("metrics.defs.results.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.results.t");
    },
    polarity: "higher",
    colorless: true,
    formatKind: "integer",
    requiresActionType: true,
  },
  impressions: {
    key: "impressions",
    get label() {
      return translate("metrics.defs.impressions.l");
    },
    get didacticDescription() {
      return translate("metrics.defs.impressions.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.impressions.t");
    },
    polarity: "higher",
    colorless: true,
    formatKind: "integer",
  },
  clicks: {
    key: "clicks",
    get label() {
      return translate("metrics.defs.clicks.l");
    },
    get didacticDescription() {
      return translate("metrics.defs.clicks.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.clicks.t");
    },
    polarity: "higher",
    colorless: true,
    formatKind: "integer",
  },
  lpv: {
    key: "lpv",
    label: "LPV",
    get didacticDescription() {
      return translate("metrics.defs.lpv.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.lpv.t");
    },
    polarity: "higher",
    colorless: true,
    formatKind: "integer",
  },
  plays: {
    key: "plays",
    label: "Plays",
    get didacticDescription() {
      return translate("metrics.defs.plays.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.plays.t");
    },
    polarity: "higher",
    colorless: true,
    formatKind: "integer",
    requiresVideo: true,
  },
  thruplays: {
    key: "thruplays",
    aliases: ["video_total_thruplays"],
    label: "ThruPlays",
    get didacticDescription() {
      return translate("metrics.defs.thruplays.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.thruplays.t");
    },
    polarity: "higher",
    colorless: true,
    formatKind: "integer",
    requiresVideo: true,
  },
  reach: {
    key: "reach",
    get label() {
      return translate("metrics.defs.reach.l");
    },
    get didacticDescription() {
      return translate("metrics.defs.reach.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.reach.t");
    },
    polarity: "higher",
    colorless: true,
    formatKind: "integer",
  },
  leadscore_avg: {
    key: "leadscore_avg",
    get label() {
      return translate("metrics.defs.leadscore_avg.l");
    },
    get shortLabel() {
      return translate("metrics.defs.leadscore_avg.s");
    },
    get didacticDescription() {
      return translate("metrics.defs.leadscore_avg.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.leadscore_avg.t");
    },
    polarity: "higher",
    formatKind: "decimal",
    requiresSheetIntegration: true,
  },
  mql_rate: {
    key: "mql_rate",
    get label() {
      return translate("metrics.defs.mql_rate.l");
    },
    get shortLabel() {
      return translate("metrics.defs.mql_rate.s");
    },
    get didacticDescription() {
      return translate("metrics.defs.mql_rate.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.mql_rate.t");
    },
    polarity: "higher",
    formatKind: "ratioPercent",
    requiresSheetIntegration: true,
  },
  // Economia do lead (documentation/plano-economia-do-lead.md). As chaves são
  // imutáveis depois de publicadas: regras salvas e preferências de coluna as citam.
  cpl_ceiling: {
    key: "cpl_ceiling",
    label: "CPL Max",
    get didacticDescription() {
      return translate("metrics.defs.cpl_ceiling.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.cpl_ceiling.t");
    },
    polarity: "higher",
    formatKind: "currency",
    requiresSheetIntegration: true,
    requiresLeadEconomics: true,
  },
  cpl_actual: {
    key: "cpl_actual",
    label: "CPL Real",
    get didacticDescription() {
      return translate("metrics.defs.cpl_actual.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.cpl_actual.t");
    },
    polarity: "lower",
    formatKind: "currency",
    requiresSheetIntegration: true,
    requiresLeadEconomics: true,
  },
  leads_scored: {
    key: "leads_scored",
    get label() {
      return translate("metrics.defs.leads_scored.l");
    },
    get didacticDescription() {
      return translate("metrics.defs.leads_scored.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.leads_scored.t");
    },
    polarity: "higher",
    colorless: true,
    formatKind: "integer",
    requiresSheetIntegration: true,
    requiresLeadEconomics: true,
  },
  lead_margin: {
    key: "lead_margin",
    get label() {
      return translate("metrics.defs.lead_margin.l");
    },
    get didacticDescription() {
      return translate("metrics.defs.lead_margin.d");
    },
    get technicalDescription() {
      return translate("metrics.defs.lead_margin.t");
    },
    polarity: "higher",
    formatKind: "ratioPercent",
    requiresSheetIntegration: true,
    requiresLeadEconomics: true,
  },
};

export const METRIC_DEFINITION_LIST = Object.values(METRIC_DEFINITIONS);

export function isColorlessMetricKey(key: string): boolean {
  return (METRIC_DEFINITIONS as Record<string, MetricDefinition | undefined>)[key]?.colorless === true;
}
