"use client"

import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '@/lib/supabase/client'
import { formatToTitleCase } from '@/lib/utils/formatName'

type AuthState = {
  user: any | null
  session: any | null
  isLoading: boolean
  error: string | null
}

export function useSupabaseAuth() {
  const [state, setState] = useState<AuthState>({ user: null, session: null, isLoading: true, error: null })

  useEffect(() => {
    const supabase = getSupabaseClient()
    supabase.auth.getSession().then(({ data }) => {
      setState((s) => ({ ...s, session: data.session, user: data.session?.user ?? null, isLoading: false }))
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState((s) => ({ ...s, session, user: session?.user ?? null }))
    })
    return () => {
      sub.subscription.unsubscribe()
    }
  }, [])

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    const supabase = getSupabaseClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signUpWithEmail = useCallback(async (email: string, password: string, metadata?: { name?: string }) => {
    const supabase = getSupabaseClient()
    // Formata o nome em titlecase antes de salvar
    const formattedName = formatToTitleCase(metadata?.name)
    const { data, error } = await supabase.auth.signUp({ 
      email, 
      password,
      options: {
        data: {
          name: formattedName
        }
      }
    })
    if (error) throw error
    return data // Retornar data para verificar se há sessão
  }, [])

  const signInWithGoogle = useCallback(async () => {
    const supabase = getSupabaseClient()
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } })
    if (error) throw error
  }, [])

  const resetPassword = useCallback(async (email: string) => {
    const supabase = getSupabaseClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset-password' })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    const supabase = getSupabaseClient()
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }, [])

  return {
    user: state.user,
    session: state.session,
    isLoading: state.isLoading,
    error: state.error,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    resetPassword,
    signOut,
  }
}


