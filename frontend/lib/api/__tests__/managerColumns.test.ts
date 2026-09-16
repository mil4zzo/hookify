/**
 * Leitor do formato em colunas da resposta do Manager (migration 161).
 *
 * O que importa provar:
 *  - PARIDADE: sobre o formato real da v161 (fixture anonimizado), o leitor
 *    TypeScript produz exatamente as linhas que o leitor Python produz;
 *  - coluna desalinhada falha ALTO (um campo deslocado casaria o gasto de um
 *    anúncio com o nome de outro, sem erro na tela);
 *  - a gravação em colunas no IndexedDB volta idêntica, e não empacota o que não
 *    voltaria idêntico (campo ausente, `undefined`);
 *  - entradas gravadas ANTES da 161 (em linhas) continuam sendo lidas;
 *  - (162) a resposta EM PEDAÇOS dá as mesmas linhas, em qualquer ordem de pedaços,
 *    e falha alto sem (ou com dois) pedaços de metadados.
 *
 * SABOTAGENS (16/09): tirar a checagem `valores.length !== n` -> "coluna
 * desalinhada falha alto" falha; em columnsFromRows, tirar o `return null` de
 * `undefined` -> "não empacota undefined" falha; em deserializeAnalyticsQuery,
 * não converter -> "persister: colunas voltam como linhas" falha.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ColumnarPayloadError,
  asRowPayload,
  columnsFromRows,
  fromParts,
  rowsFromColumns,
  type ColumnarPayload,
} from "../managerColumns";
import { deserializeAnalyticsQuery, serializeAnalyticsQuery } from "../analyticsPersister";

function cp(row_count: number, data_columns: Array<Record<string, unknown[] | null>>, row_order?: number[]): ColumnarPayload {
  return { row_count, data_columns, ...(row_order ? { row_order } : {}) };
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "manager_columns_v161.json"), "utf8"),
) as { casos: Array<{ nome: string; payload: ColumnarPayload; linhas: Array<Record<string, unknown>> }> };

for (const caso of fixture.casos) {
  test(`paridade com o leitor Python: ${caso.nome}`, () => {
    assert.ok(caso.linhas.length > 0, "fixture sem linhas não prova nada");
    assert.deepStrictEqual(rowsFromColumns(caso.payload), caso.linhas);
  });

  test(`paridade em pedaços (162): ${caso.nome}`, () => {
    const { data_columns, ...meta } = caso.payload;
    const partes: unknown[] = [...data_columns].reverse();
    partes.splice(Math.floor(partes.length / 2), 0, meta);
    const out = asRowPayload(partes) as Record<string, unknown>;
    assert.deepStrictEqual(out.data, caso.linhas);
    assert.ok(!("row_count" in out) && !("data_columns" in out));
  });

  test(`ida e volta pela gravação: ${caso.nome}`, () => {
    const packed = columnsFromRows(caso.linhas);
    assert.ok(packed, "linhas homogêneas devem empacotar");
    assert.deepStrictEqual(rowsFromColumns(packed as ColumnarPayload), caso.linhas);
  });
}

test("linhas na ordem, com nulos, juntando blocos", () => {
  const p = cp(3, [{ a: [1, 2, 3] }, { b: ["x", null, "z"] }]);
  assert.deepStrictEqual(rowsFromColumns(p), [
    { a: 1, b: "x" },
    { a: 2, b: null },
    { a: 3, b: "z" },
  ]);
});

test("zero linhas: o banco manda as listas como null", () => {
  assert.deepStrictEqual(rowsFromColumns(cp(0, [{ a: null }])), []);
});

test("coluna desalinhada falha alto", () => {
  assert.throws(
    () => rowsFromColumns(cp(2, [{ a: [1, 2] }, { b: [1] }])),
    ColumnarPayloadError,
  );
});

test("campo repetido entre blocos falha alto", () => {
  assert.throws(
    () => rowsFromColumns(cp(1, [{ a: [1] }, { a: [2] }])),
    ColumnarPayloadError,
  );
});

test("__proto__ não é aceito", () => {
  const bloco = JSON.parse('{"__proto__": [1]}');
  assert.throws(() => rowsFromColumns(cp(1, [bloco])), ColumnarPayloadError);
});

test("as linhas não compartilham objeto", () => {
  const rows = rowsFromColumns(cp(2, [{ a: [1, 2] }]));
  rows[0].a = 99;
  assert.equal(rows[1].a, 2);
});

test("asRowPayload: converte colunas e tira os campos do formato", () => {
  const out = asRowPayload({ ...cp(1, [{ a: [1] }], [1]), averages: { hook: 0.1 } }) as Record<string, unknown>;
  assert.deepStrictEqual(out, { averages: { hook: 0.1 }, data: [{ a: 1 }] });
});

test("asRowPayload: resposta que já vem em linhas passa intacta", () => {
  const vazia = { data: [], available_conversion_types: [] };
  assert.equal(asRowPayload(vazia), vazia);
});

test("pedaços em qualquer ordem dão as mesmas linhas", () => {
  const meta = { row_count: 2, row_order: [2, 1], names: {} };
  const a = { a: [1, 2] };
  const b = { b: ["x", "y"] };
  const esperado = [{ a: 2, b: "y" }, { a: 1, b: "x" }];
  assert.deepStrictEqual((asRowPayload([meta, a, b]) as Record<string, unknown>).data, esperado);
  assert.deepStrictEqual((asRowPayload([b, meta, a]) as Record<string, unknown>).data, esperado);
});

test("pedaços malformados falham alto", () => {
  const casos: unknown[][] = [
    [{ a: [1] }],
    [{ row_count: 1 }, { row_count: 1 }, { a: [1] }],
    [{ row_count: 1 }, [1]],
    [{ row_count: 1, data_columns: [] }, { a: [1] }],
  ];
  for (const partes of casos) assert.throws(() => fromParts(partes), ColumnarPayloadError);
  assert.throws(() => asRowPayload([{ row_count: 2 }, { a: [1, 2] }, { b: [1] }]), ColumnarPayloadError);
});

test("row_order: as linhas saem na posição indicada", () => {
  const p = cp(3, [{ a: ["c", "a", "b"] }, { b: [30, 10, 20] }], [3, 1, 2]);
  assert.deepStrictEqual(rowsFromColumns(p), [
    { a: "a", b: 10 },
    { a: "b", b: 20 },
    { a: "c", b: 30 },
  ]);
});

test("row_order: posições não contíguas (filtro por campanha) também ordenam", () => {
  const p = cp(3, [{ a: ["x", "y", "z"] }], [50, 7, 12]);
  assert.deepStrictEqual(rowsFromColumns(p).map((r) => r.a), ["y", "z", "x"]);
});

test("row_order com tamanho errado falha alto", () => {
  assert.throws(() => rowsFromColumns(cp(2, [{ a: [1, 2] }], [1])), ColumnarPayloadError);
});

test("não empacota linhas com campos diferentes (ausente não pode virar nulo)", () => {
  assert.equal(columnsFromRows([{ a: 1, b: 2 }, { a: 1 }]), null);
  assert.equal(columnsFromRows([{ a: 1 }, { a: 1, b: 2 }]), null);
  assert.equal(columnsFromRows([{ a: 1 }, { b: 1 }]), null);
});

test("não empacota undefined (JSON o transformaria em null)", () => {
  assert.equal(columnsFromRows([{ a: 1 }, { a: undefined }]), null);
});

// ---------------------------------------------------------------------------
// Persister
// ---------------------------------------------------------------------------

function persistida(data: unknown) {
  return {
    buster: "v1:u1",
    queryHash: "h",
    queryKey: ["analytics", "rankings", "2026-08-26"],
    state: { data, dataUpdatedAt: 1, dataUpdateCount: 1, error: null, errorUpdateCount: 0, errorUpdatedAt: 0, fetchFailureCount: 0, fetchFailureReason: null, fetchMeta: null, isInvalidated: false, status: "success", fetchStatus: "idle" },
  } as any;
}

test("persister: grava em colunas e volta como linhas", () => {
  const linhas = fixture.casos[1].linhas;
  const texto = serializeAnalyticsQuery(persistida({ data: linhas, averages: { hook: 1 } }));
  const gravado = JSON.parse(texto);
  assert.ok("data_columns" in gravado.state.data, "deveria gravar em colunas");
  assert.ok(!("data" in gravado.state.data));
  const lido = deserializeAnalyticsQuery(texto);
  assert.deepStrictEqual(lido.state.data, { averages: { hook: 1 }, data: linhas });
});

test("persister: gravação em colunas ocupa menos", () => {
  const linhas = fixture.casos[1].linhas;
  const colunas = serializeAnalyticsQuery(persistida({ data: linhas })).length;
  const emLinhas = JSON.stringify(persistida({ data: linhas })).length;
  assert.ok(colunas < emLinhas, `${colunas} >= ${emLinhas}`);
});

test("persister: entrada gravada antes da 161 (em linhas) continua valendo", () => {
  const antiga = JSON.stringify(persistida({ data: [{ a: 1 }] }));
  assert.deepStrictEqual(deserializeAnalyticsQuery(antiga).state.data, { data: [{ a: 1 }] });
});

test("persister: linhas heterogêneas gravam em linhas", () => {
  const texto = serializeAnalyticsQuery(persistida({ data: [{ a: 1 }, { b: 2 }] }));
  assert.deepStrictEqual(JSON.parse(texto).state.data, { data: [{ a: 1 }, { b: 2 }] });
});

test("persister: resposta de série (sem `data`) grava como sempre", () => {
  const serie = { series_by_group: { g: { axis: [] } }, window: 5 };
  const texto = serializeAnalyticsQuery(persistida(serie));
  assert.deepStrictEqual(deserializeAnalyticsQuery(texto).state.data, serie);
});
