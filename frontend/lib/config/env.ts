// Environment configuration for frontend
export const env = {
  API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000',
  FB_REDIRECT_URI: process.env.NEXT_PUBLIC_FB_REDIRECT_URI || 'http://localhost:3000/callback',
  USE_REMOTE_API: process.env.NEXT_PUBLIC_USE_REMOTE_API === 'true',
  NODE_ENV: process.env.NODE_ENV || 'development',
} as const

