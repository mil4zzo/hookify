/**
 * Economia do lead — importar as FAIXAS (nota → conversão → produto) de um CSV.
 *
 * Quem tem a análise do CRM em planilha digitava faixa a faixa. Aqui o arquivo vira
 * o rascunho do editor: as faixas são SUBSTITUÍDAS, os produtos ficam (e ganham os
 * que o arquivo nomeia e o cadastro ainda não tem). Nada é gravado: o resultado cai
 * no editor, que mostra cada faixa, o teto por lead e os erros do contrato antes do
 * "Salvar" — e o editor oferece desfazer.
 *
 * Formato tolerante, porque o arquivo vem do Excel/Sheets de cada um:
 * - separador `;`, tab ou `,` (o do Excel em português é `;`, já que a vírgula é decimal);
 * - cabeçalho opcional; sem ele, as colunas são nota, conversão e produto, nessa ordem;
 * - nota como número ("60"), intervalo ("60 a 79", "60-79", "80+", "80 ou mais") ou a
 *   faixa de baixo ("abaixo de 60", "< 60", vazio) — vale o PISO de cada faixa;
 * - conversão em porcentagem, como na tela ("4", "4%", "0,5" = 0,5%);
 * - arquivo em UTF-8 ou no Windows-1252 do Excel (`decodeCsvBytes`).
 */

import { LEAD_ECONOMICS_MAX_PRODUCTS, productNameKey } from "./leadEconomics";
import {
  formatPercentInput,
  formatScoreInput,
  newLeadEconomicsId,
  parsePercentInput,
  parseScoreInput,
  type LeadEconomicsBandDraft,
  type LeadEconomicsDraft,
  type LeadEconomicsProductDraft,
} from "./leadEconomicsDraft";

export type LeadEconomicsCsvResult =
  | {
      kind: "ok";
      draft: LeadEconomicsDraft;
      bandCount: number;
      /** Produtos que o arquivo nomeou e o cadastro não tinha: entram sem ticket e margens. */
      newProducts: string[];
      warnings: string[];
    }
  | { kind: "error"; message: string };

/** Modelo para baixar: o separador do Excel em português e os três jeitos de escrever a nota. */
export const LEAD_ECONOMICS_BANDS_CSV_TEMPLATE = [
  "nota;conversao;produto",
  "abaixo de 60;0,5%;Ebook",
  "60 a 79;4%;Mentoria",
  "80 ou mais;12%;Mentoria",
  "",
].join("\r\n");

