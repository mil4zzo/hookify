/**
 * Leitura do "este pack está sendo atualizado" a partir do BANCO.
 *
 * Por que existe: o selo de atualização sempre veio de estado local do navegador
 * (`updatingPacks` / `activeJobs`), preenchido pelo próprio fluxo de refresh daquela
 * aba. Num pack compartilhado isso deixava os outros membros cegos — o colega
 * atualizava e eles viam o pack parado, liam dados sendo reescritos e podiam
 * disparar um refresh concorrente (que o backend rejeita com 409, mas só depois
 * do clique). `packs.refresh_status` é do PACK, não de quem disparou: é o único
 * sinal que atravessa contas.
 */

import { AdsPack } from '@/lib/types'

/**
 * `refresh_lock_until` vem de uma coluna `timestamp` SEM timezone, então o
 * PostgREST devolve algo como "2026-09-04T18:30:00" — sem offset. `new Date()`
 * interpreta essa forma como hora LOCAL: para um usuário em UTC-3 o prazo
 * nasceria 3 h no passado e o selo NUNCA apareceria. O backend grava em UTC,
 * então reanexamos o "Z" quando não há offset explícito.
 */
const HAS_OFFSET = /([zZ]|[+-]\d{2}:?\d{2})$/

function parseUtcTimestamp(value: string): number {
  return Date.parse(HAS_OFFSET.test(value) ? value : `${value}Z`)
}

/**
 * true quando o banco diz que há um refresh em andamento E o carimbo de validade
 * ainda não venceu.
 *
 * O prazo não é decoração: há caminhos que nunca escrevem o status final (job que
 * morre no processor, cancelamento em lote). Sem ele, um pack ficaria "atualizando"
 * para sempre na tela de todo mundo. Status 'running' com lock vencido = mentira
 * conhecida; tratamos como parado.
 */
export function isPackRefreshingOnServer(pack: Pick<AdsPack, 'refresh_status' | 'refresh_lock_until'> | null | undefined): boolean {
  if (!pack || pack.refresh_status !== 'running') return false
  const lock = pack.refresh_lock_until
  if (!lock) return false
  const expiresAt = parseUtcTimestamp(lock)
  return Number.isFinite(expiresAt) && expiresAt > Date.now()
}
