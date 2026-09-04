/**
 * As opções dos campos de multi-seleção da regra (Pack, Conta, Campanha, Conjunto) —
 * montadas num lugar só.
 *
 * POR QUE ISTO EXISTE
 *   Um campo de multi-seleção só serve para alguma coisa se a tela conseguir montar a
 *   LISTA. Sem lista, o seletor abre com "nada disponível no recorte atual" e o campo
 *   vira opção de menu que não funciona — o mesmo campo morto que o Critério de
 *   validação tinha aos montes até 2026-08.
 *
 *   E foi exatamente o que aconteceu: a visão expandida do Manager passou a oferecer
 *   Pack e Conta (que é o que o dado permite desde a migration 134) e ninguém lhe
 *   passou as opções. O campo estava lá, o dado estava lá, e o seletor abria vazio.
 *   Três telas montavam essa lista, cada uma do seu jeito, e a quarta esqueceu.
 *
 * DE ONDE SAI CADA LISTA
 *   Sempre das LINHAS que estão na tela — nunca do universo. Oferecer um pack que não
 *   está no recorte produz um filtro que zera a tabela e parece bug do filtro.
 *   A exceção é o Critério de validação, que vive nas Configurações e não tem recorte
 *   nenhum: lá as opções vêm da sessão do cliente (ver `ValidationCriteriaEditor`), e
 *   por isso campanha e conjunto não são oferecidos ali — não há fonte equivalente.
 */

import type { RuleDimensionOption } from "@/components/rules/RuleBuilder";
import { getActiveCustomColumns } from "@/lib/metrics/customColumnsRegistry";
import type { RuleNameDictionary } from "./evaluate";

/**
 * `ad_accounts.id` guarda o prefixo `act_`; partes do backend o removem. O índice de
 * nomes é chaveado SEM o prefixo — consultar com ele erra o nome em silêncio e a
 * opção aparece rotulada com o id cru. Era o que o Manager fazia.
 */
const semPrefixoAct = (id: unknown): string => String(id ?? "").replace(/^act_/, "");

export interface RuleDimensionSources {
  /** id → nome dos packs (sessão do cliente, via `useProvenanceIndex`). */
  packNameById?: ReadonlyMap<string, string>;
  /** id SEM `act_` → nome da conta. */
  accountNameById?: ReadonlyMap<string, string>;
  /** Dicionário de campanhas/conjuntos que vem na raiz da resposta (migration 136/137). */
  names?: RuleNameDictionary;
}

/** Campos de multi-seleção conhecidos, na ordem em que aparecem no seletor. */
const RULE_DIMENSION_FIELDS = ["pack_ids", "account_ids", "campaign_ids", "adset_ids"] as const;
type RuleDimensionField = (typeof RULE_DIMENSION_FIELDS)[number];

export type RuleDimensionOptions = Partial<Record<string, RuleDimensionOption[]>>;

function ordenar(options: RuleDimensionOption[]): RuleDimensionOption[] {
  return options.sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

/**
 * Lê os ids que a linha carrega para uma dimensão.
 *
 * A linha AGREGADA traz a lista (`account_ids`: o criativo roda em várias contas); a
 * linha-FILHA é UM anúncio e traz o valor único (`account_id`, exato). A pergunta do
 * usuário é a mesma, então as duas formas alimentam a mesma lista de opções.
 */
function idsDaLinha(row: Record<string, any>, field: RuleDimensionField): string[] {
  const lista = row[field];
  if (Array.isArray(lista)) return lista.map((id) => String(id ?? "")).filter(Boolean);
  const unico = row[field.replace(/_ids$/, "_id")];
  return unico ? [String(unico)] : [];
}

/**
 * Opções de Pack, Conta, Campanha e Conjunto presentes nas linhas dadas.
 *
 * Um id sem nome conhecido aparece pelo próprio id: uma opção rotulada com o número é
 * ruim, mas uma opção FALTANDO é pior — o usuário procura o que viu na tabela e não
 * acha, sem nada explicando por quê.
 */
export function buildRuleDimensionOptions(
  rows: readonly Record<string, any>[],
  sources: RuleDimensionSources = {},
): RuleDimensionOptions {
  const packs = new Map<string, string>();
  const accounts = new Map<string, string>();
  const campaigns = new Map<string, string>();
  const adsets = new Map<string, string>();

  for (const row of rows) {
    for (const id of idsDaLinha(row, "pack_ids")) {
      if (!packs.has(id)) packs.set(id, sources.packNameById?.get(id) ?? id);
    }
    for (const id of idsDaLinha(row, "account_ids")) {
      if (!accounts.has(id)) accounts.set(id, sources.accountNameById?.get(semPrefixoAct(id)) ?? id);
    }
    for (const id of idsDaLinha(row, "campaign_ids")) {
      if (!campaigns.has(id)) campaigns.set(id, sources.names?.campaigns?.[id] ?? id);
    }
    for (const id of idsDaLinha(row, "adset_ids")) {
      if (!adsets.has(id)) adsets.set(id, sources.names?.adsets?.[id] ?? id);
    }
  }

  const toOptions = (m: Map<string, string>) => ordenar(Array.from(m, ([value, label]) => ({ value, label })));
  const out: RuleDimensionOptions = {
    pack_ids: toOptions(packs),
    account_ids: toOptions(accounts),
    campaign_ids: toOptions(campaigns),
    adset_ids: toOptions(adsets),
  };

  // 140: colunas de CATEGORIA da planilha. As opções são todas as respostas vistas nos
  // histogramas das linhas na tela — a pergunta é "a resposta majoritária é X", e X
  // precisa existir no recorte para a lista não abrir vazia.
  for (const def of getActiveCustomColumns()) {
    if (def.facet !== "top") continue;
    const answers = new Set<string>();
    for (const row of rows) {
      const hist = row?.custom_histograms?.[def.mappingId];
      if (!hist || typeof hist !== "object") continue;
      for (const [value, qty] of Object.entries(hist as Record<string, unknown>)) {
        if (Number(qty) > 0) answers.add(value);
      }
    }
    out[def.key] = ordenar(Array.from(answers, (value) => ({ value, label: value })));
  }
  return out;
}
