import assert from "node:assert/strict";
import { test } from "node:test";

import { listNames, summarizeBulkSheetSync } from "../bulkSheetSync";

const NAMES = { p1: "EI.31", p2: "EI.30", p3: "EI.29", p4: "EI.28" };

test("separa atualizado, sem linhas correspondentes e falha", () => {
  const s = summarizeBulkSheetSync(
    [
      { integration_id: "i1", pack_id: "p1", status: "completed", rows_updated: 120, sync_outcome: "success" },
      { integration_id: "i2", pack_id: "p2", status: "completed", rows_updated: 0, sync_outcome: "no_match" },
      { integration_id: "i3", pack_id: "p3", status: "failed", error: "Token do Google expirado" },
      { integration_id: "i4", pack_id: "p4", status: "completed", rows_updated: 0, sync_outcome: "empty" },
    ],
    NAMES,
  );
  assert.deepEqual(s.updated, ["EI.31"]);
  assert.deepEqual(s.noMatch, ["EI.30", "EI.28"]);
  assert.deepEqual(s.failed, [{ name: "EI.29", error: "Token do Google expirado" }]);
  assert.deepEqual(s.packIdsWithChanges, ["p1"], "só o pack que mudou perde o cache");
  assert.equal(s.headline, "1 pack atualizado · 2 sem linhas correspondentes · 1 falhou");
});

test("tudo certo vira uma linha só", () => {
  const s = summarizeBulkSheetSync(
    [
      { integration_id: "i1", pack_id: "p1", status: "completed", rows_updated: 3, sync_outcome: "success" },
      { integration_id: "i2", pack_id: "p2", status: "completed", rows_updated: 9, sync_outcome: "success" },
    ],
    NAMES,
  );
  assert.equal(s.headline, "2 packs atualizados");
  assert.deepEqual(s.noMatch, []);
});

test("lista de nomes encurta", () => {
  assert.equal(listNames(["A", "B"]), "A, B");
  assert.equal(listNames(["A", "B", "C", "D", "E"]), "A, B, C e mais 2");
});
