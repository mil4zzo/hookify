import assert from "node:assert/strict";
import test from "node:test";

import type { ValidationCondition } from "@/components/common/ValidationCriteriaBuilder";
import { applyGlobalLogic, evaluateValidationCriteria, resolveGlobalLogic } from "@/lib/utils/validateAdCriteria";

const metrics = { spend: 100, ctr: 0.5, campaign_name: "Black Friday" };

function cond(id: string, field: string, operator: string, value: string): ValidationCondition {
  return { id, type: "condition", field, operator, value };
}

/** spend 100 > 1000? nao. ctr 0.5 > 0.1? sim. Um passa, o outro nao. */
const UM_PASSA_UM_FALHA: ValidationCondition[] = [
  cond("a", "spend", "GREATER_THAN", "1000"),
  cond("b", "ctr", "GREATER_THAN", "0.1"),
];

test("criterio salvo sem `logic` continua sendo AND — nada muda para quem ja usava", () => {
  // Nenhuma versao do builder chegou a gravar `logic` no topo, entao TODO criterio
  // existente cai por aqui. Este teste e a garantia de retrocompatibilidade.
  assert.equal(resolveGlobalLogic(UM_PASSA_UM_FALHA), "AND");
  assert.equal(evaluateValidationCriteria(UM_PASSA_UM_FALHA, metrics), false);
});

test("OU gravado nos criterios passa a valer de fato (o bug)", () => {
  const comOu = applyGlobalLogic(UM_PASSA_UM_FALHA, "OR");
  assert.equal(resolveGlobalLogic(comOu), "OR");
  // Antes da correcao isto era `false`: os consumidores passavam "AND" fixo e a
  // escolha do usuario nunca chegava ao avaliador.
  assert.equal(evaluateValidationCriteria(comOu, metrics), true);
});

test("o operador sobrevive ao round-trip por JSON (e o que vai para o jsonb)", () => {
  const comOu = applyGlobalLogic(UM_PASSA_UM_FALHA, "OR");
  const doBanco = JSON.parse(JSON.stringify(comOu)) as ValidationCondition[];
  assert.equal(resolveGlobalLogic(doBanco), "OR");
  assert.equal(evaluateValidationCriteria(doBanco, metrics), true);
});

test("`validation_criteria` continua sendo um ARRAY — o onboarding depende disso", () => {
  // onboarding_service.py: `isinstance(criteria, list) and len(criteria) > 0`.
  // Guardar {logic, conditions} reabriria o onboarding de quem salvasse.
  const comOu = applyGlobalLogic(UM_PASSA_UM_FALHA, "OR");
  assert.ok(Array.isArray(comOu));
  assert.equal(comOu.length, 2);
});

test("o no 0 nunca carrega operador — nao tem antecessor", () => {
  const comOu = applyGlobalLogic(UM_PASSA_UM_FALHA, "OR");
  assert.equal("logic" in comOu[0], false);
  assert.equal(comOu[1].logic, "OR");

  // E volta a sair quando um no que tinha operador vira o primeiro da lista.
  const reordenado = applyGlobalLogic([comOu[1], comOu[0]], "OR");
  assert.equal("logic" in reordenado[0], false);
});

test("trocar de OU para E limpa o operador antigo de todos os nos", () => {
  const comOu = applyGlobalLogic(UM_PASSA_UM_FALHA, "OR");
  const voltouParaE = applyGlobalLogic(comOu, "AND");
  assert.equal(resolveGlobalLogic(voltouParaE), "AND");
  assert.equal(evaluateValidationCriteria(voltouParaE, metrics), false);
});

test("applyGlobalLogic preserva a identidade quando nada muda (nao suja o hasChanges)", () => {
  // O botao Salvar acende comparando com o estado original; recriar objetos a cada
  // render marcaria mudanca sem o usuario ter mexido em nada.
  const jaCarimbado = applyGlobalLogic(UM_PASSA_UM_FALHA, "AND");
  const denovo = applyGlobalLogic(jaCarimbado, "AND");
  assert.equal(denovo[0], jaCarimbado[0]);
  assert.equal(denovo[1], jaCarimbado[1]);
});

test("`groupLogic` do subgrupo e independente do operador de topo", () => {
  const arvore: ValidationCondition[] = [
    cond("a", "campaign_name", "CONTAIN", "Black"),
    {
      id: "g1",
      type: "group",
      groupLogic: "OR",
      conditions: [cond("b", "spend", "GREATER_THAN", "9999"), cond("c", "ctr", "GREATER_THAN", "0.1")],
    },
  ];
  // Topo AND: "contem Black" passa E (spend>9999 falha OU ctr>0.1 passa) -> o OR interno salva.
  assert.equal(evaluateValidationCriteria(arvore, metrics), true);

  const soFalhas: ValidationCondition[] = [
    arvore[0],
    { ...(arvore[1] as ValidationCondition), conditions: [cond("b", "spend", "GREATER_THAN", "9999")] },
  ];
  assert.equal(evaluateValidationCriteria(soFalhas, metrics), false);
});

test("operador explicito ainda sobrepoe o gravado (contrato do parametro opcional)", () => {
  const comOu = applyGlobalLogic(UM_PASSA_UM_FALHA, "OR");
  assert.equal(evaluateValidationCriteria(comOu, metrics, "AND"), false);
});

test("lista vazia ou invalida nao restringe nem quebra", () => {
  assert.equal(evaluateValidationCriteria([], metrics), true);
  assert.equal(resolveGlobalLogic(null), "AND");
  assert.equal(resolveGlobalLogic(undefined), "AND");
  assert.equal(resolveGlobalLogic([] as ValidationCondition[]), "AND");
});
