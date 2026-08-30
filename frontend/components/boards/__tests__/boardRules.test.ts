import assert from "node:assert/strict";
import test from "node:test";

import { countRuleConditions, filterRowsByRules, rowMatchesRules } from "@/lib/rules/evaluate";
import { getAvailableRuleFields, getRuleField, getRuleOperators, getDefaultRuleValue } from "@/lib/rules/fields";
import { normalizeRuleTree, type RuleTree } from "@/lib/rules/types";

const TAG_HOOK = { id: "tag-hook", name: "Hook Dor", color: "chart1" };
const TAG_TOPO = { id: "tag-topo", name: "Topo", color: "chart2" };

/** Linha no formato que o Manager entrega (mapRankingRow, agrupada por criativo). */
function row(overrides: Record<string, any> = {}) {
  return {
    group_key: "criativo-a",
    ad_name: "Criativo A",
    spend: 1000,
    impressions: 100000,
    clicks: 2000,
    inline_link_clicks: 1500,
    lpv: 900,
    plays: 50000,
    hook: 0.4,
    ctr: 0.02,
    conversions: { lead: 20 },
    tags: [] as Array<{ id: string; name: string; color: string }>,
    account_ids: ["act_1"],
    pack_ids: ["pack-1"],
    active_count: 3,
    meta_created_time: "2026-08-01T12:00:00+00:00",
    ...overrides,
  };
}

function rules(conditions: RuleTree["conditions"], logic: RuleTree["logic"] = "AND"): RuleTree {
  return { logic, conditions };
}

function condition(field: string, operator: string, value: any) {
  return { id: `c-${field}-${operator}`, type: "condition" as const, field, operator, value };
}

test("regra vazia nao restringe: o grupo mostra o recorte inteiro", () => {
  assert.equal(rowMatchesRules(row(), rules([])), true);
  assert.equal(rowMatchesRules(row(), normalizeRuleTree(null)), true);
});

test("percentual e comparado na escala digitada (30 = 30%), nao em razao", () => {
  // hook = 0.4 na linha, ou seja 40%. "> 30" tem de casar; "> 50" nao.
  assert.equal(rowMatchesRules(row(), rules([condition("hook", ">", "30")])), true);
  assert.equal(rowMatchesRules(row(), rules([condition("hook", ">", "50")])), false);
  // O bug que isso evita: se 30 fosse comparado cru contra 0.4, TUDO seria "menor
  // que 30" e o grupo com "hook > 30" viria sempre vazio.
  assert.equal(rowMatchesRules(row(), rules([condition("hook", "<", "30")])), false);
});

test("percentual abaixo de 1% nao e confundido com razao", () => {
  // A heuristica `valor > 1 ? valor/100 : valor` (usada em applyRowFilters para
  // linhas-filhas) erraria aqui: 0.5 ficaria como 0.5 e nunca casaria contra 0.004.
  const linha = row({ ctr: 0.004 }); // 0,4%
  assert.equal(rowMatchesRules(linha, rules([condition("ctr", "<", "0.5")])), true);
  assert.equal(rowMatchesRules(linha, rules([condition("ctr", ">", "0.5")])), false);
});

test("metrica derivada do actionType usa o tipo de conversao do filtro global", () => {
  // spend 1000 / 20 leads = CPR 50.
  const comActionType = rowMatchesRules(row(), rules([condition("cpr", "<", "60")]), { actionType: "lead" });
  assert.equal(comActionType, true);

  // Sem actionType nao existe resultado, logo nao existe CPR: a linha nao passa,
  // em vez de passar com um zero inventado (que leria como "custo zero").
  assert.equal(rowMatchesRules(row(), rules([condition("cpr", "<", "60")])), false);
});

test("condicao incompleta nao restringe, igual a um filtro em branco do Manager", () => {
  assert.equal(rowMatchesRules(row(), rules([condition("spend", ">", "")])), true);
  assert.equal(rowMatchesRules(row(), rules([condition("ad_name", "contains", "")])), true);
  assert.equal(rowMatchesRules(row(), rules([condition("meta_created_time", ">=", "")])), true);
  // Tag sem nenhuma escolhida: a pergunta ainda nao foi feita.
  assert.equal(rowMatchesRules(row(), rules([condition("tags", "has_any", [])])), true);
});

