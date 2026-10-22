/**
 * Resumo de confirmação das configurações EM MASSA (critérios de julgamento e
 * planilha): o que vai ser gravado, pack a pack, antes de gravar.
 *
 * A configuração em massa aplica exatamente o mesmo valor a todos os packs, sem
 * adaptação. O resumo existe para essa igualdade não surpreender: diz onde ela
 * SOBRESCREVE algo que o pack tinha (corte diferente, meta diferente, cadastro com
 * outros produtos, outro arquivo, coluna que some) e onde ela grava algo que o pack
 * não usa (meta de evento que ele não tem, critério de leadscore sem planilha).
 *
 * Só pede confirmação quando algo é sobrescrito ou apagado (`needsConfirm`): pack
 * que não tinha nada não tem o que perder, e um resumo a cada save viraria clique
 * automático. As linhas informativas aparecem junto quando a confirmação abre.
 *
 * Funções puras: o teste prende quem conta como sobrescrito.
 */

import type { SheetColumnMappingInput, SheetIntegrationRequest } from "@/lib/api/schemas";
import { normalizeMqlLeadscoreMin, normalizeTargetCpr } from "@/lib/judgment/resolveJudgment";
import { normalizeSheetColumnName } from "@/lib/metrics/customColumns";
import type { AdsPack } from "@/lib/types";
import { listNames } from "./bulkSheetSync";
import { normalizeLeadEconomics } from "./leadEconomics";
import type { BulkPackJudgmentPayload } from "./packJudgmentBulk";
import { formatActionTypeLabel } from "./packJudgmentForm";

export interface BulkReviewLine {
  /** Frase pronta para a tela. */
  text: string;
  /** Sobrescreve ou apaga algo que algum pack tinha: é o que faz a confirmação abrir. */
  overwrites: boolean;
}

export interface BulkReview {
  lines: BulkReviewLine[];
  needsConfirm: boolean;
}

type ReviewPack = Pick<AdsPack, "id" | "name" | "mql_leadscore_min" | "target_cpr" | "lead_economics" | "conversion_types" | "sheet_integration">;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const packs = (n: number) => plural(n, "pack", "packs");
const names = (list: ReadonlyArray<ReviewPack>) => listNames(list.map((p) => p.name || "Pack"));
const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 6 });

function review(lines: BulkReviewLine[]): BulkReview {
  return { lines, needsConfirm: lines.some((line) => line.overwrites) };
}

/** Linha do corte de MQL (o mesmo nos dois diálogos em massa). */
function mqlLine(list: ReadonlyArray<ReviewPack>, value: number | null): BulkReviewLine | null {
  if (value === null) {
    const had = list.filter((p) => normalizeMqlLeadscoreMin(p.mql_leadscore_min) !== null);
    if (had.length === 0) return null;
    return {
      text: `Corte de MQL removido de ${packs(had.length)} (${names(had)}): MQL e CPMQL ficam indisponíveis neles.`,
      overwrites: true,
    };
  }
  const replaced = list.filter((p) => {
    const current = normalizeMqlLeadscoreMin(p.mql_leadscore_min);
    return current !== null && current !== value;
  });
  const added = list.filter((p) => normalizeMqlLeadscoreMin(p.mql_leadscore_min) === null);
  const parts = [`Corte de MQL ${fmt(value)} nos ${packs(list.length)}.`];
  if (replaced.length > 0) {
    const was = Array.from(new Set(replaced.map((p) => fmt(normalizeMqlLeadscoreMin(p.mql_leadscore_min)!)))).join(", ");
    parts.push(`Substitui o corte de hoje (${was}) em ${packs(replaced.length)}: ${names(replaced)}.`);
  }
  if (added.length > 0) parts.push(`Define em ${plural(added.length, "pack que não tinha", "packs que não tinham")} corte.`);
  return { text: parts.join(" "), overwrites: replaced.length > 0 };
}

// ── Critérios de julgamento ─────────────────────────────────────────────────

