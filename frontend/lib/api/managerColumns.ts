/**
 * Formato em COLUNAS da resposta do Manager (migration 161).
 *
 * POR QUE
 * -------
 * A resposta tinha um objeto por linha, com os mesmos ~50 nomes de campo repetidos
 * em todas. Com uma lista por campo, a mesma resposta (10 mil linhas reais, medido
 * em 16/09) cai de 1,98 MB para 1,08 MB na rede e de 16 para 9 MB gravada no
 * IndexedDB. O navegador NÃO ganha lendo colunas — o Chrome lê linhas muito bem —,
 * então a regra é: colunas para trafegar e para gravar; linhas para usar. Este
 * arquivo é o único ponto que converte, nos dois sentidos.
 *
 * O FORMATO (igual ao do backend, `app/services/manager_columns.py`)
 * ------------------------------------------------------------------
 *   { data_columns: [ { campo: valores[] }, ... ], row_count: N, ...topo }
 * `data_columns` é uma lista de blocos porque o Postgres limita 50 campos por
 * `json_build_object`. A linha i é a união de `bloco[campo][i]` de todos os blocos.
 *
 * `row_order[i]` é a POSIÇÃO final da linha i. O banco entrega as listas numa ordem
 * qualquer — ordenar as linhas largas lá custava 75–80 MB em disco por requisição
 * (medido, 16/09) — e este leitor as põe na ordem. Sem `row_order`, a ordem das
 * listas já é a final (é o que a gravação no IndexedDB produz).
 */

export interface ColumnarPayload {
  data_columns: Array<Record<string, unknown[] | null>>
  row_count: number
  row_order?: number[] | null
  [key: string]: unknown
}

export class ColumnarPayloadError extends Error {}

export function isColumnarPayload(value: unknown): value is ColumnarPayload {
  return (
    typeof value === 'object'
    && value !== null
    && 'data_columns' in value
    && 'row_count' in value
  )
}

/**
 * Colunas → linhas. Falha ALTO em coluna desalinhada: um campo deslocado casaria o
 * gasto de um anúncio com o nome de outro, sem erro nenhum na tela.
 */
export function rowsFromColumns(payload: ColumnarPayload): Array<Record<string, unknown>> {
  const n = payload.row_count
  if (!Number.isInteger(n) || n < 0) {
    throw new ColumnarPayloadError(`row_count inválido: ${String(n)}`)
  }
  if (n === 0) return []
  const blocos = payload.data_columns
  if (!Array.isArray(blocos) || blocos.length === 0) {
    throw new ColumnarPayloadError('data_columns ausente com row_count > 0')
  }

  const nomes: string[] = []
  const colunas: unknown[][] = []
  const vistos = new Set<string>()
  for (const bloco of blocos) {
    if (typeof bloco !== 'object' || bloco === null) {
      throw new ColumnarPayloadError('bloco de data_columns não é objeto')
    }
    for (const nome of Object.keys(bloco)) {
      const valores = bloco[nome]
      if (vistos.has(nome)) throw new ColumnarPayloadError(`campo repetido entre blocos: ${nome}`)
      // Atribuir `__proto__` trocaria o protótipo da linha em vez de gravar o valor.
      if (nome === '__proto__') throw new ColumnarPayloadError('campo __proto__ não é aceito')
      if (!Array.isArray(valores) || valores.length !== n) {
        const tam = Array.isArray(valores) ? valores.length : typeof valores
        throw new ColumnarPayloadError(`coluna ${nome} com ${tam} valores, esperado ${n}`)
      }
      vistos.add(nome)
      nomes.push(nome)
      colunas.push(valores)
    }
  }

  // COMO MONTAR IMPORTA (medido em 16/09, Node 22 = motor do Chrome, 10 mil linhas):
  //   JSON em linhas (o formato antigo) ........ 22,9 MB retidos, 53–64 ms
  //   objeto vazio + campo a campo (o óbvio) ... 50,4 MB  <- mais que o dobro
  //   cópia de um MOLDE criado pelo JSON.parse . 22,8 MB, 57–59 ms  <- este
  //   `new Function` com os campos fixos ....... 26,8 MB, e a CSP de produção não
  //                                              permite 'unsafe-eval'
  // O molde nasce do JSON.parse com todos os campos, então as cópias já têm a forma
  // final e a atribuição só troca valores — sem o objeto crescer campo a campo.
  const ordem = payload.row_order
  let indices: number[] | null = null
  if (ordem != null) {
    if (!Array.isArray(ordem) || ordem.length !== n) {
      throw new ColumnarPayloadError(`row_order com tamanho errado (esperado ${n})`)
    }
    indices = Array.from({ length: n }, (_, i) => i)
    indices.sort((a, b) => (ordem[a] as number) - (ordem[b] as number))
  }

  const k = nomes.length
  const molde = JSON.parse(`{${nomes.map((nome) => `${JSON.stringify(nome)}:null`).join(',')}}`) as Record<string, unknown>
  const rows = new Array<Record<string, unknown>>(n)
  for (let pos = 0; pos < n; pos++) {
    const i = indices === null ? pos : indices[pos]
    const row = { ...molde }
    for (let j = 0; j < k; j++) row[nomes[j]] = colunas[j][i]
    rows[pos] = row
  }
  return rows
}

/**
 * A resposta no formato que o resto do app sempre usou (`data` = linhas). Aceita os
 * dois formatos: a resposta sem packs e a de uma rota antiga já vêm em linhas.
 */
export function asRowPayload<T extends Record<string, unknown>>(payload: T | ColumnarPayload): T {
  if (!isColumnarPayload(payload)) return payload as T
  const { data_columns: _cols, row_count: _n, row_order: _ord, ...topo } = payload
  void _cols
  void _n
  void _ord
  return { ...topo, data: rowsFromColumns(payload) } as unknown as T
}

/**
 * Linhas → colunas, para GRAVAR (IndexedDB). Só empacota quando todas as linhas têm
 * exatamente os mesmos campos: senão, "campo ausente" viraria "campo nulo" na volta
 * — e o app distingue os dois em alguns lugares. Nesse caso devolve `null` e quem
 * chamou grava as linhas como sempre.
 */
export function columnsFromRows(rows: ReadonlyArray<Record<string, unknown>>): Pick<ColumnarPayload, 'data_columns' | 'row_count'> | null {
  const n = rows.length
  if (n === 0) return { data_columns: [], row_count: 0 }
  const nomes = Object.keys(rows[0])
  const k = nomes.length
  const colunas: unknown[][] = nomes.map(() => new Array(n))
  for (let i = 0; i < n; i++) {
    const row = rows[i]
    if (Object.keys(row).length !== k) return null
    for (let j = 0; j < k; j++) {
      const nome = nomes[j]
      if (!(nome in row)) return null
      const v = row[nome]
      // `undefined` não existe em JSON: viraria null e mudaria a linha na volta.
      if (v === undefined) return null
      colunas[j][i] = v
    }
  }
  const bloco: Record<string, unknown[]> = {}
  nomes.forEach((nome, j) => { bloco[nome] = colunas[j] })
  return { data_columns: [bloco], row_count: n }
}
