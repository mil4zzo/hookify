/**
 * Gerador da fixture de paridade da economia do lead (contrato TS × espelho Python).
 *
 * COMO RODAR (de dentro de frontend/):
 *
 *   npx tsx scripts/generate-lead-economics-fixture.ts
 *
 * Reescreve `lib/utils/__tests__/fixtures/lead_economics_validation_cases.json`.
 * Depois rode os dois lados da paridade:
 *
 *   npx tsx --test lib/utils/__tests__/leadEconomicsValidation.test.ts
 *   (em backend/) venv/Scripts/python -m pytest tests/test_lead_economics_validation.py
 *
 * POR QUE EXISTE
 *
 * A fixture é lida pelos dois validadores do cadastro (`validateLeadEconomics` em
 * lib/utils/leadEconomics.ts, o contrato, e `validate_lead_economics` em
 * backend/app/services/lead_economics.py, o espelho). Os `expected_*` são o que o
 * CONTRATO produz — nunca escritos à mão: este script roda o validador TS sobre cada
 * entrada e grava o resultado. Sem ele versionado, acrescentar um caso era editar
 * 3 600 linhas de JSON à mão ou recriar um script perdido, e um esperado digitado
 * errado viraria "regra" nos dois lados. Aqui mora só a lista de ENTRADAS; o teste
 * de frontend (leadEconomicsValidation.test.ts) confere que a fixture gravada é
 * exatamente o texto que este script gera (ninguém edita o JSON à mão sem o teste
 * acusar).
 *
 * Regenerar = o contrato decide. Se um esperado de caso ANTIGO mudar no diff do JSON,
 * é mudança de regra do contrato: o teste Python quebra até o espelho acompanhar.
 *
 * INTEIROS ACIMA DE 2^53: o FastAPI lê o corpo com `json.loads` (inteiro exato) e o
 * navegador com `JSON.parse` (o double mais próximo). O caso só prova alguma coisa se
 * o texto da fixture trouxer o literal EXATO — e um `number` do JS já nasce
 * arredondado. Por isso esses valores são `bigint` na lista abaixo e vão para o texto
 * dígito a dígito (marcador + troca no texto, ver `serializar`); o esperado é calculado
 * sobre o `JSON.parse` desse texto, como o navegador leria.
 *
 * CARACTERES INVISÍVEIS vão para o texto da fixture escapados (barra-u + 4 dígitos
 * hex: espaços exóticos, controles, BOM, larguras zero): o JSON lido é o mesmo, e quem
 * revisa o diff enxerga o que tem. Aqui no fonte eles saem de `cp(0x...)`, nunca
 * crus nem escapados: cru ninguém enxerga na revisão, e U+2028 cru dentro de uma
 * regex ou string quebra o parse do arquivo.
 *
 * Guardas (o script falha em vez de gravar): nome de caso repetido; caso "valido:" com
 * erro ou caso inválido sem erro; runtime que discorde da premissa dos casos de espaço
 * do JS; e entrada com um dos code points que mudaram de caixa no Unicode 16 — o
 * esperado dependeria da versão do runtime (ver a docstring do espelho Python).
 */
import { readFileSync, writeFileSync } from "fs";
import { join, relative } from "path";
import { validateLeadEconomics } from "../lib/utils/leadEconomics";

export const FIXTURE_PATH = join(
  __dirname,
  "..",
  "lib",
  "utils",
  "__tests__",
  "fixtures",
  "lead_economics_validation_cases.json",
);

interface CasoDeEntrada {
  name: string;
  input: unknown;
}

export interface CasoDaFixture extends CasoDeEntrada {
  expected_errors: string[];
  expected_value: unknown;
}

// ── Peças das entradas ───────────────────────────────────────────────────────

type Campos = Record<string, unknown>;

const MENTORIA: Campos = { id: "p1", name: "Mentoria", ticket: 3000, contribution_margin: 0.55, target_margin: 0.4 };
const FAIXA_UNICA: Campos = { min: null, product: "p1", conversion: 0.04 };

