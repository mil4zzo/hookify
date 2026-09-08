/**
 * Carimbo de frescor dos packs selecionados — entra na queryKey de rankings/series.
 *
 * POR QUE EXISTE
 * --------------
 * A resposta do Manager é função determinística de (packs, período, evento,
 * agrupamento, DADOS). Os dados só mudam em três eventos: refresh de pack,
 * sync de leadscore (planilha) e — fora do escopo deste carimbo — toggles de
 * status e edições de tag, que já invalidam o cache pelos caminhos existentes.
 *
 * Colocar um carimbo desses eventos na chave faz "cache velho" ser
 * estruturalmente impossível de ENCONTRAR: mudou o dado → mudou o carimbo →
 * chave nova → busca de novo. Não existe "invalidar"; o antigo só envelhece.
 * É o que torna seguro persistir a resposta em disco (fase 2 do plano).
 *
 * POR QUE `updated_at` E NÃO `last_refreshed_at`
 * ----------------------------------------------
 * `last_refreshed_at` é DATA LÓGICA (YYYY-MM-DD): dois refreshes no mesmo dia
 * teriam o mesmo carimbo e o segundo passaria despercebido. `updated_at` é
 * timestamp e o refresh o atualiza ao gravar stats (supabase_repo.update_pack_stats).
 * Efeito colateral aceito: renomear um pack também muda `updated_at` e custa uma
 * recomputação a mais — nunca dado errado.
 *
 * POR QUE O CARIMBO DA PLANILHA
 * -----------------------------
 * O sync de leadscore altera `ad_metrics.leadscore_values` SEM tocar em `packs`.
 * Sem `last_successful_sync_at` no carimbo, MQL/CPMQL ficariam velhos em outro
 * aparelho até o próximo refresh.
 *
 * POR QUE A CONTAGEM (`n=`)
 * -------------------------
 * Pack selecionado que ainda não chegou ao store (rehidratação, compartilhado
 * recém-aceito) não contribui carimbo. Contar quantos foram encontrados faz a
 * chave mudar quando ele chegar — em vez de servir uma resposta calculada com
 * a seleção pela metade.
 */

export interface PackFreshnessSource {
  id: string
  updated_at?: string | null
  sheet_integration?: { last_successful_sync_at?: string | null } | null
}

export function maxIso(values: Array<string | null | undefined>): string {
  let max = ''
  for (const v of values) {
    if (typeof v === 'string' && v && v > max) max = v
  }
  return max
}

/**
 * Determinístico e independente da ordem de `packIds`. Retorna '' quando não
 * há seleção — a chave continua válida, só não carrega frescor.
 */
export function computePacksFreshnessStamp(
  packs: readonly PackFreshnessSource[] | null | undefined,
  packIds: readonly string[] | null | undefined,
): string {
  if (!packs?.length || !packIds?.length) return ''
  const wanted = new Set(packIds.map(String))
  const selected = packs.filter((p) => wanted.has(String(p.id)))
  if (selected.length === 0) return 'n=0'
  const refreshed = maxIso(selected.map((p) => p.updated_at))
  const synced = maxIso(selected.map((p) => p.sheet_integration?.last_successful_sync_at))
  return `n=${selected.length}|r=${refreshed}|s=${synced}`
}

/**
 * Carimbo de CONTEÚDO dos packs — entra na queryKey do grafo de conflito.
 *
 * POR QUE UM CARIMBO SEPARADO DO DE CIMA
 * --------------------------------------
 * Conflito é "estes dois packs contêm o mesmo anúncio no mesmo dia?". A resposta
 * só muda quando a MEMBRESIA (ad_id, metric_date) de algum pack muda — ou seja,
 * no refresh, que grava `packs.updated_at` (supabase_repo.update_pack_stats).
 *
 * O `last_successful_sync_at` da planilha NÃO entra: o sync de leadscore altera
 * `ad_metrics.leadscore_values`, nunca quem está dentro do pack. Reaproveitar o
 * carimbo do Manager aqui faria o grafo ser recalculado a cada sync sem que a
 * resposta pudesse ter mudado.
 *
 * POR QUE TODOS OS PACKS, NÃO SÓ OS SELECIONADOS
 * ----------------------------------------------
 * O grafo é buscado para a lista inteira de packs acessíveis (a seleção muda a
 * cada clique; o grafo, não). Logo o carimbo cobre a mesma lista inteira.
 *
 * EFEITO COLATERAL ACEITO: renomear um pack também mexe em `updated_at` e custa
 * um recálculo do grafo (~200 ms no pior caso medido) sem que nada tenha mudado.
 * Mesmo trade-off já aceito em `computePacksFreshnessStamp` — nunca dado errado.
 */
export function computePacksContentStamp(
  packs: readonly PackFreshnessSource[] | null | undefined,
): string {
  if (!packs?.length) return ''
  // `n=` porque um pack que SAI da lista (share revogado) não é detectável só
  // pelo máximo: o maior `updated_at` pode continuar sendo o de outro pack.
  return `n=${packs.length}|r=${maxIso(packs.map((p) => p.updated_at))}`
}