/** Bytes do arquivo → texto. UTF-8 quando é UTF-8 válido; senão o Windows-1252 do Excel. */
export function decodeCsvBytes(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

// ── Leitura do CSV ───────────────────────────────────────────────────────────

function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/** `;` ou tab quando aparecem na primeira linha; senão vírgula (que também é o decimal em pt-BR). */
function detectDelimiter(firstLine: string): string {
  const count = (ch: string) => firstLine.split(ch).length - 1;
  if (count(";") > 0 && count(";") >= count("\t")) return ";";
  if (count("\t") > 0) return "\t";
  return ",";
}

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

type Column = "range" | "conversion" | "product";

function classifyHeader(cell: string): Column | null {
  const text = normalize(cell);
  if (!text) return null;
  if (/conver|taxa|%/.test(text)) return "conversion";
  if (/produto|product|oferta/.test(text)) return "product";
  if (/faixa|nota|score|leadscore|corte|minim|intervalo|piso|a partir/.test(text)) return "range";
  return null;
}

/**
 * Piso da faixa a partir do texto da célula. `null` = a faixa de baixo (sem piso);
 * `undefined` = não deu para ler.
 */
export function parseBandFloor(raw: string): number | null | undefined {
  const text = normalize(raw);
  if (!text) return null;
  if (/^(<|abaixo|ate\b|menos|menor)/.test(text)) return null;
  const match = text.match(/-?\d+(?:[.,]\d+)*/);
  if (!match) return undefined;
  return parseScoreInput(match[0]) ?? undefined;
}

// ── Importação ───────────────────────────────────────────────────────────────

interface CsvBand {
  line: number;
  min: number | null;
  conversion: number;
  product: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** CSV de faixas + rascunho atual → rascunho com as faixas do arquivo, ou o motivo de não importar. */
export function importLeadEconomicsBandsCsv(text: string, draft: LeadEconomicsDraft): LeadEconomicsCsvResult {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r\n|\n|\r/)
    .map((line, index) => ({ line: index + 1, text: line }))
    .filter((entry) => entry.text.trim() !== "");
  if (lines.length === 0) return { kind: "error", message: "O arquivo está vazio." };

  const delimiter = detectDelimiter(lines[0].text);
  const rows = lines.map((entry) => ({ line: entry.line, cells: splitLine(entry.text, delimiter) }));

  // Cabeçalho: a primeira linha nomeia a conversão e a célula dela não é número.
  let columns: Record<Column, number> = { range: 0, conversion: 1, product: 2 };
  let dataRows = rows;
  const headerGuess = rows[0].cells.map(classifyHeader);
  const conversionAt = headerGuess.indexOf("conversion");
  if (conversionAt >= 0 && parsePercentInput(rows[0].cells[conversionAt]) === null) {
    const rangeAt = headerGuess.indexOf("range");
    const productAt = headerGuess.indexOf("product");
    columns = { range: rangeAt >= 0 ? rangeAt : conversionAt === 0 ? 1 : 0, conversion: conversionAt, product: productAt };
    dataRows = rows.slice(1);
  }
  const hasProductColumn = columns.product >= 0 && dataRows.some((row) => (row.cells[columns.product] ?? "").trim() !== "");

  if (dataRows.length === 0) return { kind: "error", message: "O arquivo não tem nenhuma faixa, só o cabeçalho." };

  const bands: CsvBand[] = [];
  let anyPercentSign = false;
  for (const row of dataRows) {
    const rangeCell = row.cells[columns.range] ?? "";
    const min = parseBandFloor(rangeCell);
    if (min === undefined) return { kind: "error", message: `Linha ${row.line}: não deu para ler a nota "${rangeCell}".` };
    const conversionCell = row.cells[columns.conversion] ?? "";
    const conversion = parsePercentInput(conversionCell);
    if (conversion === null) return { kind: "error", message: `Linha ${row.line}: a conversão "${conversionCell}" não é um número.` };
    if (conversionCell.includes("%")) anyPercentSign = true;
    const product = hasProductColumn ? (row.cells[columns.product] ?? "").replace(/\s+/g, " ").trim() : "";
    bands.push({ line: row.line, min, conversion, product });
  }

  // Ordem pela nota; a faixa sem piso é a de baixo.
  const floorless = bands.filter((band) => band.min === null);
  if (floorless.length > 1) {
    return { kind: "error", message: `Só uma faixa pode não ter nota mínima (linhas ${floorless.map((b) => b.line).join(" e ")}).` };
  }
  bands.sort((a, b) => (a.min === null ? -1 : b.min === null ? 1 : a.min - b.min));
  for (let i = 1; i < bands.length; i += 1) {
    if (bands[i].min !== null && bands[i].min === bands[i - 1].min) {
      return { kind: "error", message: `Duas faixas começam na nota ${formatScoreInput(bands[i].min!)} (linhas ${bands[i - 1].line} e ${bands[i].line}).` };
    }
  }

  const warnings: string[] = [];
  // A primeira faixa do cadastro não tem piso: a de nota mais baixa do arquivo passa
  // a valer também para o que estiver abaixo dela.
  const lowest = bands[0];
  if (lowest.min !== null && lowest.min > 0) {
    warnings.push(`A faixa que começa em ${formatScoreInput(lowest.min)} é a primeira: ela passa a valer também para as notas abaixo de ${formatScoreInput(lowest.min)}.`);
  }
  if (!anyPercentSign && bands.every((band) => band.conversion <= 0.01) && bands.some((band) => band.conversion > 0)) {
    warnings.push(
      "Nenhuma conversão passa de 1%. Os números foram lidos como porcentagem (0,04 = 0,04%); se o arquivo usa fração (0,04 = 4%), multiplique por 100 e importe de novo.",
    );
  }

  // Produtos: casa pelo nome com o cadastro; nome novo ocupa primeiro um produto
  // ainda em branco (o que "Configurar" cria) e só depois vira produto novo.
  const products: LeadEconomicsProductDraft[] = draft.products.map((product) => ({ ...product }));
  const newProducts: string[] = [];
  const isPlaceholder = (product: LeadEconomicsProductDraft) =>
    !product.name.trim() && !product.ticket.trim() && !product.contribution.trim() && !product.target.trim();
  const idByName = new Map<string, string>();
  for (const product of products) if (product.name.trim()) idByName.set(productNameKey(product.name), product.id);

  const productIdFor = (name: string): string | null => {
    const key = productNameKey(name);
    const known = idByName.get(key);
    if (known) return known;
    const placeholder = products.find((product) => isPlaceholder(product) && !Array.from(idByName.values()).includes(product.id));
    if (placeholder) {
      placeholder.name = name;
      idByName.set(key, placeholder.id);
      newProducts.push(name);
      return placeholder.id;
    }
    if (products.length >= LEAD_ECONOMICS_MAX_PRODUCTS) return null;
    const created: LeadEconomicsProductDraft = { id: newLeadEconomicsId(), name, ticket: "", contribution: "", target: "" };
    products.push(created);
    idByName.set(key, created.id);
    newProducts.push(name);
    return created.id;
  };

  const fallbackId = products[0]?.id ?? "";
  let unnamed = 0;
  const bandDrafts: LeadEconomicsBandDraft[] = [];
  for (const [index, band] of bands.entries()) {
    let productId = fallbackId;
    if (band.product) {
      const id = productIdFor(band.product);
      if (id === null) {
        return { kind: "error", message: `O arquivo nomeia produtos demais: o cadastro aceita no máximo ${LEAD_ECONOMICS_MAX_PRODUCTS}.` };
      }
      productId = id;
    } else if (hasProductColumn) {
      unnamed += 1;
    }
    bandDrafts.push({
      key: newLeadEconomicsId(),
      min: index === 0 || band.min === null ? "" : formatScoreInput(band.min),
      product: productId,
      conversion: formatPercentInput(band.conversion),
    });
  }
  if (!hasProductColumn && products.length > 1) {
    warnings.push(`O arquivo não diz o produto de cada faixa: todas ficaram com "${products[0].name || "o primeiro produto"}". Ajuste na coluna Produto.`);
  }
  if (unnamed > 0) {
    warnings.push(`${plural(unnamed, "faixa veio", "faixas vieram")} sem produto e ${unnamed === 1 ? "ficou" : "ficaram"} com "${products[0].name || "o primeiro produto"}".`);
  }
  if (newProducts.length > 0) {
    warnings.push(
      `${plural(newProducts.length, "produto novo", "produtos novos")} (${newProducts.join(", ")}): preencha ticket, quanto sobra e margem desejada.`,
    );
  }

  return { kind: "ok", draft: { products, bands: bandDrafts }, bandCount: bandDrafts.length, newProducts, warnings };
}