/** O produto padrão (Mentoria, id p1) com os campos trocados. Chave trocada mantém a posição. */
function produto(campos: Campos = {}): Campos {
  return { ...MENTORIA, ...campos };
}

/** A faixa padrão (sem piso, p1, 4%) com os campos trocados. */
function faixa(campos: Campos = {}): Campos {
  return { ...FAIXA_UNICA, ...campos };
}

/** Cópia sem a chave: campo AUSENTE, que não é o mesmo que null. */
function sem(objeto: Campos, chave: string): Campos {
  const copia = { ...objeto };
  delete copia[chave];
  return copia;
}

function cadastro(products: unknown = [produto()], bands: unknown = [faixa()]): Campos {
  return { products, bands };
}

/** "Produto 1".."Produto N", ids p1..pN. */
function produtosNumerados(quantidade: number): Campos[] {
  return Array.from({ length: quantidade }, (_, i) => produto({ id: `p${i + 1}`, name: `Produto ${i + 1}` }));
}

/** O caractere do code point (surrogate solto incluído). Ver "CARACTERES INVISÍVEIS" no topo. */
const cp = (codePoint: number) => String.fromCodePoint(codePoint);
const HEX = (codePoint: number) => codePoint.toString(16).toUpperCase().padStart(4, "0");

const EMOJI = cp(0x1f600); // 2 unidades UTF-16
const NUL = cp(0x00);

// Espaço do JS (`trim()` e `\s`): WhiteSpace + LineTerminator da spec — TAB, VT, FF,
// BOM, a categoria Zs e LF, CR, LS, PS. O espelho Python tem esta lista escrita à mão
// (`_JS_WHITESPACE`); um caso por code point prende as duas juntas.
const ESPACOS_DO_JS = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a,
  0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];
// Parecem espaço e não são: U+180E saiu de Zs no Unicode 6.3; U+200B e U+2060 são Cf.
const NAO_ESPACOS = [0x180e, 0x200b, 0x2060];

// Os code points que mudaram de caixa no Unicode 16 (os 27 que ganharam minúscula e
// os seus pares). `toLocaleLowerCase` do Node 22 (Unicode 16) e `str.lower` do Python
// 3.13 (Unicode 15.1) discordam neles: um caso com eles passaria ou falharia conforme
// o runtime, não conforme a regra.
const MUDARAM_DE_CAIXA_NO_UNICODE_16 = new Set<number>([
  0x1c89, 0x1c8a, 0xa7cb, 0x0264, 0xa7cc, 0xa7cd, 0xa7da, 0xa7db, 0xa7dc, 0x019b,
  ...Array.from({ length: 0x10d65 - 0x10d50 + 1 }, (_, i) => 0x10d50 + i),
  ...Array.from({ length: 0x10d85 - 0x10d70 + 1 }, (_, i) => 0x10d70 + i),
]);

// ── Os casos (só entradas; os esperados saem do validador) ───────────────────

const A40 = "a".repeat(40);
const A41 = "a".repeat(41);
const ID_39_MAIS_EMOJI = "a".repeat(39) + EMOJI;

