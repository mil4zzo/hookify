import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";

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
  { id: "spend", name: "Spend", defaultVisible: true },
  { id: "results", name: "Results", defaultVisible: true },
  { id: "mqls", name: "MQLs", defaultVisible: true },
  { id: "cpr", name: "CPR", defaultVisible: true },
  { id: "cpmql", name: "CPMQL", defaultVisible: true },
  { id: "cpm", name: "CPM", defaultVisible: true },
  { id: "hook", name: "Hook", defaultVisible: true },
  { id: "ctr", name: "CTR" },
  { id: "website_ctr", name: "Link CTR", defaultVisible: true },
  { id: "connect_rate", name: "Connect", defaultVisible: true },
  { id: "page_conv", name: "Page", defaultVisible: true },
] as const;

// Derivadas — sempre coerentes com MANAGER_COLUMNS

/** Todas as opções de colunas (id + nome), na ordem de renderização */
export const MANAGER_COLUMN_OPTIONS: readonly ManagerColumnOption[] = MANAGER_COLUMNS;

/** Colunas visíveis por padrão */
export const DEFAULT_MANAGER_COLUMNS: readonly ManagerColumnType[] = MANAGER_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id);

/** Ordem de renderização (todos os ids) */
export const MANAGER_COLUMN_RENDER_ORDER: readonly ManagerColumnType[] = MANAGER_COLUMNS.map((c) => c.id);
