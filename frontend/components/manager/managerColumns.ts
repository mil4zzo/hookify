import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { getManagerMetricLabel } from "@/lib/metrics";

export type ManagerColumnOption = {
  id: ManagerColumnType;
  name: string;
  /** Se true, a coluna é visível por padrão (sem preferência salva do usuário) */
  defaultVisible?: boolean;
};

/**
 * Fonte única de verdade para as colunas do Manager.
 * A ordem deste array define:
 * - A ordem de renderização na tabela
 * - A ordem no seletor de visibilidade de colunas
 * - A ordem nas linhas expandidas (children)
 */
export const MANAGER_COLUMNS: readonly ManagerColumnOption[] = [
  { id: "spend", name: getManagerMetricLabel("spend"), defaultVisible: true },
  { id: "impressions", name: getManagerMetricLabel("impressions") },
  { id: "results", name: getManagerMetricLabel("results"), defaultVisible: true },
  { id: "mqls", name: getManagerMetricLabel("mqls"), defaultVisible: true },
  { id: "cpr", name: getManagerMetricLabel("cpr"), defaultVisible: true },
  { id: "cpc", name: getManagerMetricLabel("cpc"), defaultVisible: true },
  { id: "cplc", name: getManagerMetricLabel("cplc"), defaultVisible: true },
  { id: "cpmql", name: getManagerMetricLabel("cpmql"), defaultVisible: true },
  { id: "cpm", name: getManagerMetricLabel("cpm"), defaultVisible: true },
  { id: "hook", name: getManagerMetricLabel("hook"), defaultVisible: true },
  { id: "ctr", name: getManagerMetricLabel("ctr") },
  { id: "website_ctr", name: getManagerMetricLabel("website_ctr"), defaultVisible: true },
  { id: "connect_rate", name: getManagerMetricLabel("connect_rate"), defaultVisible: true },
  { id: "page_conv", name: getManagerMetricLabel("page_conv"), defaultVisible: true },
] as const;

// Derivadas — sempre coerentes com MANAGER_COLUMNS

/** Todas as opções de colunas (id + nome), na ordem de renderização */
export const MANAGER_COLUMN_OPTIONS: readonly ManagerColumnOption[] = MANAGER_COLUMNS;

/** Colunas visíveis por padrão */
export const DEFAULT_MANAGER_COLUMNS: readonly ManagerColumnType[] = MANAGER_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id);

/** Ordem de renderização (todos os ids) */
export const MANAGER_COLUMN_RENDER_ORDER: readonly ManagerColumnType[] = MANAGER_COLUMNS.map((c) => c.id);