const CASOS: CasoDeEntrada[] = [
  // Válidos
  { name: "valido: 1 produto, 1 faixa", input: cadastro() },
  {
    name: "valido: exemplo da secao 5 (2 produtos, 3 faixas)",
    input: cadastro(
      [produto(), produto({ id: "p2", name: "Ebook", ticket: 300, contribution_margin: 0.9 })],
      [faixa({ product: "p2", conversion: 0.005 }), faixa({ min: 60 }), faixa({ min: 80, conversion: 0.12 })],
    ),
  },
  {
    name: "valido: canonico apara id/nome, colapsa espacos e descarta chaves extras",
    input: {
      ...cadastro(
        [produto({ id: "  p1  ", name: "  Mentoria    Premium  ", cor: "azul" })],
        [faixa({ product: " p1 ", rotulo: "tudo" })],
      ),
      observacao: "chave desconhecida no topo",
    },
  },
  { name: "valido: primeira faixa sem a chave min", input: cadastro([produto()], [sem(faixa(), "min")]) },
  { name: "valido: id com 40 caracteres", input: cadastro([produto({ id: A40 })], [faixa({ product: A40 })]) },
  { name: "valido: nome com 60 caracteres", input: cadastro([produto({ name: "a".repeat(60) })]) },
  {
    name: `valido: nome com 60 unidades UTF-16 contando emoji (58 + ${EMOJI})`,
    input: cadastro([produto({ name: "a".repeat(58) + EMOJI })]),
  },
  {
    // BOM + NBSP + NBSP + em-space
    name: "valido: nome com BOM, NBSP e em-space vira 'Curso Online'",
    input: cadastro([produto({ name: `${cp(0xfeff)}Curso${cp(0xa0)}${cp(0xa0)}Online${cp(0x2003)}` })]),
  },
  {
    name: "valido: NEL (U+0085) nao e espaco no JS e fica no nome",
    input: cadastro([produto({ name: `Curso${cp(0x85)}Online` })]),
  },
  { name: "valido: NUL no meio do nome vira espaco", input: cadastro([produto({ name: `Mentoria${NUL}VIP` })]) },
  {
    // SOH, US, DEL, backspace
    name: "valido: controles C0 e DEL viram espaco e colapsam",
    input: cadastro([produto({ name: `${cp(0x01)}Mentoria${cp(0x1f)}${cp(0x7f)} VIP${cp(0x08)}` })]),
  },
  {
    name: "valido: surrogate alto solto no nome e removido",
    input: cadastro([produto({ name: `Mentoria${cp(0xd800)} VIP` })]),
  },
  {
    name: "valido: surrogate baixo solto no nome e removido",
    input: cadastro([produto({ name: `${cp(0xdc00)}Mentoria VIP` })]),
  },
  {
    name: "valido: emoji preservado ao lado de surrogate solto",
    input: cadastro([produto({ name: `Mentoria ${cp(0xd800)}${EMOJI}${cp(0xde00)}` })]),
  },
  {
    name: "valido: id com NUL vira espaco (e a faixa que o cita tambem)",
    input: cadastro([produto({ id: `p${NUL}1` })], [faixa({ product: `p${NUL}1` })]),
  },
  { name: "valido: contribution_margin 1", input: cadastro([produto({ contribution_margin: 1 })]) },
  { name: "valido: target_margin 0", input: cadastro([produto({ target_margin: 0 })]) },
  { name: "valido: ticket fracionario", input: cadastro([produto({ ticket: 49.9 })]) },
  {
    // bigint: vai EXATO para o texto; o esperado é o double que o JS lê.
    name: "valido: ticket inteiro enorme vira o double que o JS le",
    input: cadastro([produto({ ticket: 12345678901234567890n })]),
  },
  { name: "valido: conversion 0", input: cadastro([produto()], [faixa({ conversion: 0 })]) },
  { name: "valido: conversion 1", input: cadastro([produto()], [faixa({ conversion: 1 })]) },
  {
    name: "valido: cortes negativos e crescentes",
    input: cadastro([produto()], [faixa(), faixa({ min: -10 }), faixa({ min: -5 }), faixa({ min: 0 })]),
  },
  {
    name: "valido: cortes decimais crescentes",
    input: cadastro([produto()], [faixa(), faixa({ min: 59.5 }), faixa({ min: 60 })]),
  },
  {
    name: "valido: 10 produtos e 10 faixas (no limite)",
    input: cadastro(
      produtosNumerados(10),
      Array.from({ length: 10 }, (_, i) => faixa({ min: i === 0 ? null : i * 10, product: `p${i + 1}` })),
    ),
  },

  // Forma
  { name: "forma: null", input: null },
  { name: "forma: string", input: "abc" },
  { name: "forma: numero", input: 42 },
  { name: "forma: lista", input: [] },
  { name: "forma: sem products", input: { bands: [faixa()] } },
  { name: "forma: sem bands", input: { products: [produto()] } },
  { name: "forma: products nao e lista", input: { products: { p1: produto() }, bands: [faixa()] } },
  { name: "forma: bands e string", input: { products: [produto()], bands: "x" } },
  { name: "forma: produto que nao e objeto", input: cadastro(["p1", produto()]) },
  { name: "forma: faixa que nao e objeto no fim", input: cadastro([produto()], [faixa(), 5]) },
  {
    name: "forma: faixa que nao e objeto no inicio (a proxima ainda e a de indice 1)",
    input: cadastro([produto()], ["x", faixa({ min: 60 })]),
  },

  // Quantidades
  { name: "0 produtos", input: cadastro([], [faixa()]) },
  { name: "11 produtos", input: cadastro(produtosNumerados(11)) },
  { name: "0 faixas", input: cadastro([produto()], []) },
  {
    name: "11 faixas",
    input: cadastro([produto()], Array.from({ length: 11 }, (_, i) => faixa({ min: i === 0 ? null : i * 10 }))),
  },

  // Id do produto
  { name: "id vazio", input: cadastro([produto({ id: "" })], [faixa({ product: "" })]) },
  { name: "id so espacos", input: cadastro([produto({ id: "   " })]) },
  { name: "id so com NUL vira id vazio", input: cadastro([produto({ id: NUL })], [faixa({ product: NUL })]) },
  {
    name: "id so com surrogate solto vira id vazio",
    input: cadastro([produto({ id: cp(0xdfff) })], [faixa({ product: cp(0xdfff) })]),
  },
  { name: "id ausente", input: cadastro([sem(produto(), "id")]) },
  { name: "id numerico", input: cadastro([produto({ id: 1 })]) },
  { name: "id duplicado", input: cadastro([produto(), produto({ name: "Ebook" })]) },
  { name: "id duplicado depois de aparar", input: cadastro([produto(), produto({ id: " p1 ", name: "Ebook" })]) },
  { name: "id com 41 caracteres", input: cadastro([produto({ id: A41 })], [faixa({ product: A41 })]) },
  {
    name: `id com 41 unidades UTF-16 contando emoji (39 + ${EMOJI})`,
    input: cadastro([produto({ id: ID_39_MAIS_EMOJI })], [faixa({ product: ID_39_MAIS_EMOJI })]),
  },

  // Nome do produto
  { name: "nome vazio", input: cadastro([produto({ name: "" })]) },
  { name: "nome so espacos", input: cadastro([produto({ name: "   " })]) },
  { name: "nome ausente", input: cadastro([sem(produto(), "name")]) },
  { name: "nome so com NUL vira nome ausente", input: cadastro([produto({ name: NUL + NUL })]) },
  { name: "nome numerico", input: cadastro([produto({ name: 123 })]) },
  { name: "nome vazio usa 'produto N' nas outras mensagens", input: cadastro([produto({ name: "", ticket: 0 })]) },
  { name: "nome com 61 caracteres", input: cadastro([produto({ name: "a".repeat(61) })]) },
  {
    name: `nome com 61 unidades UTF-16 contando emoji (59 + ${EMOJI})`,
    input: cadastro([produto({ name: "a".repeat(59) + EMOJI })]),
  },
  {
    name: "nome longo ainda nomeia as outras mensagens",
    input: cadastro([produto({ name: "b".repeat(61), ticket: -1 })]),
  },
  {
    name: "nome duplicado ignorando caixa e espacos",
    input: cadastro([produto({ name: "Curso Online" }), produto({ id: "p2", name: "  curso   ONLINE " })]),
  },

  // Números do produto
  { name: "ticket 0", input: cadastro([produto({ ticket: 0 })]) },
  { name: "ticket negativo", input: cadastro([produto({ ticket: -3000 })]) },
  { name: "ticket string numerica", input: cadastro([produto({ ticket: "3000" })]) },
  { name: "ticket true", input: cadastro([produto({ ticket: true })]) },
  { name: "ticket null", input: cadastro([produto({ ticket: null })]) },
  { name: "ticket ausente", input: cadastro([sem(produto(), "ticket")]) },
  { name: "contribution_margin 0", input: cadastro([produto({ contribution_margin: 0 })]) },
  { name: "contribution_margin 1.01", input: cadastro([produto({ contribution_margin: 1.01 })]) },
  { name: "contribution_margin true", input: cadastro([produto({ contribution_margin: true })]) },
  { name: "target_margin 1", input: cadastro([produto({ target_margin: 1 })]) },
  { name: "target_margin -0.01", input: cadastro([produto({ target_margin: -0.01 })]) },
  { name: "target_margin string", input: cadastro([produto({ target_margin: "0.4" })]) },
  { name: "target_margin true", input: cadastro([produto({ target_margin: true })]) },
  { name: "target_margin false", input: cadastro([produto({ target_margin: false })]) },
  {
    name: "target igual a contribution",
    input: cadastro([produto({ contribution_margin: 0.5, target_margin: 0.5 })]),
  },
  {
    name: "target maior que contribution",
    input: cadastro([produto({ contribution_margin: 0.5, target_margin: 0.6 })]),
  },
  {
    name: "target e contribution invalidos nao geram a mensagem de comparacao",
    input: cadastro([produto({ contribution_margin: 0, target_margin: 1 })]),
  },

  // Notas de corte
  { name: "primeira faixa com min", input: cadastro([produto()], [faixa({ min: 10 })]) },
  { name: "primeira faixa com min 0", input: cadastro([produto()], [faixa({ min: 0 })]) },
  { name: "primeira faixa com min false", input: cadastro([produto()], [faixa({ min: false })]) },
  { name: "primeira faixa com min true", input: cadastro([produto()], [faixa({ min: true })]) },
  {
    name: "primeira faixa com min nao entra na ordem dos cortes",
    input: cadastro([produto()], [faixa({ min: 100 }), faixa({ min: 50 })]),
  },
  { name: "faixa sem min (chave ausente)", input: cadastro([produto()], [faixa(), sem(faixa(), "min")]) },
  { name: "faixa com min null", input: cadastro([produto()], [faixa(), faixa()]) },
  { name: "faixa com min string", input: cadastro([produto()], [faixa(), faixa({ min: "60" })]) },
  { name: "faixa com min true", input: cadastro([produto()], [faixa(), faixa({ min: true })]) },
  {
    name: "faixa com min true depois de corte 0",
    input: cadastro([produto()], [faixa(), faixa({ min: 0 }), faixa({ min: true })]),
  },
  { name: "min repetida", input: cadastro([produto()], [faixa(), faixa({ min: 60 }), faixa({ min: 60 })]) },
  { name: "min decrescente", input: cadastro([produto()], [faixa(), faixa({ min: 80 }), faixa({ min: 60 })]) },
  {
    // 2^53 e 2^53 + 1: o Python compara exato ("crescentes"), o JS lê os dois como 2^53.
    name: "min inteira acima de 2^53 que o JS le igual a anterior",
    input: cadastro([produto()], [faixa(), faixa({ min: 9007199254740992n }), faixa({ min: 9007199254740993n })]),
  },
  {
    name: "min intermediaria invalida nao apaga o ultimo corte valido (60, x, 50)",
    input: cadastro([produto()], [faixa(), faixa({ min: 60 }), faixa({ min: "x" }), faixa({ min: 50 })]),
  },
  {
    name: "min intermediaria invalida seguida de corte maior (60, null, 70)",
    input: cadastro([produto()], [faixa(), faixa({ min: 60 }), faixa({ min: null }), faixa({ min: 70 })]),
  },

  // Referência da faixa
  { name: "produto inexistente na faixa", input: cadastro([produto()], [faixa({ product: "p9" })]) },
  { name: "produto da faixa ausente", input: cadastro([produto()], [sem(faixa(), "product")]) },
  { name: "produto da faixa numerico", input: cadastro([produto({ id: "1" })], [faixa({ product: 1 })]) },
  {
    name: "faixa aponta para o id duplicado: o id vale pelo primeiro produto",
    input: cadastro([produto(), produto({ name: "Ebook" })], [faixa(), faixa({ min: 60 })]),
  },

  // Conversão
  { name: "conversion -0.01", input: cadastro([produto()], [faixa({ conversion: -0.01 })]) },
  { name: "conversion 1.01", input: cadastro([produto()], [faixa({ conversion: 1.01 })]) },
  { name: "conversion string", input: cadastro([produto()], [faixa({ conversion: "0.04" })]) },
  { name: "conversion null", input: cadastro([produto()], [faixa({ conversion: null })]) },
  { name: "conversion true", input: cadastro([produto()], [faixa({ conversion: true })]) },
  { name: "conversion false", input: cadastro([produto()], [faixa({ conversion: false })]) },

  // Vários erros e dedupe
  {
    name: "varios erros ao mesmo tempo (ordem importa)",
    input: cadastro(
      [produto({ id: "", name: "", ticket: 0, contribution_margin: 0, target_margin: 1 })],
      [faixa({ min: 5, product: "x", conversion: 2 }), sem(faixa({ product: "x", conversion: -1 }), "min")],
    ),
  },
  {
    name: "varios erros: produto e faixas misturados, ordem por item",
    input: cadastro(
      [produto({ ticket: -1 }), produto({ id: "p2", name: "Ebook", contribution_margin: 0.9, target_margin: 0.95 })],
      [faixa({ conversion: 1.5 }), faixa({ min: 60, product: "p3" }), faixa({ min: 40, product: "p2" })],
    ),
  },
  {
    name: "dedupe: dois produtos com o mesmo nome e ticket invalido",
    input: cadastro([produto({ name: "Ebook", ticket: 0 }), produto({ id: "p2", name: "Ebook", ticket: 0 })]),
  },
  {
    name: "dedupe: dois produtos sem nome geram 'produto 1' e 'produto 2' distintos",
    input: cadastro([produto({ name: "", ticket: 0 }), produto({ id: "p2", name: "", ticket: 0 })]),
  },
  {
    name: "dedupe: tres nomes identicos geram uma mensagem so",
    input: cadastro([
      produto({ name: "Ebook" }),
      produto({ id: "p2", name: "Ebook" }),
      produto({ id: "p3", name: "Ebook" }),
    ]),
  },
  {
    name: "dedupe e por texto exato: tres grafias do mesmo nome geram uma mensagem por grafia repetida",
    input: cadastro([
      produto({ name: "Ebook" }),
      produto({ id: "p2", name: "ebook" }),
      produto({ id: "p3", name: "EBOOK" }),
    ]),
  },
  {
    name: "dedupe: duas faixas com conversao invalida",
    input: cadastro([produto()], [faixa({ conversion: 2 }), faixa({ min: 60, conversion: -1 })]),
  },

  // ── Acrescentados junto com o gerador ──

  // Um caso por espaço do JS: no meio do nome (colapsa em " ") e em volta do id e da
  // referência da faixa (aparados). U+0009–U+000D são controle C0: a limpeza já os
  // troca por espaço antes do trim — o caso prende a limpeza + o colapso.
  ...ESPACOS_DO_JS.map((codePoint): CasoDeEntrada => {
    const espaco = cp(codePoint);
    const c0 = codePoint < 0x20 ? " (controle C0: a limpeza ja o troca por espaco)" : "";
    return {
      name: `valido: espaco do JS U+${HEX(codePoint)} no meio do nome e em volta do id e da faixa${c0}`,
      input: cadastro(
        [produto({ id: `${espaco}p1${espaco}`, name: `A${espaco}B` })],
        [faixa({ product: `${espaco}p1${espaco}` })],
      ),
    };
  }),
  // O contrário: parecem espaço, não são — ficam no nome e no id, na borda e no meio.
  ...NAO_ESPACOS.map((codePoint): CasoDeEntrada => {
    const naoEspaco = cp(codePoint);
    return {
      name: `valido: U+${HEX(codePoint)} nao e espaco no JS e fica no nome e no id`,
      input: cadastro(
        [produto({ id: `${naoEspaco}p1${naoEspaco}`, name: `${naoEspaco}A${naoEspaco}B${naoEspaco}` })],
        [faixa({ product: `${naoEspaco}p1${naoEspaco}` })],
      ),
    };
  }),

  // Objeto vazio no lugar da lista: aceitar dict viraria "0 faixas"/"0 produtos". Nas
  // faixas um dict CHEIO não pegaria: iterar as chaves dá string, e faixa string já é
  // "formato inválido" — a mesma mensagem que o caso espera.
  { name: "forma: bands objeto vazio ({}) nao vira 0 faixas", input: { products: [produto()], bands: {} } },
  { name: "forma: products objeto vazio ({}) nao vira 0 produtos", input: { products: {}, bands: [faixa()] } },

  {
    // Espelho do caso de 2^53 acima: -2^53 - 1 o JS lê como -2^53. Pega quem compare
    // `raw > 2^53` em vez de `abs(raw) > 2^53`.
    name: "min inteira abaixo de -2^53 que o JS le igual a seguinte",
    input: cadastro([produto()], [faixa(), faixa({ min: -9007199254740993n }), faixa({ min: -9007199254740992n })]),
  },

  // Chave de nome: lower(), não casefold(). O contrato usa `toLocaleLowerCase`, que não
  // dobra ß em ss nem ς em σ; casefold() dobraria e acusaria nome duplicado onde a
  // tela aceita. Sigma final (Σ no fim da palavra → ς) os dois lados aplicam.
  {
    name: "valido: 'STRASSE' e 'straße' sao nomes distintos (lower, nao casefold)",
    input: cadastro([produto({ name: "STRASSE" }), produto({ id: "p2", name: "straße" })]),
  },
  {
    // ΟΔΟΣ → "οδος" (ς final); "οδοσ" termina em σ medial. casefold daria "οδοσ" aos dois.
    name: "valido: 'ΟΔΟΣ' e 'οδοσ' sao nomes distintos (sigma final: lower da 'οδος')",
    input: cadastro([produto({ name: "ΟΔΟΣ" }), produto({ id: "p2", name: "οδοσ" })]),
  },
  {
    name: "nome duplicado com sigma final: 'ΟΔΟΣ' e 'οδος' viram 'οδος' nos dois lados",
    input: cadastro([produto({ name: "ΟΔΟΣ" }), produto({ id: "p2", name: "οδος" })]),
  },

  {
    // O canônico devolve o número lido, sem arredondar (uma troca por round(x, 6) no
    // espelho passaria em todos os outros casos).
    name: "valido: ticket e conversion com 15+ digitos significativos saem sem arredondar",
    input: cadastro(
      [produto({ ticket: 1234.5678901234567, contribution_margin: 0.987654321098765, target_margin: 0.123456789012345 })],
      [faixa({ conversion: 0.123456789012345 })],
    ),
  },
];

