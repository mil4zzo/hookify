import { useQueryClient } from '@tanstack/react-query'
import { useSessionStore } from '../store/session'
import { useActiveJobsStore } from '../store/activeJobs'
import { setAuthToken } from '@/lib/api/client'
import { showSuccess, showError } from '@/lib/utils/toast'
import { queryKeys } from '@/lib/api/hooks'
import { useSupabaseAuth } from './useSupabaseAuth'
import { api } from '@/lib/api/endpoints'

export const useAuthManager = () => {
  const queryClient = useQueryClient()
  const { setUser, logout } = useSessionStore()
  const { signOut } = useSupabaseAuth()
  const { activeJobIds, clearAll: clearAllActiveJobs } = useActiveJobsStore()

  const handleLoginSuccess = (_accessToken: string, userInfo?: any) => {
    try {
      // Atualizar dados do usuário se fornecidos (opcional)
      if (userInfo) {
        setUser(userInfo)
      }
      
      // Invalidar queries para recarregar dados
      queryClient.invalidateQueries({ queryKey: queryKeys.me })
      
      // Mostrar sucesso
      showSuccess('Autenticação realizada com sucesso!')
      
      return true
    } catch (error) {
      showError(error as any)
      return false
    }
  }

  const handleLogout = async () => {
    try {
      // 1. Cancelar todas as queries ativas ANTES de fazer logout
      // Isso evita que requisições sejam enviadas após o logout
      queryClient.cancelQueries()
      
      // 2. Cancelar todos os jobs ativos no backend ANTES de limpar o token
      // Isso garante que os jobs sejam marcados como "cancelled" no banco de dados
      const jobIdsArray = Array.from(activeJobIds)
      if (jobIdsArray.length > 0) {
        try {
          await api.facebook.cancelJobsBatch(jobIdsArray, 'Cancelado durante logout')
          console.log(`[LOGOUT] ${jobIdsArray.length} job(s) cancelado(s)`)
        } catch (error) {
          console.warn('[LOGOUT] Erro ao cancelar jobs (continuando logout):', error)
          // Não bloquear logout se falhar ao cancelar jobs
        }
      }
      
      // 3. Limpar token do cliente HTTP
      setAuthToken(null)
      
      // 4. Limpar store Zustand (inclui activeJobs)
      logout()
      clearAllActiveJobs() // Garantir limpeza explícita dos jobs ativos
      
      // 5. Limpar cache do React Query (depois de cancelar)
      queryClient.clear()
      
      // 6. Fazer signOut do Supabase (isso limpa a sessão e cookies)
      // O signOut já inclui um pequeno delay para garantir limpeza dos cookies
      await signOut()
      
      // 7. Mostrar mensagem de sucesso
      showSuccess('Logout realizado com sucesso!')
      
      // 8. Redirecionar para login com parâmetro de logout para forçar acesso
      // Isso garante que o middleware permita acesso mesmo se ainda houver cookies residuais
      // Usar window.location para forçar reload completo e resetar todos os hooks
      window.location.href = '/login?logout=true'
    } catch (error) {
      showError(error as any)
      // Mesmo com erro, tentar cancelar jobs, cancelar queries, limpar localmente e redirecionar
      const jobIdsArray = Array.from(activeJobIds)
      if (jobIdsArray.length > 0) {
        try {
          await api.facebook.cancelJobsBatch(jobIdsArray, 'Cancelado durante logout (erro)')
        } catch (cancelError) {
          console.warn('[LOGOUT] Erro ao cancelar jobs em caso de erro:', cancelError)
        }
      }
      queryClient.cancelQueries()
      setAuthToken(null)
      logout()
      clearAllActiveJobs()
      queryClient.clear()
      // Tentar signOut mesmo com erro para limpar cookies
      try {
        await signOut()
      } catch (signOutError) {
        // Ignorar erro do signOut se já houve erro anterior
      }
      // Usar window.location para forçar reload completo mesmo em caso de erro
      window.location.href = '/login?logout=true'
    }
  }

  return {
    handleLoginSuccess,
    handleLogout,
  }
}