test("campo que sumiu do registry e ignorado, nao derruba o grupo inteiro", () => {
  assert.equal(rowMatchesRules(row(), rules([condition("metrica_extinta", ">", "10")])), true);
});

test("tags reusam os operadores do Manager e casam por id", () => {
  const marcado = row({ tags: [TAG_HOOK] });
  assert.equal(rowMatchesRules(marcado, rules([condition("tags", "has_any", [TAG_HOOK.id])])), true);
  assert.equal(rowMatchesRules(marcado, rules([condition("tags", "has_none", [TAG_HOOK.id])])), false);
  assert.equal(rowMatchesRules(marcado, rules([condition("tags", "has_all", [TAG_HOOK.id, TAG_TOPO.id])])), false);
  assert.equal(rowMatchesRules(row(), rules([condition("tags", "is_empty", [])])), true);
  assert.equal(rowMatchesRules(marcado, rules([condition("tags", "is_empty", [])])), false);
});

test("procedencia tem semantica ALGUM: criativo espalhado por varias contas casa", () => {
  const espalhado = row({ account_ids: ["act_1", "act_2"] });
  assert.equal(rowMatchesRules(espalhado, rules([condition("account_ids", "has_any", ["act_2"])])), true);
  assert.equal(rowMatchesRules(espalhado, rules([condition("account_ids", "has_none", ["act_2"])])), false);
  assert.equal(rowMatchesRules(espalhado, rules([condition("account_ids", "has_any", ["act_9"])])), false);
});

test("status le active_count, nao o status do representante", () => {
  // O representante pode estar pausado enquanto outras veiculacoes do mesmo
  // criativo seguem ativas — ler effective_status diria "pausado" e mentiria.
  const misto = row({ active_count: 2, effective_status: "PAUSED" });
  assert.equal(rowMatchesRules(misto, rules([condition("status", "is_active", null)])), true);
  assert.equal(rowMatchesRules(misto, rules([condition("status", "is_paused", null)])), false);

  const parado = row({ active_count: 0, effective_status: "PAUSED" });
  assert.equal(rowMatchesRules(parado, rules([condition("status", "is_paused", null)])), true);

  // Sem active_count (agrupamento que a RPC nao preenche), cai no representante.
  const semContagem = row({ active_count: null, effective_status: "ACTIVE" });
  assert.equal(rowMatchesRules(semContagem, rules([condition("status", "is_active", null)])), true);
});

test("criativo sem data de criacao sai do recorte temporal, nao entra por omissao", () => {
  const semData = row({ meta_created_time: null });
  assert.equal(rowMatchesRules(semData, rules([condition("meta_created_time", ">=", "2026-01-01")])), false);
  // E tambem nao passa no "antes de": ausencia nao e uma data, em nenhuma direcao.
  assert.equal(rowMatchesRules(semData, rules([condition("meta_created_time", "<=", "2026-12-31")])), false);

  const comData = row();
  assert.equal(rowMatchesRules(comData, rules([condition("meta_created_time", ">=", "2026-08-01")])), true);
  assert.equal(rowMatchesRules(comData, rules([condition("meta_created_time", "<", "2026-08-01")])), false);
});

test("AND e OR globais mudam o resultado", () => {
  const conditions = [condition("spend", ">", "5000"), condition("hook", ">", "30")];
  assert.equal(rowMatchesRules(row(), rules(conditions, "AND")), false);
  assert.equal(rowMatchesRules(row(), rules(conditions, "OR")), true);
});

test("subgrupo com logica propria: (A) E (B OU C)", () => {
  const tree = rules(
    [
      condition("spend", ">", "500"),
      {
        id: "g1",
        type: "group" as const,
        logic: "OR" as const,
        conditions: [condition("hook", ">", "90"), condition("ctr", ">", "1")],
      },
    ],
    "AND",
  );
  // spend 1000 > 500 passa; hook 40% > 90% nao passa; ctr 2% > 1% passa -> o OR interno salva
  assert.equal(rowMatchesRules(row(), tree), true);
  assert.equal(rowMatchesRules(row({ ctr: 0.001 }), tree), false);
});