// ── Serialização ─────────────────────────────────────────────────────────────

// Marcador do bigint no texto intermediário: `JSON.stringify` não aceita bigint, então
// ele vira esta string e a string (com as aspas) é trocada pelos dígitos logo depois.
const MARCADOR_INTEIRO = "@@inteiro-exato@@";
const MARCADOR_NO_TEXTO = new RegExp(`"${MARCADOR_INTEIRO}(-?[0-9]+)"`, "g");

// Invisíveis ou ambíguos na tela, escapados no texto: DEL e C1, NBSP, hífen suave,
// espaços Zs, larguras zero, marcas de direção, separadores de linha/parágrafo, BOM.
// (C0 e surrogate solto o próprio `JSON.stringify` já escapa.)
const INVISIVEIS: ReadonlyArray<readonly [number, number]> = [
  [0x7f, 0xa0],
  [0xad, 0xad],
  [0x1680, 0x1680],
  [0x180e, 0x180e],
  [0x2000, 0x200f],
  [0x2028, 0x202f],
  [0x205f, 0x206f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
];

function escaparSeInvisivel(ch: string): string {
  const codigo = ch.charCodeAt(0);
  const invisivel = INVISIVEIS.some(([de, ate]) => codigo >= de && codigo <= ate);
  return invisivel ? "\\u" + codigo.toString(16).padStart(4, "0") : ch;
}

function serializar(valor: unknown, indentacao?: number): string {
  const texto = JSON.stringify(
    valor,
    (_chave, v: unknown) => (typeof v === "bigint" ? `${MARCADOR_INTEIRO}${v.toString()}` : v),
    indentacao,
  );
  // Fora do ASCII imprimível (espaço a til) só se escapa o que for invisível; letra
  // acentuada, grego e emoji ficam como estão. Sem a flag `u`: anda por unidade UTF-16.
  return texto.replace(MARCADOR_NO_TEXTO, "$1").replace(/[^ -~]/g, escaparSeInvisivel);
}

// ── Guardas ──────────────────────────────────────────────────────────────────

function* textosDa(valor: unknown): Generator<string> {
  if (typeof valor === "string") {
    yield valor;
  } else if (Array.isArray(valor)) {
    for (const item of valor) yield* textosDa(item);
  } else if (valor !== null && typeof valor === "object") {
    for (const [chave, item] of Object.entries(valor)) {
      yield chave;
      yield* textosDa(item);
    }
  }
}

function conferirPremissas(): void {
  for (const codePoint of ESPACOS_DO_JS) {
    const ch = cp(codePoint);
    if (!/^\s$/.test(ch) || ch.trim() !== "") {
      throw new Error(`este runtime não trata U+${HEX(codePoint)} como espaço do JS — a lista do caso está errada`);
    }
  }
  for (const codePoint of NAO_ESPACOS) {
    const ch = cp(codePoint);
    if (/\s/.test(ch) || ch.trim() === "") {
      throw new Error(`este runtime trata U+${HEX(codePoint)} como espaço — o caso "não é espaço" não vale aqui`);
    }
  }
}

function conferirCaso(caso: CasoDaFixture): void {
  for (const texto of textosDa(caso.input)) {
    if (texto.includes(MARCADOR_INTEIRO)) {
      throw new Error(`${caso.name}: a entrada contém o marcador de inteiro exato`);
    }
    for (const ch of texto) {
      const codePoint = ch.codePointAt(0) ?? 0;
      if (MUDARAM_DE_CAIXA_NO_UNICODE_16.has(codePoint)) {
        throw new Error(`${caso.name}: U+${HEX(codePoint)} mudou de caixa no Unicode 16 — o esperado dependeria do runtime`);
      }
    }
  }
  const valido = caso.expected_errors.length === 0;
  if (caso.name.startsWith("valido:") !== valido) {
    throw new Error(
      `${caso.name}: o nome diz ${caso.name.startsWith("valido:") ? "válido" : "inválido"}, o contrato ` +
        `diz ${valido ? "válido" : JSON.stringify(caso.expected_errors)}`,
    );
  }
}

// ── Geração ──────────────────────────────────────────────────────────────────

export function buildFixtureCases(): CasoDaFixture[] {
  conferirPremissas();
  const nomes = new Set<string>();
  return CASOS.map(({ name, input }) => {
    if (nomes.has(name)) throw new Error(`nome de caso repetido: ${name}`);
    nomes.add(name);
    // O esperado é calculado sobre o que o NAVEGADOR leria deste texto (bigint vira
    // o double mais próximo), e não sobre o objeto em memória.
    const comoONavegadorLe: unknown = JSON.parse(serializar(input));
    const { value, errors } = validateLeadEconomics(comoONavegadorLe);
    const caso: CasoDaFixture = { name, input, expected_errors: errors, expected_value: value };
    conferirCaso(caso);
    return caso;
  });
}

/** O texto exato da fixture (LF, 2 espaços, newline no fim). */
export function buildFixtureText(): string {
  return serializar(buildFixtureCases(), 2) + "\n";
}

if (require.main === module) {
  const texto = buildFixtureText();
  writeFileSync(FIXTURE_PATH, texto, "utf8");
  // Relê o que foi gravado: escrita que falhe no meio não passa por sucesso.
  if (readFileSync(FIXTURE_PATH, "utf8") !== texto) {
    throw new Error("a fixture gravada não bate com o texto gerado");
  }
  const casos = JSON.parse(texto) as CasoDaFixture[];
  const validos = casos.filter((caso) => caso.expected_value !== null).length;
  console.log(
    `${casos.length} casos (${validos} válidos, ${casos.length - validos} inválidos), ` +
      `${texto.length} caracteres → ${relative(process.cwd(), FIXTURE_PATH)}`,
  );
}
