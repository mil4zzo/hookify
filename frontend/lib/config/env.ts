// Environment configuration for frontend
export const env = {
  API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000',
  FB_REDIRECT_URI: process.env.NEXT_PUBLIC_FB_REDIRECT_URI || 'http://localhost:3000/callback',
  USE_REMOTE_API: process.env.NEXT_PUBLIC_USE_REMOTE_API === 'true',
  NODE_ENV: process.env.NODE_ENV || 'development',
  IS_DEV: process.env.NEXT_PUBLIC_ENABLE_DEV_FEATURES === 'true' || process.env.NODE_ENV === 'development',
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  // Prefer publishable key per Supabase latest best practices; keep backwards compat fallbacks
  SUPABASE_ANON_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    '',
} as const