test("subgrupo vazio nao restringe, nem em AND nem em OR", () => {
  const vazio = { id: "g0", type: "group" as const, logic: "AND" as const, conditions: [] };
  assert.equal(rowMatchesRules(row(), rules([vazio], "AND")), true);
  assert.equal(rowMatchesRules(row(), rules([condition("spend", ">", "99999"), vazio], "OR")), true);
});

test("grupos nao sao exclusivos: a mesma linha cai em regras que se sobrepoem", () => {
  const rows = [row({ group_key: "a", spend: 100 }), row({ group_key: "b", spend: 5000 })];
  const baratos = filterRowsByRules(rows, rules([condition("spend", "<", "1000")]));
  const todos = filterRowsByRules(rows, rules([condition("spend", ">", "0")]));
  assert.deepEqual(baratos.map((r) => r.group_key), ["a"]);
  assert.deepEqual(todos.map((r) => r.group_key), ["a", "b"]);
});

test("countRuleConditions conta folhas dentro de subgrupos", () => {
  const tree = rules([
    condition("spend", ">", "1"),
    {
      id: "g1",
      type: "group" as const,
      logic: "OR" as const,
      conditions: [condition("hook", ">", "1"), condition("ctr", ">", "1")],
    },
  ]);
  assert.equal(countRuleConditions(tree), 3);
  assert.equal(countRuleConditions(rules([])), 0);
});

test("normalizeRuleTree aceita jsonb sujo sem estourar", () => {
  assert.deepEqual(normalizeRuleTree(undefined), { logic: "AND", conditions: [] });
  assert.deepEqual(normalizeRuleTree([1, 2, 3]), { logic: "AND", conditions: [] });
  assert.deepEqual(normalizeRuleTree({ logic: "XOR", conditions: null }), { logic: "AND", conditions: [] });
  const sujo = normalizeRuleTree({ logic: "OR", conditions: [condition("spend", ">", "1"), { type: "lixo" }, null] });
  assert.equal(sujo.logic, "OR");
  assert.equal(sujo.conditions.length, 1);
});

test("registry: campo conhece o proprio tipo, operadores e valor inicial", () => {
  assert.equal(getRuleField("tags")?.kind, "tags");
  assert.equal(getRuleField("hook")?.isRatioPercent, true);
  // video_watched_p50 ja vive em 0-100 (rawPercent): nao pode ser dividido por 100.
  assert.equal(getRuleField("video_watched_p50")?.isRatioPercent, false);
  assert.equal(getRuleField("spend")?.isRatioPercent, false);

  assert.deepEqual(getDefaultRuleValue("tags"), []);
  assert.deepEqual(getDefaultRuleValue("pack_ids"), []);
  assert.equal(getDefaultRuleValue("spend"), "");

  assert.ok(getRuleOperators("status").some((op) => op.value === "is_active"));
  assert.ok(getRuleOperators("ad_name").some((op) => op.value === "contains"));
});

test("campanha e conjunto sao campos DECLARADOS mas ainda nao oferecidos", () => {
  // A decisao anterior era nao ter estes campos, porque o nome na linha vem do
  // REPRESENTANTE do grupo e mentiria para criativos que rodam em mais de uma
  // campanha. A decisao nova (2026-08-28) mantem o diagnostico e troca a saida:
  // em vez de nao existir, o campo passa a ler o ARRAY de ids da linha e resolver
  // os nomes pelo dicionario da resposta — semantica "alguma", como Pack e Conta.
  // Enquanto a RPC nao devolve esses dados (fase 5), ficam fora do seletor.
  for (const id of ["campaign_name", "adset_name", "campaign_ids", "adset_ids"]) {
    assert.ok(getRuleField(id), `${id} deveria estar declarado no registry`);
    assert.equal(getRuleField(id)?.pendingBackend, true, `${id} deveria estar marcado como pendente`);
  }

  const offered = getAvailableRuleFields({ hasSheetIntegration: true }).map((f) => f.id);
  for (const id of ["campaign_name", "adset_name", "campaign_ids", "adset_ids"]) {
    assert.ok(!offered.includes(id), `${id} nao pode aparecer no seletor antes da fase 5`);
  }
  // A garantia que importa: o que JA funciona continua oferecido.
  for (const id of ["ad_name", "tags", "status", "pack_ids", "account_ids", "hook", "cpr"]) {
    assert.ok(offered.includes(id), `${id} sumiu do seletor`);
  }
});
