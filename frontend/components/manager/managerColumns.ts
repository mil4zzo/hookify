import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";

export type ManagerColumnOption = {
  id: ManagerColumnType;
  name: string;
};

export const MANAGER_COLUMN_OPTIONS: readonly ManagerColumnOption[] = [
  { id: "hook", name: "Hook" },
  { id: "cpr", name: "CPR" },
  { id: "cpmql", name: "CPMQL" },
  { id: "spend", name: "Spend" },
  { id: "ctr", name: "CTR" },
  { id: "website_ctr", name: "Link CTR" },
  { id: "cpm", name: "CPM" },
  { id: "connect_rate", name: "Connect" },
  { id: "page_conv", name: "Page" },
  { id: "results", name: "Results" },
  { id: "mqls", name: "MQLs" },
] as const;

export const DEFAULT_MANAGER_COLUMNS: readonly ManagerColumnType[] = [
  "spend",
  "cpmql",
  "mqls",
  "cpr",
  "results",
  "cpm",
  "hook",
  "website_ctr",
  "connect_rate",
  "page_conv",
] as const;

/**
 * Ordem das colunas como aparecem na tabela principal (buildMetricColumns)
 * Esta ordem deve ser usada para renderizar as colunas nas linhas expandidas
 */
export const MANAGER_COLUMN_RENDER_ORDER: readonly ManagerColumnType[] = [
  "spend",
  "cpmql",
  "mqls",
  "cpr",
  "results",
  "cpm",
  "hook",
  "ctr",
  "website_ctr",
  "connect_rate",
  "page_conv",
] as const;


