import { useQueryClient } from '@tanstack/react-query'
import { useSessionStore } from '../store/session'
import { setAuthToken } from '@/lib/api/client'
import { showSuccess, showError } from '@/lib/utils/toast'
import { queryKeys } from '@/lib/api/hooks'
import { useSupabaseAuth } from './useSupabaseAuth'

export const useAuthManager = () => {
  const queryClient = useQueryClient()
  const { setUser, logout } = useSessionStore()
  const { signOut } = useSupabaseAuth()

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
      
      // 2. Limpar token do cliente HTTP primeiro
      setAuthToken(null)
      
      // 3. Limpar store Zustand antes do signOut
      logout()
      
      // 4. Limpar cache do React Query (depois de cancelar)
      queryClient.clear()
      
      // 5. Fazer signOut do Supabase (isso limpa a sessão e cookies)
      // O signOut já inclui um pequeno delay para garantir limpeza dos cookies
      await signOut()
      
      // 6. Mostrar mensagem de sucesso
      showSuccess('Logout realizado com sucesso!')
      
      // 7. Redirecionar para login com parâmetro de logout para forçar acesso
      // Isso garante que o middleware permita acesso mesmo se ainda houver cookies residuais
      // Usar window.location para forçar reload completo e resetar todos os hooks
      window.location.href = '/login?logout=true'
    } catch (error) {
      showError(error as any)
      // Mesmo com erro, cancelar queries, limpar localmente e redirecionar
      queryClient.cancelQueries()
      setAuthToken(null)
      logout()
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
