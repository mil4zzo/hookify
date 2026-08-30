/**
 * As DUAS ausências de uma célula de métrica, e quando cada uma aparece.
 *
 *   "format"  → a métrica não se aplica ao criativo (hook num anúncio de imagem).
 *               A tela mostra um ícone de formato e não desenha sparkline.
 *   "missing" → a métrica cabe, mas não houve o que medir (CPR sem conversão).
 *               A tela mostra travessão e mantém o sparkline.
 *   null      → tem valor; nada de estado vazio.
 *
 * A regra que separa as duas é conservadora de propósito: só entra em "format"
 * quem tem CERTEZA (`media_type === "image"`). Vídeo sem entrega e formato
 * desconhecido caem em "missing" — dizer "é imagem" sem saber seria inventar.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { getManagerMetricEmptyKind, MANAGER_METRIC_KEYS } from "@/lib/metrics";
import { METRIC_DEFINITIONS } from "@/lib/metrics/definitions";

const VIDEO_METRICS = ["hook", "hold_rate", "scroll_stop", "video_watched_p50", "video_watched_p75"] as const;

/** Anúncio de imagem: 0 plays, métricas de vídeo zeradas pela RPC. */
const IMAGEM = {
  media_type: "image" as const,
  impressions: 40000,
  clicks: 800,
  spend: 300,
  lpv: 200,
  plays: 0,
  hook: 0,
  hold_rate: 0,
  scroll_stop: 0,
  video_watched_p50: 0,
  video_watched_p75: 0,
  ctr: 0.02,
  conversions: {},
};

const VIDEO = {
  media_type: "video" as const,
  impressions: 50000,
  clicks: 1000,
  spend: 800,
  lpv: 400,
  plays: 20000,
  hook: 0.35,
  hold_rate: 0.12,
  scroll_stop: 0.4,
  video_watched_p50: 8,
  video_watched_p75: 5,
  ctr: 0.02,
  conversions: { lead: 20 },
};

test("as cinco métricas de vídeo estão marcadas no registry — e só elas", () => {
  for (const key of VIDEO_METRICS) {
    assert.equal(METRIC_DEFINITIONS[key].requiresVideo, true, `${key} deveria exigir vídeo`);
  }
  const marcadas = MANAGER_METRIC_KEYS.filter((key) => METRIC_DEFINITIONS[key]?.requiresVideo);
  assert.deepEqual([...marcadas].sort(), [...VIDEO_METRICS].sort());
  // plays/thruplays são CONTAGEM: 0 reproduções num estático é fato, não ausência.
  for (const key of ["plays", "thruplays", "spend", "impressions", "ctr", "cpr"] as const) {
    assert.ok(!METRIC_DEFINITIONS[key]?.requiresVideo, `${key} não deveria exigir vídeo`);
  }
});

test("anúncio de imagem: métrica de vídeo é 'format'", () => {
  for (const metric of VIDEO_METRICS) {
    assert.equal(getManagerMetricEmptyKind(IMAGEM, metric), "format", `${metric} deveria ser format`);
  }
});

test("anúncio de imagem: o que NÃO é de vídeo nunca vira 'format'", () => {
  // CPR sem conversão continua sendo travessão, mesmo num estático — a métrica
  // cabe no anúncio, só não houve conversão. É a distinção que o usuário pediu.
  assert.equal(getManagerMetricEmptyKind(IMAGEM, "cpr", { actionType: "lead" }), "missing");
  assert.equal(getManagerMetricEmptyKind(IMAGEM, "cpmql", { hasSheetIntegration: true }), "missing");
  // Métrica com valor real não tem estado vazio nenhum.
  assert.equal(getManagerMetricEmptyKind(IMAGEM, "ctr"), null);
  assert.equal(getManagerMetricEmptyKind(IMAGEM, "spend"), null);
  assert.equal(getManagerMetricEmptyKind(IMAGEM, "impressions"), null);
});

test("anúncio de imagem sem impressões: CTR é 'missing', não 'format'", () => {
  const pausado = { ...IMAGEM, impressions: 0, ctr: 0, clicks: 0, spend: 0 };
  assert.equal(getManagerMetricEmptyKind(pausado, "ctr"), "missing");
  // E as de vídeo seguem sendo format: o motivo continua sendo o formato.
  assert.equal(getManagerMetricEmptyKind(pausado, "hook"), "format");
});

test("vídeo com dado: nenhuma métrica de vídeo entra em estado vazio", () => {
  for (const metric of VIDEO_METRICS) {
    assert.equal(getManagerMetricEmptyKind(VIDEO, metric), null, `${metric} tem valor`);
  }
});

test("vídeo SEM entrega no período é 'missing' — não se inventa formato", () => {
  // Zero plays num vídeo não é "não se aplica": a métrica cabe, faltou entrega.
  const semEntrega = { ...VIDEO, plays: 0, hook: 0, hold_rate: 0, scroll_stop: 0, video_watched_p50: 0, video_watched_p75: 0 };
  for (const metric of VIDEO_METRICS) {
    assert.equal(getManagerMetricEmptyKind(semEntrega, metric), "missing", `${metric} deveria ser missing`);
  }
});

test("formato desconhecido ou ausente cai em 'missing'", () => {
  for (const mediaType of ["unknown", null, undefined]) {
    const linha = { ...IMAGEM, media_type: mediaType } as any;
    assert.equal(getManagerMetricEmptyKind(linha, "hook"), "missing", `media_type=${mediaType}`);
  }
});

test("linha agregada que MISTURA formatos não cai em estado vazio", () => {
  // Um criativo rodando como vídeo e como estático: os vídeos alimentam plays,
  // então hook existe e o ramo de formato nem é alcançado — mesmo que o
  // representante do grupo seja a imagem.
  const misto = { ...IMAGEM, media_type: "image" as const, plays: 12000, hook: 0.28 };
  assert.equal(getManagerMetricEmptyKind(misto, "hook"), null);
});

test("linha-filha (sem media_type) usa travessão — o fallback honesto", () => {
  // RankingsChildrenItemSchema não devolve media_type; sem ele não dá para
  // afirmar "é imagem", então a célula fica com travessão em vez de mentir.
  const filha = { impressions: 900, clicks: 20, spend: 15, plays: 0, hook: 0, ctr: 0.022, conversions: {} };
  assert.equal(getManagerMetricEmptyKind(filha, "hook"), "missing");
});
