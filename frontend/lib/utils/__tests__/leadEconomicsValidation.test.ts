import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LEAD_ECONOMICS_MESSAGES as M, validateLeadEconomics } from "../leadEconomics";
import { buildFixtureText, FIXTURE_PATH } from "../../../scripts/generate-lead-economics-fixture";

/**
 * Paridade do validador da economia do lead: contrato TS × backend Python.
 *
 * A fixture (`fixtures/lead_economics_validation_cases.json`, ao lado deste teste)
 * é lida pelos DOIS lados: `backend/tests/test_lead_economics_validation.py` roda
 * o espelho Python sobre os mesmos casos. Mudar uma regra ou uma mensagem de um
 * lado sem o outro quebra um dos dois testes. Mora em `__tests__/fixtures/`
 * porque o .gitignore ignora `*.json` fora desse padrão — em
 * `backend/tests/fixtures/` ela não seria versionada (mesmo arranjo da fixture
 * `manager_columns_v161.json`).
 *
 * Os casos são GERADOS rodando este validador, pelo gerador versionado
 * `frontend/scripts/generate-lead-economics-fixture.ts` (a lista de entradas mora
 * lá; para acrescentar um caso, edite a lista e rode, de frontend/,
 * `npx tsx scripts/generate-lead-economics-fixture.ts`). O Python tem de bater com
 * eles. Sem a fixture o teste FALHA (não pula): um teste de paridade que some em
 * silêncio deixaria as duas validações divergirem sem ninguém ver.
 *
 * O `JSON.parse` daqui lê a fixture como o navegador lê a resposta da API: há
 * inputs com inteiros acima de 2^53 (e abaixo de -2^53) escritos EXATOS no texto,
 * que o JS arredonda e o Python não. Regenerar a fixture com `JSON.parse` +
 * `JSON.stringify` apagaria a diferença — o gerador escreve esses literais como
 * bigint, e o teste Python (test_fixture_preserva_inteiro_acima_de_2_53) acusa se
 * eles sumirem.
 *
 * Sabotagens feitas: tirar um caso da lista do gerador sem regenerar → "a fixture
 * gravada é exatamente o texto..." falha; gravar no lugar a fixture antiga de 108
 * casos → o piso de casos falha aqui e no Python.
 */

interface ValidationCase {
  name: string;
  input: unknown;
  expected_errors: string[];
  expected_value: unknown;
}

const FIXTURE = join(__dirname, "fixtures", "lead_economics_validation_cases.json");

function loadCases(): ValidationCase[] {
  const cases = JSON.parse(readFileSync(FIXTURE, "utf8")) as ValidationCase[];
  assert.ok(Array.isArray(cases), "a fixture de paridade precisa ser uma lista de casos");
  return cases;
}

test("a fixture de paridade existe e tem casos válidos e inválidos", () => {
  const cases = loadCases();
  // Piso = total atual (143 casos, 55 válidos) menos uma folga pequena: uma
  // regeneração que perca um bloco de casos falha aqui, não passa "verde".
  assert.ok(cases.length >= 140, `fixture truncada: ${cases.length} casos`);
  const validCount = cases.filter((c) => c.expected_value !== null).length;
  assert.ok(validCount >= 50, `fixture com poucos casos válidos: ${validCount}`);
  assert.equal(new Set(cases.map((c) => c.name)).size, cases.length, "nome de caso repetido");
});

test("a fixture gravada é exatamente o texto que o gerador versionado produz", () => {
  // O gerador é a fonte: um caso editado ou acrescentado à mão no JSON sumiria em
  // silêncio na próxima regeneração, e um caso tirado da lista sem regenerar deixaria
  // a fixture provando algo que o gerador já não descreve.
  assert.equal(resolve(FIXTURE_PATH), resolve(FIXTURE));
  // CRLF → LF: com core.autocrlf o checkout no Windows troca o fim de linha do JSON.
  const gravada = readFileSync(FIXTURE, "utf8").split("\r\n").join("\n");
  assert.ok(
    gravada === buildFixtureText(),
    "fixture desatualizada: rode `npx tsx scripts/generate-lead-economics-fixture.ts` em frontend/",
  );
});

test("validateLeadEconomics produz exatamente o que a fixture compartilhada espera", () => {
  const failures: string[] = [];
  for (const c of loadCases()) {
    const { value, errors } = validateLeadEconomics(c.input);
    try {
      assert.deepEqual(errors, c.expected_errors);
      assert.deepEqual(value, c.expected_value);
    } catch (error) {
      failures.push(`${c.name}: ${(error as Error).message}`);
    }
  }
  assert.deepEqual(failures, []);
});

test("20 mil produtos sem nome validam em menos de 2 s, com a mesma saída da dedupe por lista", () => {
  // Produto sem nome gera mensagens ÚNICAS ("produto 1", "produto 2"…): com
  // `errors.includes` eram 60 mil buscas lineares, e a tela travava ao colar lixo.
  const raw = { products: Array.from({ length: 20_000 }, () => ({})), bands: [] };
  const start = performance.now();
  const { value, errors } = validateLeadEconomics(raw);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 2000, `validador levou ${Math.round(elapsed)} ms com 20 mil produtos`);
  assert.equal(value, null);
  assert.deepEqual(errors.slice(0, 4), [
    M.tooManyProducts,
    M.invalidShape,
    M.productNameMissing,
    M.ticket("produto 1"),
  ]);
  assert.equal(errors[errors.length - 1], M.noBands);
  assert.equal(errors.length, 3 + 3 * 20_000 + 1);
  assert.equal(new Set(errors).size, errors.length);
});
