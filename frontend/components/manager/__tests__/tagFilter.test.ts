import assert from "node:assert/strict";
import test from "node:test";

import { getManagerFilterableColumns, getVisibleManagerColumns } from "../managerColumnPreferences";
import { isRestrictiveTagFilterValue, normalizeTagFilterValue, rowMatchesTagFilter, type TagFilterValue } from "@/lib/tags/filter";

const TAG_A = { id: "tag-a", name: "Hook Dor", color: "chart1" };
const TAG_B = { id: "tag-b", name: "Topo", color: "chart2" };
const TAG_C = { id: "tag-c", name: "Teste", color: "chart3" };

const value = (operator: TagFilterValue["operator"], tagIds: string[] = []): TagFilterValue => ({ operator, tagIds });

test("tags filtram por operador proprio, nao por texto nem por checkbox de status", () => {
  const visibleColumns = getVisibleManagerColumns({
    activeColumns: new Set(["spend", "tags", "pack"] as const) as Set<any>,
    hasSheetIntegration: true,
  });

  // Sem opcao-sentinela: "Sem tag" agora e operador, nao um item da lista.
  const options = [{ value: TAG_A.id, label: TAG_A.name }];
  const filterableColumns = getManagerFilterableColumns({ visibleColumns, tagOptions: options });

  // Casar por nome quebraria assim que a tag fosse renomeada — o filtro casa por id.
  assert.deepEqual(filterableColumns, [
    { id: "spend", label: "Spend", isPercentage: false },
    { id: "tags", label: "Tags", isTags: true, options },
    { id: "pack", label: "Pack", isText: true },
  ]);
});

test("sem vocabulario de tags a coluna nao e oferecida como filtro", () => {
  const visibleColumns = getVisibleManagerColumns({
    activeColumns: new Set(["spend", "tags"] as const) as Set<any>,
    hasSheetIntegration: true,
  });

  // E o caso da tabela de filhos, que nao passa tagOptions e cujas linhas nao tem tags.
  const filterableColumns = getManagerFilterableColumns({ visibleColumns });
  assert.deepEqual(filterableColumns, [{ id: "spend", label: "Spend", isPercentage: false }]);
});

test("pergunta incompleta nao restringe", () => {
  assert.equal(rowMatchesTagFilter([TAG_A], undefined), true);
  // Operador escolhido, nenhuma tag ainda: o filtro recem-criado nao pode esvaziar a tabela.
  assert.equal(rowMatchesTagFilter([TAG_A], value("has_any")), true);
  assert.equal(rowMatchesTagFilter([], value("has_all")), true);
  assert.equal(isRestrictiveTagFilterValue(value("has_any")), false);
});

test("contem alguma: basta uma das escolhidas", () => {
  const filter = value("has_any", [TAG_A.id, TAG_B.id]);
  assert.equal(rowMatchesTagFilter([TAG_A], filter), true);
  assert.equal(rowMatchesTagFilter([TAG_B, TAG_C], filter), true);
  assert.equal(rowMatchesTagFilter([TAG_C], filter), false);
  assert.equal(rowMatchesTagFilter([], filter), false);
});

test("contem todas: exige o conjunto inteiro, mas admite extras", () => {
  const filter = value("has_all", [TAG_A.id, TAG_B.id]);
  assert.equal(rowMatchesTagFilter([TAG_A, TAG_B], filter), true);
  assert.equal(rowMatchesTagFilter([TAG_A, TAG_B, TAG_C], filter), true);
  assert.equal(rowMatchesTagFilter([TAG_A], filter), false);
});

test("nao contem nenhuma: linha sem tag passa", () => {
  const filter = value("has_none", [TAG_A.id]);
  assert.equal(rowMatchesTagFilter([TAG_B], filter), true);
  // Decisao explicita: quem nao tem tag nenhuma nao contem, de fato, nenhuma das escolhidas.
  assert.equal(rowMatchesTagFilter([], filter), true);
  assert.equal(rowMatchesTagFilter(undefined, filter), true);
  assert.equal(rowMatchesTagFilter([TAG_A, TAG_B], filter), false);
});

test("contem exatamente: nem mais nem menos", () => {
  const filter = value("has_exact", [TAG_A.id, TAG_B.id]);
  assert.equal(rowMatchesTagFilter([TAG_B, TAG_A], filter), true);
  assert.equal(rowMatchesTagFilter([TAG_A, TAG_B, TAG_C], filter), false);
  assert.equal(rowMatchesTagFilter([TAG_A], filter), false);
  // Id repetido no filtro nao muda a cardinalidade esperada.
  assert.equal(rowMatchesTagFilter([TAG_A], value("has_exact", [TAG_A.id, TAG_A.id])), true);
});

test("sem tag / tem alguma tag dispensam valor", () => {
  assert.equal(rowMatchesTagFilter([], value("is_empty")), true);
  assert.equal(rowMatchesTagFilter(undefined, value("is_empty")), true);
  assert.equal(rowMatchesTagFilter([TAG_A], value("is_empty")), false);

  assert.equal(rowMatchesTagFilter([TAG_A], value("is_not_empty")), true);
  assert.equal(rowMatchesTagFilter([], value("is_not_empty")), false);

  // Restringem mesmo com a lista de tags vazia — o badge "Filtros (N)" precisa conta-los.
  assert.equal(isRestrictiveTagFilterValue(value("is_empty")), true);
  assert.equal(isRestrictiveTagFilterValue(value("is_not_empty")), true);
  assert.equal(isRestrictiveTagFilterValue(value("has_any", [TAG_A.id])), true);
});

test("valor antigo do sessionStorage (multi-select com sentinela) e convertido", () => {
  assert.deepEqual(normalizeTagFilterValue({ selectedStatuses: [TAG_A.id, "__sem_tag__"], totalOptions: 3 }), {
    operator: "has_any",
    tagIds: [TAG_A.id],
  });
  // So o sentinela marcado era exatamente a pergunta "sem tag".
  assert.deepEqual(normalizeTagFilterValue({ selectedStatuses: ["__sem_tag__"] }), { operator: "is_empty", tagIds: [] });
  assert.equal(rowMatchesTagFilter([], { selectedStatuses: ["__sem_tag__"] }), true);
  assert.equal(rowMatchesTagFilter([TAG_A], { selectedStatuses: ["__sem_tag__"] }), false);
});
