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
  | "reach";

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
}

export const METRIC_DEFINITIONS: Record<MetricKey, MetricDefinition> = {
  score: {
    key: "score",
    label: "Score",
    didacticDescription: "Mostra a nota composta final do criativo na leitura do Explorer.",
    technicalDescription: "Score sintético em escala de 0 a 10 calculado a partir dos sinais do criativo.",
    polarity: "higher",
    formatKind: "decimal",
  },
  spend: {
    key: "spend",
    label: "Spend",
    didacticDescription: "Mostra quanto foi investido no anúncio no período selecionado.",
    technicalDescription: "Soma dos gastos atribuídos ao conjunto de datas filtrado.",
    polarity: "neutral",
    formatKind: "currency",
  },
  cpm: {
    key: "cpm",
    label: "CPM",
    didacticDescription: "Mostra o custo para gerar mil impressões do anúncio.",
    technicalDescription: "Custo por mil impressões entregues.",
    polarity: "lower",
    formatKind: "currency",
  },
  frequency: {
    key: "frequency",
    label: "Frequency",
    didacticDescription: "Mostra quantas vezes, em média, cada pessoa viu o anúncio.",
    technicalDescription: "Relação entre impressões totais e alcance.",
    polarity: "neutral",
    formatKind: "decimal",
  },
  scroll_stop: {
    key: "scroll_stop",
    label: "Scroll Stop",
    didacticDescription: "Mede a capacidade do anúncio de interromper o scroll logo no início.",
    technicalDescription: "Percentual que parou no primeiro segundo do vídeo.",
    polarity: "higher",
    formatKind: "ratioPercent",
  },
  hook: {
    key: "hook",
    label: "Hook",
    didacticDescription: "Mostra quão forte é a abertura do anúncio para capturar atenção.",
    technicalDescription: "Taxa de retenção inicial nos primeiros 3 segundos.",
    polarity: "higher",
    formatKind: "ratioPercent",
  },
  hold_rate: {
    key: "hold_rate",
    label: "Hold Rate",
    didacticDescription: "Coerência entre o Hook e a continuação do anúncio.",
    technicalDescription: "Taxa de retenção entre Hook (3s) e Trueplay (15s).",
    polarity: "higher",
    formatKind: "ratioPercent",
  },
  video_watched_p50: {
    key: "video_watched_p50",
    label: "50% View",
    didacticDescription: "Mostra quantas pessoas chegaram até a metade do vídeo.",
    technicalDescription: "Percentual de visualizações que atingiram 50% da duração.",
    polarity: "higher",
    formatKind: "rawPercent",
  },
  ctr: {
    key: "ctr",
    label: "CTR",
    didacticDescription: "Mostra a taxa de cliques gerados pelo anúncio sobre as impressões.",
    technicalDescription: "Clicks dividido por impressions.",
    polarity: "higher",
    formatKind: "ratioPercent",
  },
  website_ctr: {
    key: "website_ctr",
    aliases: ["link_ctr"],
    label: "Link CTR",
    shortLabel: "Link CTR",
    didacticDescription: "Mostra a taxa de cliques especificamente no link do anúncio.",
    technicalDescription: "Inline link clicks dividido por impressions.",
    polarity: "higher",
    formatKind: "ratioPercent",
  },
  connect_rate: {
    key: "connect_rate",
    label: "Connect Rate",
    shortLabel: "Connect",
    didacticDescription: "Mostra quantos cliques viraram visitas reais à página.",
    technicalDescription: "LPV dividido por inline link clicks.",
    polarity: "higher",
    formatKind: "ratioPercent",
  },
  page_conv: {
    key: "page_conv",
    label: "Page Conv",
    shortLabel: "Page",
    didacticDescription: "Mostra a eficiência da página em converter visitas em resultado.",
    technicalDescription: "Results dividido por LPV.",
    polarity: "higher",
    formatKind: "ratioPercent",
    requiresActionType: true,
  },
  cpmql: {
    key: "cpmql",
    label: "CPMQL",
    didacticDescription: "Mostra o custo para gerar um lead qualificado de marketing.",
    technicalDescription: "Spend dividido por MQLs.",
    polarity: "lower",
    formatKind: "currency",
    requiresSheetIntegration: true,
  },
  cpr: {
    key: "cpr",
    label: "CPR",
    didacticDescription: "Mostra quanto custa gerar um resultado da conversão selecionada.",
    technicalDescription: "Spend dividido por results.",
    polarity: "lower",
    formatKind: "currency",
    requiresActionType: true,
  },
  cpc: {
    key: "cpc",
    label: "CPC",
    didacticDescription: "Mostra quanto custa cada clique recebido pelo anúncio.",
    technicalDescription: "Spend dividido por clicks.",
    polarity: "lower",
    formatKind: "currency",
  },
  cplc: {
    key: "cplc",
    label: "CPLC",
    didacticDescription: "Mostra quanto custa cada clique no link do anúncio.",
    technicalDescription: "Spend dividido por inline link clicks.",
    polarity: "lower",
    formatKind: "currency",
  },
  mqls: {
    key: "mqls",
    label: "MQLs",
    didacticDescription: "Mostra o volume de leads qualificados gerados no período.",
    technicalDescription: "Contagem total de marketing qualified leads.",
    polarity: "higher",
    formatKind: "integer",
    requiresSheetIntegration: true,
  },
  results: {
    key: "results",
    label: "Results",
    didacticDescription: "Mostra o total da conversão atualmente selecionada.",
    technicalDescription: "Soma das conversões do action type escolhido.",
    polarity: "higher",
    formatKind: "integer",
    requiresActionType: true,
  },
  impressions: {
    key: "impressions",
    label: "Impressions",
    didacticDescription: "Mostra o total de vezes que o anúncio foi exibido.",
    technicalDescription: "Contagem bruta de entregas do anúncio.",
    polarity: "higher",
    formatKind: "integer",
  },
  clicks: {
    key: "clicks",
    label: "Clicks",
    didacticDescription: "Mostra o total de cliques recebidos pelo anúncio.",
    technicalDescription: "Inclui todos os cliques contabilizados na entrega.",
    polarity: "higher",
    formatKind: "integer",
  },
  lpv: {
    key: "lpv",
    label: "LPV",
    didacticDescription: "Mostra quantas visualizações reais a página de destino recebeu.",
    technicalDescription: "Landing page views após o clique no anúncio.",
    polarity: "higher",
    formatKind: "integer",
  },
  plays: {
    key: "plays",
    label: "Plays",
    didacticDescription: "Mostra quantas reproduções de vídeo foram registradas.",
    technicalDescription: "Total de execuções iniciadas do criativo em vídeo.",
    polarity: "higher",
    formatKind: "integer",
  },
  reach: {
    key: "reach",
    label: "Reach",
    didacticDescription: "Mostra quantas pessoas únicas receberam o anúncio.",
    technicalDescription: "Contagem estimada de usuários únicos impactados.",
    polarity: "higher",
    formatKind: "integer",
  },
};

export const METRIC_DEFINITION_LIST = Object.values(METRIC_DEFINITIONS);