export function reviewBulkJudgment(list: ReadonlyArray<ReviewPack>, payload: BulkPackJudgmentPayload): BulkReview {
  const lines: BulkReviewLine[] = [];

  if ("mql_leadscore_min" in payload) {
    const line = mqlLine(list, payload.mql_leadscore_min ?? null);
    if (line) lines.push(line);
  }

  if (payload.target_cpr) {
    for (const [event, value] of Object.entries(payload.target_cpr)) {
      const label = `"${formatActionTypeLabel(event)}"`;
      const current = (p: ReviewPack) => normalizeTargetCpr(p.target_cpr)?.[event];
      if (value === null) {
        const had = list.filter((p) => current(p) !== undefined);
        if (had.length > 0) {
          lines.push({ text: `Meta de CPR de ${label} removida de ${packs(had.length)}: ${names(had)}.`, overwrites: true });
        }
        continue;
      }
      const replaced = list.filter((p) => current(p) !== undefined && current(p) !== value);
      const withoutEvent = list.filter((p) => !(Array.isArray(p.conversion_types) && p.conversion_types.includes(event)));
      const parts = [`Meta de CPR de ${label} ${fmt(value)} nos ${packs(list.length)}.`];
      if (replaced.length > 0) parts.push(`Substitui a meta de hoje em ${packs(replaced.length)}: ${names(replaced)}.`);
      if (withoutEvent.length > 0) {
        parts.push(
          `${withoutEvent.length === 1 ? "1 pack não tem" : `${withoutEvent.length} packs não têm`} esse evento (${names(withoutEvent)}): a meta fica gravada, sem uso.`,
        );
      }
      lines.push({ text: parts.join(" "), overwrites: replaced.length > 0 });
    }
  }

  if ("lead_economics" in payload) {
    const doc = payload.lead_economics ?? null;
    const hasRaw = (p: ReviewPack) => p.lead_economics !== null && p.lead_economics !== undefined;
    if (doc === null) {
      const had = list.filter(hasRaw);
      if (had.length > 0) {
        lines.push({
          text: `Economia do lead apagada de ${packs(had.length)} (${names(had)}): teto de CPL e margem ficam indisponíveis neles.`,
          overwrites: true,
        });
      }
    } else {
      // Os dois lados passam pelo normalizador, que remonta o cadastro numa ordem de
      // chaves fixa: a comparação é do conteúdo, não de como o JSON veio do banco.
      const target = JSON.stringify(normalizeLeadEconomics(doc) ?? doc);
      // Cadastro gravado inválido conta como sobrescrito: a coluna tem algo, e some.
      const replaced = list.filter((p) => {
        if (!hasRaw(p)) return false;
        const current = normalizeLeadEconomics(p.lead_economics);
        return current === null || JSON.stringify(current) !== target;
      });
      const added = list.filter((p) => !hasRaw(p));
      const parts = [
        `Economia do lead com ${plural(doc.products.length, "produto", "produtos")} e ${plural(doc.bands.length, "faixa", "faixas")} nos ${packs(list.length)}.`,
      ];
      if (replaced.length > 0) {
        parts.push(
          `Substitui o cadastro de ${packs(replaced.length)} (${names(replaced)}): produtos, nomes, tickets, faixas e conversões passam a ser exatamente estes.`,
        );
      }
      if (added.length > 0) parts.push(`${plural(added.length, "pack passa", "packs passam")} a ter cadastro.`);
      lines.push({ text: parts.join(" "), overwrites: replaced.length > 0 });
    }
  }

  // Critério de leadscore em pack sem planilha: grava, mas só vale depois.
  const touchesLeadscore = payload.mql_leadscore_min !== undefined || (payload.lead_economics !== undefined && payload.lead_economics !== null);
  const noSheet = list.filter((p) => !p.sheet_integration);
  if (touchesLeadscore && noSheet.length > 0) {
    lines.push({
      text: `${noSheet.length === 1 ? "1 pack ainda não tem" : `${noSheet.length} packs ainda não têm`} planilha (${names(noSheet)}): o critério de leadscore passa a valer quando ela for conectada.`,
      overwrites: false,
    });
  }

  return review(lines);
}

// ── Planilha ────────────────────────────────────────────────────────────────

const mappingKey = (kind: string | null | undefined, name: string | null | undefined) => `${kind ?? ""}|${normalizeSheetColumnName(name)}`;

