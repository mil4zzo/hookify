import { useQueryClient } from '@tanstack/react-query'
import { useSessionStore } from '../store/session'
import { setAuthToken } from '@/lib/api/client'
import { showSuccess, showError } from '@/lib/utils/toast'
import { queryKeys } from '@/lib/api/hooks'
import { useSupabaseAuth } from './useSupabaseAuth'
import { useRouter } from 'next/navigation'

export const useAuthManager = () => {
  const queryClient = useQueryClient()
  const { setUser, logout } = useSessionStore()
  const { signOut } = useSupabaseAuth()
  const router = useRouter()

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
      
      // 2. Fazer signOut do Supabase (isso limpa a sessão e cookies)
      await signOut()
      
      // 3. Limpar token do cliente HTTP
      setAuthToken(null)
      
      // 4. Limpar store Zustand
      logout()
      
      // 5. Limpar cache do React Query (depois de cancelar)
      queryClient.clear()
      
      // 6. Redirecionar para login
      router.push('/login')
      
      showSuccess('Logout realizado com sucesso!')
    } catch (error) {
      showError(error as any)
      // Mesmo com erro, cancelar queries, limpar localmente e redirecionar
      queryClient.cancelQueries()
      setAuthToken(null)
      logout()
      queryClient.clear()
      router.push('/login')
    }
  }

  return {
    handleLoginSuccess,
    handleLogout,
  }
}
