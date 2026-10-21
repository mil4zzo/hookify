/**
 * Resumo do sync de planilha em massa (um job, N packs).
 *
 * Três desfechos por pack, e a tela precisa separá-los — misturar "rodou e não
 * aplicou nada" com "aplicou" é o que esconde o caso do pack de lançamento antigo
 * ligado ao arquivo do lançamento atual (a planilha é UM arquivo renomeado a cada
 * lançamento, com o conteúdo trocado):
 *   - atualizado: o sync casou linhas da planilha com anúncios do pack;
 *   - sem linhas correspondentes: rodou, mas nenhum anúncio do pack está na planilha;
 *   - falhou: erro (coluna sumiu, token do Google expirado...).
 */
import type { BulkSheetSyncResult } from "@/lib/api/schemas";

export interface BulkSheetSyncSummary {
  updated: string[];
  noMatch: string[];
  failed: Array<{ name: string; error: string }>;
  /** Packs que tiveram linha aplicada — os únicos cujo cache de anúncios precisa cair. */
  packIdsWithChanges: string[];
  /** Linha principal do toast de conclusão. */
  headline: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function summarizeBulkSheetSync(
  results: ReadonlyArray<BulkSheetSyncResult>,
  packNames: Readonly<Record<string, string>>,
): BulkSheetSyncSummary {
  const nameOf = (r: BulkSheetSyncResult) => (r.pack_id && packNames[r.pack_id]) || "Pack";
  const updated: string[] = [];
  const noMatch: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  const packIdsWithChanges: string[] = [];
  for (const r of results) {
    if (r.status === "failed") {
      failed.push({ name: nameOf(r), error: r.error || "Erro ao sincronizar a planilha." });
      continue;
    }
    if ((r.rows_updated ?? 0) > 0 || r.sync_outcome === "success") {
      updated.push(nameOf(r));
      if (r.pack_id && (r.rows_updated ?? 0) > 0) packIdsWithChanges.push(r.pack_id);
    } else {
      noMatch.push(nameOf(r));
    }
  }
  const parts = [plural(updated.length, "pack atualizado", "packs atualizados")];
  if (noMatch.length) parts.push(`${noMatch.length} sem linhas correspondentes`);
  if (failed.length) parts.push(plural(failed.length, "falhou", "falharam"));
  return { updated, noMatch, failed, packIdsWithChanges, headline: parts.join(" · ") };
}

/** Lista curta de nomes para um aviso ("A, B e mais 3"). */
export function listNames(names: ReadonlyArray<string>, max = 3): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} e mais ${names.length - max}`;
}
