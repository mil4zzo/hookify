import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ATTRIBUTION_WINDOW_DAYS,
  MAX_ATTRIBUTION_WINDOW_DAYS,
  attributionWindowLabel,
  lookbackDaysForPack,
  sinceLastRefreshStart,
} from "../refreshWindow";

// Espelho da regra do backend (routes/facebook.py, since_last_refresh):
//   since = max(last_refreshed_at - recuo, date_start); recuo = janela do pack ou 7.
// Se um lado mudar sem o outro, o modal promete uma data e o refresh pede outra.

test("pack não calibrado recua pelo teto atual (7), nunca por 1 dia", () => {
  assert.equal(lookbackDaysForPack({}), DEFAULT_ATTRIBUTION_WINDOW_DAYS);
  assert.equal(lookbackDaysForPack({ attribution_window_days: null }), DEFAULT_ATTRIBUTION_WINDOW_DAYS);
  assert.equal(lookbackDaysForPack(null), DEFAULT_ATTRIBUTION_WINDOW_DAYS);
});

test("pack calibrado usa o próprio valor, com teto de segurança", () => {
  assert.equal(lookbackDaysForPack({ attribution_window_days: 1 }), 1);
  assert.equal(lookbackDaysForPack({ attribution_window_days: 7 }), 7);
  assert.equal(lookbackDaysForPack({ attribution_window_days: 90 }), MAX_ATTRIBUTION_WINDOW_DAYS);
  assert.equal(lookbackDaysForPack({ attribution_window_days: 0 }), DEFAULT_ATTRIBUTION_WINDOW_DAYS);
});

test("data inicial = última atualização menos o recuo", () => {
  assert.equal(
    sinceLastRefreshStart({ last_refreshed_at: "2026-09-06", date_start: "2026-07-07", attribution_window_days: 7 }),
    "2026-08-30",
  );
  assert.equal(
    sinceLastRefreshStart({ last_refreshed_at: "2026-09-06", date_start: "2026-07-07", attribution_window_days: 1 }),
    "2026-09-05",
  );
});

test("nunca antes do início do pack (o primeiro dia não leva recuo)", () => {
  assert.equal(
    sinceLastRefreshStart({ last_refreshed_at: "2026-09-06", date_start: "2026-09-03", attribution_window_days: 7 }),
    "2026-09-03",
  );
});

test("sem last_refreshed_at cai no date_stop (pack legado); sem âncora nenhuma, null", () => {
  assert.equal(sinceLastRefreshStart({ date_stop: "2026-09-06", attribution_window_days: 7 }), "2026-08-30");
  assert.equal(sinceLastRefreshStart({}), null);
});

test("âncora com hora (ISO completo) é lida pela data", () => {
  assert.equal(
    sinceLastRefreshStart({ last_refreshed_at: "2026-09-06T03:00:00", attribution_window_days: 7 }),
    "2026-08-30",
  );
});

test("rótulo da janela para a UI", () => {
  assert.equal(attributionWindowLabel("1d_view_7d_click"), "7d clique · 1d view");
  assert.equal(attributionWindowLabel("7d_click"), "7d clique");
  assert.equal(attributionWindowLabel("1d_ev_7d_click"), "7d clique · 1d engajamento");
  assert.equal(attributionWindowLabel("default"), "default");
  assert.equal(attributionWindowLabel(null), null);
});
