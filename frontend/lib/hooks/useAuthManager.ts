import { useQueryClient } from '@tanstack/react-query'
import { useSessionStore } from '../store/session'
import { setAuthToken } from '@/lib/api/client'
import { showSuccess, showError } from '@/lib/utils/toast'
import { queryKeys } from '@/lib/api/hooks'

export const useAuthManager = () => {
  const queryClient = useQueryClient()
  const { setAccessToken, setUser, logout } = useSessionStore()

  const handleLoginSuccess = (accessToken: string, userInfo?: any) => {
    try {
      // 1. Salvar token no localStorage e configurar cliente HTTP
      setAuthToken(accessToken)
      
      // 2. Atualizar store Zustand
      setAccessToken(accessToken)
      
      // 3. Se temos dados do usuário, salvar no store
      if (userInfo) {
        setUser(userInfo)
      }
      
      // 4. Invalidar queries para recarregar dados
      queryClient.invalidateQueries({ queryKey: queryKeys.me })
      queryClient.invalidateQueries({ queryKey: queryKeys.adAccounts })
      
      // 5. Mostrar sucesso
      showSuccess('Autenticação realizada com sucesso!')
      
      return true
    } catch (error) {
      showError(error as any)
      return false
    }
  }

  const handleLogout = () => {
    try {
      // 1. Limpar token do cliente HTTP
      setAuthToken(null)
      
      // 2. Limpar store Zustand
      logout()
      
      // 3. Limpar cache do React Query
      queryClient.clear()
      
      showSuccess('Logout realizado com sucesso!')
    } catch (error) {
      showError(error as any)
    }
  }

  return {
    handleLoginSuccess,
    handleLogout,
  }
}
