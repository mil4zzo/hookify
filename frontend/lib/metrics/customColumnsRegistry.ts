/**
 * Registro das colunas vinculadas ATIVAS (migration 140).
 *
 * POR QUE UM REGISTRO MUTÁVEL
 *   As colunas vinculadas só existem em função dos packs SELECIONADOS: mudam em
 *   tempo de execução. Mas dezenas de consumidores perguntam por uma métrica pelo
 *   id, sem contexto nenhum — `getMetricNumericValueOrNull` (a única porta de
 *   leitura de métrica), o avaliador de regra, o funil do header, a ordenação do
 *   Board, o export. Em vez de enfiar um parâmetro novo em cada um, a tela que
 *   conhece os packs publica aqui a lista ativa e todo mundo lê pela mesma porta.
 *
 *   Componentes React NÃO devem depender só disto para re-renderizar: a lista
 *   também viaja por prop (`customColumns`) onde a reatividade importa.
 */
import type { CustomColumnDef } from "./customColumns";

let activeDefs: CustomColumnDef[] = [];
let activeByKey = new Map<string, CustomColumnDef>();
let activeVersion = 0;

/** Publica a lista ativa (a tela chama num efeito quando os packs selecionados mudam). */
export function setActiveCustomColumns(defs: ReadonlyArray<CustomColumnDef>): void {
  activeDefs = [...defs];
  activeByKey = new Map(activeDefs.map((def) => [def.key, def]));
  activeVersion += 1;
}

export function getActiveCustomColumns(): readonly CustomColumnDef[] {
  return activeDefs;
}

export function getActiveCustomColumn(key: string): CustomColumnDef | undefined {
  return activeByKey.get(key);
}

/** Muda a cada publicação — para memos que precisam reagir à lista ativa. */
export function getActiveCustomColumnsVersion(): number {
  return activeVersion;
}
