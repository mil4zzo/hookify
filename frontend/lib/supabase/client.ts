import { createBrowserClient } from '@supabase/ssr'
import { env } from '@/lib/config/env'

let browserClient: ReturnType<typeof createBrowserClient> | null = null

export function getSupabaseClient() {
  if (browserClient) return browserClient
  
  // Validação mais rigorosa - lançar erro se faltar variáveis
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    const error = new Error(
      'Supabase configuration missing. Please check NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.'
    )
    console.error('Supabase env vars missing:', {
      SUPABASE_URL: env.SUPABASE_URL || 'MISSING',
      SUPABASE_ANON_KEY: env.SUPABASE_ANON_KEY ? 'SET' : 'MISSING'
    })
    throw error
  }
  
  browserClient = createBrowserClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY)
  return browserClient
}


