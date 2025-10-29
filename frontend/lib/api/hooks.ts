import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './endpoints'
import { showError } from '@/lib/utils/toast'
import { AppError } from '@/lib/utils/errors'
import {
  GetAdsRequest,
  GetVideoSourceRequest,
  AuthTokenRequest,
  FacebookUser,
  FacebookAdAccount,
  FacebookVideoSource,
} from './schemas'
import { useSessionStore } from '@/lib/store/session'

// Query Keys
export const queryKeys = {
  me: ['facebook', 'me'] as const,
  adAccounts: ['facebook', 'adaccounts'] as const,
  ads: (params: GetAdsRequest) => ['facebook', 'ads', params] as const,
  videoSource: (params: GetVideoSourceRequest) => ['facebook', 'video-source', params] as const,
}

// Hooks para queries
export const useMe = () => {
  const token = useSessionStore(s => s.accessToken)
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: api.facebook.getMe,
    enabled: !!token,
    staleTime: 5 * 60 * 1000, // 5 minutos
    retry: 2,
  })
}

export const useAdAccounts = () => {
  const token = useSessionStore(s => s.accessToken)
  return useQuery({
    queryKey: queryKeys.adAccounts,
    queryFn: api.facebook.getAdAccounts,
    enabled: !!token,
    staleTime: 10 * 60 * 1000, // 10 minutos
    retry: 2,
  })
}

export const useAds = (params: GetAdsRequest, enabled = true) => {
  return useQuery({
    queryKey: queryKeys.ads(params),
    queryFn: () => api.facebook.getAds(params),
    enabled,
    staleTime: 2 * 60 * 1000, // 2 minutos
    retry: 2,
  })
}

export const useVideoSource = (params: GetVideoSourceRequest, enabled = true) => {
  return useQuery({
    queryKey: queryKeys.videoSource(params),
    queryFn: () => api.facebook.getVideoSource(params),
    enabled,
    staleTime: 30 * 60 * 1000, // 30 minutos (videos são mais estáveis)
    retry: 2,
  })
}

// Hooks para mutations
export const useAuthToken = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: api.auth.exchangeToken,
    onSuccess: (data) => {
      // Invalidar queries relacionadas ao usuário
      queryClient.invalidateQueries({ queryKey: queryKeys.me })
      queryClient.invalidateQueries({ queryKey: queryKeys.adAccounts })
    },
  })
}

export const useAuthUrl = () => {
  return useMutation({
    mutationFn: api.auth.getUrl,
  })
}

// Hooks utilitários para invalidar cache
export const useInvalidateUserData = () => {
  const queryClient = useQueryClient()
  
  return {
    invalidateMe: () => queryClient.invalidateQueries({ queryKey: queryKeys.me }),
    invalidateAdAccounts: () => queryClient.invalidateQueries({ queryKey: queryKeys.adAccounts }),
    invalidateAll: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.me })
      queryClient.invalidateQueries({ queryKey: queryKeys.adAccounts })
    },
  }
}

// Hook para prefetch de dados
export const usePrefetchUserData = () => {
  const queryClient = useQueryClient()
  
  return {
    prefetchMe: () => queryClient.prefetchQuery({
      queryKey: queryKeys.me,
      queryFn: api.facebook.getMe,
      staleTime: 5 * 60 * 1000,
    }),
    prefetchAdAccounts: () => queryClient.prefetchQuery({
      queryKey: queryKeys.adAccounts,
      queryFn: api.facebook.getAdAccounts,
      staleTime: 10 * 60 * 1000,
    }),
  }
}
