import type { AdsPack } from "@/lib/types";

/**
 * Ordenação e busca de packs — puro, sem React.
 *
 * A ordem é DERIVADA (não posicional): o backend devolve `created_at DESC` e o
 * store acrescenta packs novos ao fim do array, então qualquer superfície que
 * renderize o array cru fica inconsistente. Todas as superfícies devem passar
 * por `sortPacks` para exibir a mesma ordem.
 */

export type PackSortKey = "recent" | "updated" | "name" | "account";
export type PackSortDirection = "asc" | "desc";

/** Espelha a ordem que o backend já devolve (`created_at DESC`), então o default não muda nada. */
export const DEFAULT_PACK_SORT: PackSortKey = "recent";

/**
 * Direção "natural" de cada critério — mesmo papel de `getManagerChildSortInitialDirection`
 * no Manager: datas nascem decrescentes (mais recente primeiro), texto nasce crescente (A-Z).
 * Trocar de critério reseta para este valor, em vez de herdar a direção do critério anterior.
 */
export const PACK_SORT_DEFAULT_DIRECTION: Record<PackSortKey, PackSortDirection> = {
  recent: "desc",
  updated: "desc",
  name: "asc",
  account: "asc",
};

export const PACK_SORT_OPTIONS: { value: PackSortKey; label: string }[] = [
  { value: "recent", label: "Mais recentes" },
  { value: "updated", label: "Última atualização" },
  { value: "name", label: "Nome" },
  { value: "account", label: "Conta" },
];

export function isPackSortKey(value: unknown): value is PackSortKey {
  return typeof value === "string" && PACK_SORT_OPTIONS.some((option) => option.value === value);
}

export function isPackSortDirection(value: unknown): value is PackSortDirection {
  return value === "asc" || value === "desc";
}

/**
 * Só o que ordenação/busca consomem. Mantém o contrato aberto para o `Pack` magro
 * do PackFilter, que não declara todos os campos do AdsPack.
 */
export type SortablePack = Pick<AdsPack, "id" | "name"> & Partial<Pick<AdsPack, "adaccount_id" | "created_at" | "last_refreshed_at">>;

export interface PackSortOptions {
  /** adaccount_id → nome da conta. Sem ele, "Conta" agrupa pelo id cru e a busca não cobre nome de conta. */
  accountNameById?: Map<string, string>;
  /** Default: a direção natural do critério (`PACK_SORT_DEFAULT_DIRECTION`). */
  direction?: PackSortDirection;
}

// numeric: true faz "Pack 2" vir antes de "Pack 10" (o nome default é `Pack NN`).
// sensitivity: "base" ignora caixa e acento.
const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

/** Remove acentos e caixa para a busca casar "campanha" com "Campanhã". */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * Datas ISO comparam lexicograficamente. Ausente vai SEMPRE para o fim (nunca atualizado
 * ≠ atualizado há muito) — esse posicionamento não se inverte com a direção; só a ordem
 * entre datas reais inverte.
 */
function compareIsoWithDirection(a: string | undefined, b: string | undefined, direction: PackSortDirection): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  const cmp = a.localeCompare(b);
  return direction === "desc" ? -cmp : cmp;
}

export function sortPacks<T extends SortablePack>(packs: T[], sortKey: PackSortKey, options: PackSortOptions = {}): T[] {
  const { accountNameById, direction = PACK_SORT_DEFAULT_DIRECTION[sortKey] } = options;
  const flip = direction === "desc" ? -1 : 1;
  const byName = (a: T, b: T) => collator.compare(a.name || "", b.name || "");

  // O desempate por nome é sempre A-Z, independente da direção do critério principal —
  // é um critério estável de último recurso, não algo que o usuário pediu para inverter.
  return [...packs].sort((a, b) => {
    switch (sortKey) {
      case "name":
        return flip * byName(a, b);

      case "updated": {
        const cmp = compareIsoWithDirection(a.last_refreshed_at, b.last_refreshed_at, direction);
        return cmp !== 0 ? cmp : byName(a, b);
      }

      case "account": {
        const labelA = accountNameById?.get(a.adaccount_id ?? "") ?? a.adaccount_id ?? "";
        const labelB = accountNameById?.get(b.adaccount_id ?? "") ?? b.adaccount_id ?? "";
        const cmp = flip * collator.compare(labelA, labelB);
        return cmp !== 0 ? cmp : byName(a, b);
      }

      case "recent":
      default: {
        const cmp = compareIsoWithDirection(a.created_at, b.created_at, direction);
        return cmp !== 0 ? cmp : byName(a, b);
      }
    }
  });
}

/**
 * Casa contra nome do pack e nome da conta. A conta importa porque o nome default
 * gerado é `Pack NN` — buscar só por nome seria inútil para quem não renomeia.
 */
export function filterPacksBySearch<T extends SortablePack>(packs: T[], search: string, options: PackSortOptions = {}): T[] {
  const query = normalizeText(search);
  if (!query) return packs;

  const { accountNameById } = options;
  return packs.filter((pack) => {
    if (normalizeText(pack.name || "").includes(query)) return true;
    const accountName = accountNameById?.get(pack.adaccount_id ?? "");
    return !!accountName && normalizeText(accountName).includes(query);
  });
}
