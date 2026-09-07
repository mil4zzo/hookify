import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { overlapDays, buildVerdict } from "../dateColumnHealth";
import type { DateColumnProbe } from "@/lib/api/schemas";

function probe(over: Partial<DateColumnProbe> = {}): DateColumnProbe {
  return {
    total_cells: 100,
    non_empty_cells: 100,
    readable_cells: 100,
    format_verdict: "DD/MM/YYYY",
    resolved_format: "DD/MM/YYYY",
    evidence_dd_mm: 40,
    evidence_mm_dd: 0,
    unparseable_samples: [],
    date_min: "2026-08-25",
    date_max: "2026-09-07",
    ...over,
  } as DateColumnProbe;
}

describe("overlapDays", () => {
  it("o caso real: janelas disjuntas dão zero", () => {
    assert.equal(overlapDays("2026-08-25", "2026-09-07", "2026-07-07", "2026-08-17"), 0);
  });

  it("um único dia em comum conta 1, não 0", () => {
    assert.equal(overlapDays("2026-08-17", "2026-09-07", "2026-07-07", "2026-08-17"), 1);
  });

  it("um dia de distância ainda é zero", () => {
    assert.equal(overlapDays("2026-08-18", "2026-09-07", "2026-07-07", "2026-08-17"), 0);
  });

  it("janela contida conta o intervalo inteiro", () => {
    assert.equal(overlapDays("2026-07-10", "2026-07-12", "2026-07-07", "2026-08-17"), 3);
  });

  it("sem janela do pack devolve null, não zero", () => {
    // null = "não sei"; zero acionaria o aviso de 'não cobre o período'.
    assert.equal(overlapDays("2026-08-25", "2026-09-07", null, null), null);
  });
});

describe("buildVerdict", () => {
  it("tudo certo quando há sobreposição e o formato bate", () => {
    assert.deepEqual(buildVerdict(probe(), "DD/MM/YYYY", 12), {
      tone: "ok",
      headline: "Tudo certo",
    });
  });

  it("formato divergente do provado é ERRO, não aviso", () => {
    // É o único caso daqui que corrompe dado em silêncio.
    const v = buildVerdict(probe(), "MM/DD/YYYY", 12);
    assert.equal(v.tone, "error");
  });

  it("formato divergente ganha da falta de sobreposição", () => {
    const v = buildVerdict(probe(), "MM/DD/YYYY", 0);
    assert.match(v.headline, /não bate com os dados/);
  });

  it("sem sobreposição é aviso, não erro — planilha nova é caso legítimo", () => {
    const v = buildVerdict(probe(), "DD/MM/YYYY", 0);
    assert.equal(v.tone, "warn");
  });

  it("overlap null (sem pack) não vira aviso", () => {
    assert.equal(buildVerdict(probe(), "DD/MM/YYYY", null).tone, "ok");
  });

  it("ambíguo pede escolha manual e não é erro", () => {
    const v = buildVerdict(
      probe({ format_verdict: "ambiguous", resolved_format: null, readable_cells: 0 }),
      "",
      null,
    );
    assert.equal(v.tone, "warn");
  });

  it("conflito de formatos é erro", () => {
    const v = buildVerdict(
      probe({ format_verdict: "conflicting", resolved_format: null, readable_cells: 0 }),
      "",
      null,
    );
    assert.equal(v.tone, "error");
  });

  it("linhas ilegíveis viram aviso mesmo com formato certo", () => {
    const v = buildVerdict(probe({ readable_cells: 57 }), "DD/MM/YYYY", 12);
    assert.equal(v.tone, "warn");
  });

  it("seletor ainda vazio não acusa divergência", () => {
    assert.equal(buildVerdict(probe(), "", 12).tone, "ok");
  });
});
