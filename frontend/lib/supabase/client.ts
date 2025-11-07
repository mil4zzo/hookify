import { createBrowserClient } from '@supabase/ssr'
import { env } from '@/lib/config/env'

let browserClient: ReturnType<typeof createBrowserClient> | null = null

export function getSupabaseClient() {
  if (browserClient) return browserClient
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('Supabase env vars missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY')
    }
  }
  browserClient = createBrowserClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY)
  return browserClient
}


