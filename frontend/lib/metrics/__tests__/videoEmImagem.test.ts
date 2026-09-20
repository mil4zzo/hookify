/**
 * As duas formas de a LEITURA de métrica afirmar um número que não existe.
 *
 * 1. MÉTRICA DE VÍDEO EM ANÚNCIO DE IMAGEM
 *    A Meta às vezes manda plays num anúncio de imagem. No laboratório (2026-09-14),
 *    58 de 971 imagens tinham plays, até 1.713. O ADNI90 ("chat wpp prima", imagem nas
 *    100 variações) tinha 1 play e hook de 100% — e vencia o ranking de hook. A EXIBIÇÃO
 *    já tratava isso (`getManagerMetricEmptyKind` → "format"); a leitura, que alimenta
 *    filtros, critério de validação, Boards e rankings, não. Mesma certeza exigida lá:
 *    só `media_type === "image"`. Formato desconhecido não é imagem.
 *
 * 2. DIVISOR ZERO NAS RAZÕES QUE A RPC FABRICA COMO 0
 *    website_ctr, connect_rate, page_conv, cpm e frequency liam o 0 da RPC quando o
 *    divisor era zero — ao contrário de hook, CTR e custos, e contra a regra dos três
 *    estados. `connect_rate < 50%` trazia quem não teve clique no link. Divisor PRESENTE e
 *    zero = sem dado; divisor ausente continua não sendo zero.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { getMetricNumericValueOrNull } from "@/lib/metrics";
import { rowMatchesRules } from "@/lib/rules/evaluate";
import type { RuleTree } from "@/lib/rules/types";

/** O ADNI90 do laboratório: imagem, 1 play espúrio, hook 100%. */
const IMAGEM_COM_PLAY = {
  media_type: "image",
  impressions: 372848,
  clicks: 9000,
  inline_link_clicks: 7000,
  lpv: 5000,
  spend: 2191,
  plays: 1,
  video_total_thruplays: 1,
  hook: 1,
  hold_rate: 1,
  scroll_stop: 0.000003,
  video_watched_p50: 100,
  video_watched_p75: 100,
  ctr: 0.024,
  conversions: {},
};

const VIDEO = { ...IMAGEM_COM_PLAY, media_type: "video", plays: 112882, hook: 0.523 };

const VIDEO_ONLY = ["hook", "hold_rate", "scroll_stop", "video_watched_p50", "video_watched_p75", "plays", "thruplays"];

function hook(operator: string, value: number | null): RuleTree {
  return { logic: "AND", conditions: [{ id: "c", type: "condition", field: "hook", operator, value }] };
}

test("imagem com play espúrio: nenhuma métrica de vídeo se aplica, o resto segue", () => {
  for (const key of VIDEO_ONLY) {
    assert.equal(getMetricNumericValueOrNull(IMAGEM_COM_PLAY, key), null, key);
  }
  assert.equal(getMetricNumericValueOrNull(IMAGEM_COM_PLAY, "ctr"), 0.024);
  assert.equal(getMetricNumericValueOrNull(IMAGEM_COM_PLAY, "spend"), 2191);
  assert.equal(getMetricNumericValueOrNull(VIDEO, "hook"), 0.523);
  assert.equal(getMetricNumericValueOrNull(VIDEO, "plays"), 112882);
});

test("imagem não entra em filtro ou ranking de hook — nem pelo lado contrário", () => {
  assert.equal(rowMatchesRules(IMAGEM_COM_PLAY, hook(">", 50)), false);
  assert.equal(rowMatchesRules(IMAGEM_COM_PLAY, hook("<=", 50)), false);
  assert.equal(rowMatchesRules(IMAGEM_COM_PLAY, hook("is_empty", null)), true);
  assert.equal(rowMatchesRules(VIDEO, hook(">", 50)), true);
});

test("formato desconhecido não é imagem: o valor lido continua valendo", () => {
  assert.equal(getMetricNumericValueOrNull({ ...IMAGEM_COM_PLAY, media_type: undefined }, "hook"), 1);
  assert.equal(getMetricNumericValueOrNull({ ...IMAGEM_COM_PLAY, media_type: "unknown" }, "hook"), 1);
});

const RAZOES = {
  spend: 100,
  impressions: 5000,
  reach: 2000,
  clicks: 50,
  inline_link_clicks: 40,
  lpv: 30,
  website_ctr: 0.008,
  connect_rate: 0.75,
  page_conv: 0.1,
  cpm: 20,
  frequency: 2.5,
  conversions: { "action:purchase": 3 },
};

test("divisor zero nas cinco razões que a RPC fabrica como 0: sem dado", () => {
  assert.equal(getMetricNumericValueOrNull({ ...RAZOES, impressions: 0, website_ctr: 0 }, "website_ctr"), null);
  assert.equal(getMetricNumericValueOrNull({ ...RAZOES, impressions: 0, cpm: 0 }, "cpm"), null);
  assert.equal(getMetricNumericValueOrNull({ ...RAZOES, impressions: 0, frequency: 0 }, "frequency"), null);
  assert.equal(getMetricNumericValueOrNull({ ...RAZOES, inline_link_clicks: 0, connect_rate: 0 }, "connect_rate"), null);
  assert.equal(
    getMetricNumericValueOrNull({ ...RAZOES, lpv: 0, page_conv: 0 }, "page_conv", { actionType: "action:purchase" }),
    null,
  );
});

test("com divisor, o valor da RPC vale — inclusive o zero de verdade", () => {
  assert.equal(getMetricNumericValueOrNull(RAZOES, "website_ctr"), 0.008);
  assert.equal(getMetricNumericValueOrNull({ ...RAZOES, connect_rate: 0 }, "connect_rate"), 0);
  assert.equal(getMetricNumericValueOrNull({ ...RAZOES, cpm: 20 }, "cpm"), 20);
});

test("divisor ausente não é divisor zero", () => {
  assert.equal(getMetricNumericValueOrNull({ website_ctr: 0.01 }, "website_ctr"), 0.01);
  assert.equal(getMetricNumericValueOrNull({ connect_rate: 0.5, inline_link_clicks: null }, "connect_rate"), 0.5);
});

test("connect rate < 50% não traz mais quem não teve clique no link", () => {
  const regra: RuleTree = {
    logic: "AND",
    conditions: [{ id: "c", type: "condition", field: "connect_rate", operator: "<", value: 50 }],
  };
  assert.equal(rowMatchesRules({ ...RAZOES, inline_link_clicks: 0, connect_rate: 0 }, regra), false);
  assert.equal(rowMatchesRules({ ...RAZOES, connect_rate: 0.3 }, regra), true);
});

test("médias do Manager: imagem com play espúrio não entra em plays, hook nem scroll stop", async () => {
  const { computeManagerAverages } = await import("@/lib/metrics");
  const video = { ...VIDEO, plays: 1000, hook: 0.5, scroll_stop: 0.3 };
  const soVideo = computeManagerAverages([video] as any[], { includeScrollStop: true } as any);
  const comImagem = computeManagerAverages([video, { ...IMAGEM_COM_PLAY, scroll_stop: 0.9 }] as any[], { includeScrollStop: true } as any);
  assert.equal(comImagem.sumPlays, soVideo.sumPlays);
  assert.equal(comImagem.hook, soVideo.hook);
  assert.equal(comImagem.scroll_stop, soVideo.scroll_stop);
});