/**
 * `config` é o corpo do save em massa (sem `pack_id`); `mqlLeadscoreMin` é o corte
 * que vai junto (null = não mexe no corte, como no save).
 */
export function reviewBulkSheet(
  list: ReadonlyArray<ReviewPack>,
  config: Omit<SheetIntegrationRequest, "pack_id">,
  mqlLeadscoreMin: number | null,
  spreadsheetName: string,
): BulkReview {
  const lines: BulkReviewLine[] = [];
  const connected = list.filter((p) => !!p.sheet_integration);
  const toConnect = list.filter((p) => !p.sheet_integration);
  const fileName = spreadsheetName ? `"${spreadsheetName}"` : "este arquivo";

  const otherFile = connected.filter((p) => p.sheet_integration!.spreadsheet_id !== config.spreadsheet_id);
  if (otherFile.length > 0) {
    const was = Array.from(new Set(otherFile.map((p) => p.sheet_integration!.spreadsheet_name || "outro arquivo"))).map((n) => `"${n}"`);
    lines.push({
      text: `${packs(otherFile.length)} ${otherFile.length === 1 ? "troca" : "trocam"} de arquivo (${names(otherFile)}): hoje ${otherFile.length === 1 ? "usa" : "usam"} ${listNames(was)}, e o leadscore deles passa a vir de ${fileName}. Se algum for de um lançamento antigo, confira: a planilha costuma ser o mesmo arquivo com o conteúdo trocado.`,
      overwrites: true,
    });
  }

  const sameFile = connected.filter((p) => p.sheet_integration!.spreadsheet_id === config.spreadsheet_id);
  const otherSheet = sameFile.filter((p) => p.sheet_integration!.worksheet_title !== config.worksheet_title);
  if (otherSheet.length > 0) {
    lines.push({ text: `${packs(otherSheet.length)} ${otherSheet.length === 1 ? "troca" : "trocam"} de aba para "${config.worksheet_title}": ${names(otherSheet)}.`, overwrites: true });
  }
  const baseChanged = sameFile.filter((p) => {
    const si = p.sheet_integration!;
    return (
      si.worksheet_title === config.worksheet_title &&
      (si.ad_id_column !== config.ad_id_column ||
        si.date_column !== config.date_column ||
        (si.leadscore_column ?? "") !== (config.leadscore_column ?? "") ||
        (si.date_format ?? "") !== (config.date_format ?? ""))
    );
  });
  if (baseChanged.length > 0) {
    lines.push({
      text: `Colunas de anúncio, data ou leadscore mudam em ${packs(baseChanged.length)}: ${names(baseChanged)}.`,
      overwrites: true,
    });
  }

  // Colunas adicionais que somem: o vínculo é apagado e a coluna sai do Manager
  // nesses packs. `null` = a lista não vai no save (o servidor não mexe nela).
  if (config.column_mappings) {
    const wanted = new Set(config.column_mappings.map((m: SheetColumnMappingInput) => mappingKey(m.kind, m.column_name)));
    const lostByColumn = new Map<string, ReviewPack[]>();
    for (const p of connected) {
      for (const m of p.sheet_integration!.column_mappings ?? []) {
        const sameColumn = p.sheet_integration!.spreadsheet_id === config.spreadsheet_id && wanted.has(mappingKey(m.kind, m.column_name));
        if (sameColumn) continue;
        const label = m.label || m.column_name || "coluna";
        lostByColumn.set(label, [...(lostByColumn.get(label) ?? []), p]);
      }
    }
    for (const [label, affected] of lostByColumn) {
      lines.push({
        text: `A coluna "${label}" deixa de existir em ${packs(affected.length)} (${names(affected)}): sai do Manager e das regras nesses packs.`,
        overwrites: true,
      });
    }
  }

  if (mqlLeadscoreMin !== null) {
    const line = mqlLine(list, mqlLeadscoreMin);
    if (line) lines.push(line);
  }

  if (toConnect.length > 0) {
    lines.push({ text: `${plural(toConnect.length, "pack sem planilha passa", "packs sem planilha passam")} a usar ${fileName}: ${names(toConnect)}.`, overwrites: false });
  }

  return review(lines);
}
