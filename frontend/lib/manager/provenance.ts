"use client";

import { useMemo } from "react";
import { useSessionStore } from "@/lib/store/session";
import type { RankingsItem } from "@/lib/api/schemas";

/**
 * Procedência de uma linha: de qual PACK e de qual CONTA vieram as suas métricas.
 *
 * O backend (migration 093) devolve `pack_ids` e `account_ids` por linha. Os NOMES não vêm da
 * API — packs e contas já estão em memória no session store, então a resolução id→nome é feita
 * aqui, no cliente, sem request adicional.
 *
 * Ambos são multi-valorados por natureza: uma linha da aba "Por anúncio" agrega vários ads, que
 * podem vir de packs (e contas) diferentes. Nos dados reais isso acontece em ~17% (packs) e ~14%
 * (contas) das linhas — não é um caso de borda teórico.
 */

/**
 * `ad_accounts.id` e `ad_metrics.account_id` guardam ambos o prefixo `act_`, mas partes do
 * backend normalizam removendo-o. Comparar sem o prefixo torna o join imune a essa divergência.
 */
const normalizeAccountId = (id: unknown): string => String(id ?? "").replace(/^act_/, "");

export interface ProvenanceIndex {
  packNameById: Map<string, string>;
  /** Chaveado pelo id SEM o prefixo `act_` — use normalizeAccountId ao consultar. */
  accountNameById: Map<string, string>;
}

/** Índice id→nome de packs e contas, montado do que já está em memória. Zero requests. */
export function useProvenanceIndex(): ProvenanceIndex {
  const packs = useSessionStore((state) => state.packs);
  const adAccounts = useSessionStore((state) => state.adAccounts);

  return useMemo(() => {
    const packNameById = new Map<string, string>();
    for (const pack of packs ?? []) {
      if (pack?.id) packNameById.set(String(pack.id), String(pack.name || pack.id));
    }

    const accountNameById = new Map<string, string>();
    for (const account of adAccounts ?? []) {
      if (account?.id) accountNameById.set(normalizeAccountId(account.id), String(account.name || account.id));
    }

    return { packNameById, accountNameById };
  }, [packs, adAccounts]);
}

/**
 * Packs de origem das métricas da linha, já com nome. Um pack que não está mais no store (deletado)
 * é omitido: o UUID cru não diria nada ao usuário.
 */
export function getRowPackNames(row: RankingsItem | null | undefined, index: ProvenanceIndex): string[] {
  const ids = row?.pack_ids;
  if (!Array.isArray(ids) || ids.length === 0) return [];

  const names = ids.map((id) => index.packNameById.get(String(id))).filter((name): name is string => !!name);

  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/**
 * Contas da linha, já com nome. Usa `account_ids` (TODAS as contas do grupo); só cai para
 * `account_id` em payloads anteriores à migration 093 — e esse fallback é o representante do
 * grupo, que mente numa linha que mistura contas. Ao contrário do pack, um id não resolvido vira
 * o próprio id: `act_123…` ainda é reconhecível para quem opera a conta.
 */
export function getRowAccountNames(row: RankingsItem | null | undefined, index: ProvenanceIndex): string[] {
  const ids = Array.isArray(row?.account_ids) && row.account_ids.length > 0 ? row.account_ids : row?.account_id ? [row.account_id] : [];
  if (ids.length === 0) return [];

  const names = ids.map((id) => index.accountNameById.get(normalizeAccountId(id)) ?? String(id ?? "")).filter(Boolean);

  return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export interface ProvenanceVisibility {
  showPack: boolean;
  showAccount: boolean;
}

/**
 * Uma dimensão só merece espaço na linha quando ela VARIA no resultado.
 *
 * Com um único pack selecionado, o seletor de packs já respondeu "de onde vêm estas linhas" —
 * repetir o mesmo nome em todas as linhas seria ruído puro numa tabela que já disputa largura com
 * ~25 métricas. O mesmo vale para conta. Só quando o resultado MISTURA packs (ou contas) é que a
 * procedência vira informação que o usuário não consegue obter de nenhum outro lugar da tela.
 */
export function computeProvenanceVisibility(rows: readonly RankingsItem[] | null | undefined): ProvenanceVisibility {
  const packIds = new Set<string>();
  const accountIds = new Set<string>();

  for (const row of rows ?? []) {
    for (const id of row?.pack_ids ?? []) packIds.add(String(id));

    const accounts = Array.isArray(row?.account_ids) && row.account_ids.length > 0 ? row.account_ids : row?.account_id ? [row.account_id] : [];
    for (const id of accounts) accountIds.add(normalizeAccountId(id));

    if (packIds.size > 1 && accountIds.size > 1) break;
  }

  return { showPack: packIds.size > 1, showAccount: accountIds.size > 1 };
}

/** Rótulo curto para o badge: "Pack de Junho" ou "Pack de Junho +2". */
export function formatProvenanceNames(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names[0]} +${names.length - 1}`;
}

/** Lista completa, para o tooltip/title de um badge truncado. */
export function formatProvenanceTitle(names: readonly string[]): string {
  return names.join(" · ");
}
