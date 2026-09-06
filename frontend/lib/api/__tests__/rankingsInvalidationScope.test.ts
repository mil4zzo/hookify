import test from "node:test";
import assert from "node:assert/strict";

import { isManagerRowsQueryKey, queryKeys } from "@/lib/api/hooks";
import type { RankingsRequest } from "@/lib/api/schemas";

/**
 * Escopo de `invalidateRankingsRows` (usado quando uma transcrição termina).
 *
 * O prefixo ['analytics','rankings'] NÃO é só a tabela do Manager: as oito consultas de
 * detalhe moram debaixo dele e vêm de outra RPC, que nem devolve o estado da
 * transcrição. Invalidar por prefixo jogava fora, entre outras, a `ad-creative` — que
 * se reconstrói com chamada à Meta.
 *
 * SABOTAGEM (rodada em 2026-09-05): trocar o predicado por
 * `k[0] === 'analytics' && k[1] === 'rankings'` faz os casos de detalhe falharem;
 * esvaziar RANKINGS_DETAIL_MARKERS faz o mesmo.
 */

const params = {
  date_start: "2026-08-01",
  date_stop: "2026-08-31",
  group_by: "ad_name",
} as unknown as RankingsRequest;

test("a chave da tabela do Manager entra", () => {
  assert.equal(isManagerRowsQueryKey(queryKeys.rankings(params)), true);
  assert.equal(isManagerRowsQueryKey(queryKeys.adPerformance(params, "stamp")), true);
});

test("toda chave de detalhe fica de fora", () => {
  const detalhes: unknown[][] = [
    [...queryKeys.adVariations("Ad A", "2026-08-01", "2026-08-31")],
    [...queryKeys.adDetails("123", "2026-08-01", "2026-08-31")],
    [...queryKeys.adCreative("123")],
    [...queryKeys.adHistory("123", "2026-08-01", "2026-08-31")],
    [...queryKeys.adNameDetails("Ad A", "2026-08-01", "2026-08-31")],
    [...queryKeys.adNameHistory("Ad A", "2026-08-01", "2026-08-31")],
    [...queryKeys.campaignChildren("c1", "2026-08-01", "2026-08-31", "lead", "")],
    [...queryKeys.adsetChildren("s1", "2026-08-01", "2026-08-31")],
  ];
  for (const k of detalhes) {
    assert.equal(isManagerRowsQueryKey(k), false, `deveria ficar de fora: ${String(k[2])}`);
  }
});

test("a lista de marcadores cobre TODA chave de detalhe existente", () => {
  // Guarda contra chave de detalhe nova entrar sem ser registrada em
  // RANKINGS_DETAIL_MARKERS — o modo de falha é silencioso (a chave nova passa a ser
  // invalidada junto com a tabela e ninguém percebe).
  // As fábricas de chave têm assinaturas diferentes; aqui só importa o FORMATO da chave
  // gerada, então chamamos todas com strings e ignoramos o tipo dos parâmetros.
  const entradas = Object.entries(queryKeys) as [string, unknown][];
  const sobDoPrefixo = entradas
    .filter(([nome]) => nome !== "rankings" && nome !== "adPerformance")
    .map(([nome, valor]) =>
      [nome, typeof valor === "function" ? (valor as (...a: string[]) => unknown)("x", "x", "x", "x", "x") : valor] as const
    )
    .filter(([, k]) => Array.isArray(k) && k[0] === "analytics" && k[1] === "rankings");

  assert.ok(sobDoPrefixo.length >= 8, "cenário vazio: nenhuma chave de detalhe encontrada");
  for (const [nome, k] of sobDoPrefixo) {
    assert.equal(isManagerRowsQueryKey(k), false, `chave de detalhe não registrada: ${nome}`);
  }
});

test("séries, retenção e chaves de outros domínios não são tocadas", () => {
  assert.equal(isManagerRowsQueryKey(["analytics", "rankings-series", "2026-08-01"]), false);
  assert.equal(isManagerRowsQueryKey(["analytics", "rankings-retention", "2026-08-01"]), false);
  assert.equal(isManagerRowsQueryKey(queryKeys.packAds("p1")), false);
  assert.equal(isManagerRowsQueryKey(queryKeys.adTranscription("Ad A")), false);
  assert.equal(isManagerRowsQueryKey(["facebook", "me"]), false);
  assert.equal(isManagerRowsQueryKey(null), false);
  assert.equal(isManagerRowsQueryKey("analytics"), false);
});
