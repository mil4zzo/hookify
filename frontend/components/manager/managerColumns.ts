import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { getManagerMetricLabel, type ManagerMetricKey } from "@/lib/metrics";

export type ManagerColumnOption = {
  id: ManagerColumnType;
  name: string;
  /** Se true, a coluna é visível por padrão (sem preferência salva do usuário) */
  defaultVisible?: boolean;
  /**
   * Dimensão (texto), não métrica. Muda o tratamento em toda a cadeia: não tem média no header,
   * filtra por texto (não por número), sai do CSV como texto livre (exige anti formula-injection)
   * e é ignorada onde só métricas fazem sentido (tabela de variações, cálculo de médias).
   */
  isDimension?: boolean;
};

/**
 * Fonte única de verdade para as colunas do Manager.
 * A ordem deste array define:
 * - A ordem de renderização na tabela
 * - A ordem no seletor de visibilidade de colunas
 * - A ordem nas linhas expandidas (children)
 */
export const MANAGER_COLUMNS: readonly ManagerColumnOption[] = [
  // Ordem lida como diagnóstico (efeito → causa → causa da causa), não como o funil cronológico:
  // 1) Investimento e resultado — o que você gastou e o que voltou.
  { id: "spend", name: getManagerMetricLabel("spend"), defaultVisible: true },
  { id: "results", name: getManagerMetricLabel("results"), defaultVisible: true },
  { id: "mqls", name: getManagerMetricLabel("mqls"), defaultVisible: true },
  // Volume qualificado (mqls) → fatia qualificada (mql_rate) → qualidade média (leadscore_avg).
  { id: "mql_rate", name: getManagerMetricLabel("mql_rate") },
  { id: "leadscore_avg", name: getManagerMetricLabel("leadscore_avg") },
  // 2) Custos — a eficiência desse resultado.
  { id: "cpr", name: getManagerMetricLabel("cpr"), defaultVisible: true },
  { id: "cpmql", name: getManagerMetricLabel("cpmql"), defaultVisible: true },
  { id: "cpc", name: getManagerMetricLabel("cpc"), defaultVisible: true },
  { id: "cplc", name: getManagerMetricLabel("cplc"), defaultVisible: true },
  { id: "cpm", name: getManagerMetricLabel("cpm"), defaultVisible: true },
  // 3) Hook promovido: métrica-assinatura do produto: fica logo após os custos, não perdida
  // no fim do bloco de vídeo.
  { id: "hook", name: getManagerMetricLabel("hook"), defaultVisible: true },
  // 4) Funil de página — o que move o custo diretamente.
  { id: "ctr", name: getManagerMetricLabel("ctr") },
  { id: "website_ctr", name: getManagerMetricLabel("website_ctr"), defaultVisible: true },
  { id: "connect_rate", name: getManagerMetricLabel("connect_rate"), defaultVisible: true },
  { id: "page_conv", name: getManagerMetricLabel("page_conv"), defaultVisible: true },
  // 5) Funil de vídeo (resto) — a causa da causa: por que o CTR/connect se comportou assim.
  { id: "scroll_stop", name: getManagerMetricLabel("scroll_stop") },
  { id: "hold_rate", name: getManagerMetricLabel("hold_rate") },
  { id: "video_watched_p50", name: getManagerMetricLabel("video_watched_p50") },
  { id: "video_watched_p75", name: getManagerMetricLabel("video_watched_p75") },
  // 6) Brutos — denominadores/volume; spend já os engloba na prática, servem mais para checar
  // se há dado suficiente para validar uma leitura do que para ler diretamente.
  { id: "plays", name: getManagerMetricLabel("plays") },
  { id: "thruplays", name: getManagerMetricLabel("thruplays") },
  { id: "impressions", name: getManagerMetricLabel("impressions") },
  { id: "reach", name: getManagerMetricLabel("reach") },
  { id: "frequency", name: getManagerMetricLabel("frequency") },
  { id: "clicks", name: getManagerMetricLabel("clicks") },
  { id: "lpv", name: getManagerMetricLabel("lpv") },
  // 7) Dimensões de procedência (migration 093), por último. Desligadas por padrão: na maioria
  // das sessões o resultado tem um pack e uma conta só, e aí o seletor de packs já responde de
  // onde vêm os dados — a coluna seria uma coluna inteira de valor repetido. Quem precisa
  // comparar packs lado a lado (ou exportar) liga aqui; para o caso visual, o badge na célula de
  // nome aparece sozinho quando a dimensão varia.
  { id: "pack", name: "Pack", isDimension: true },
  { id: "account", name: "Conta", isDimension: true },
] as const;

/** Coluna de métrica: o id é garantidamente uma métrica conhecida (nunca "pack"/"account"). */
export type ManagerMetricColumnOption = ManagerColumnOption & { id: ManagerMetricKey };

/**
 * Type predicate para separar métricas de dimensões. Use ao alimentar qualquer coisa que só saiba
 * lidar com métricas (formatação de valor, cálculo de média, tabela de variações).
 */
export const isManagerMetricColumn = (column: ManagerColumnOption): column is ManagerMetricColumnOption => !column.isDimension;

// Derivadas — sempre coerentes com MANAGER_COLUMNS

/** Todas as opções de colunas (id + nome), na ordem de renderização */
export const MANAGER_COLUMN_OPTIONS: readonly ManagerColumnOption[] = MANAGER_COLUMNS;

/** Colunas visíveis por padrão */
export const DEFAULT_MANAGER_COLUMNS: readonly ManagerColumnType[] = MANAGER_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id);

/** Ordem de renderização (todos os ids) */
export const MANAGER_COLUMN_RENDER_ORDER: readonly ManagerColumnType[] = MANAGER_COLUMNS.map((c) => c.id);
