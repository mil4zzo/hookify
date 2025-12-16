import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(req: NextRequest) {
  const res = NextResponse.next({ request: { headers: req.headers } })

  // Create a supabase client to refresh session cookies when needed
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  // Prefer publishable key per Supabase latest best practices; keep fallbacks
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  
  // Skip if missing (avoid error on first load before env is set)
  if (!supabaseUrl || !supabaseKey) {
    return res
  }
  
  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        get(name: string) {
          return req.cookies.get(name)?.value
        },
        set(name: string, value: string, options: any) {
          res.cookies.set({ name, value, ...options })
        },
        remove(name: string, options: any) {
          res.cookies.set({ name, value: '', ...options })
        },
      },
    }
  )

  // Touch the session to ensure refresh happens if close to expiring
  const { data: { session } } = await supabase.auth.getSession()
  
  const pathname = req.nextUrl.pathname
  
  // Rotas públicas que não requerem autenticação
  const PUBLIC_ROUTES = ['/login', '/signup', '/callback']
  
  // Rotas protegidas (requerem autenticação)
  const PROTECTED_ROUTES = ['/rankings', '/ads-loader', '/onboarding', '/']

  // Verificar se a rota é protegida
  const isProtectedRoute = PROTECTED_ROUTES.some(route => pathname === route || pathname.startsWith(route + '/'))
  const isPublicRoute = PUBLIC_ROUTES.some(route => pathname === route || pathname.startsWith(route + '/'))
  
  // Se é uma rota protegida e não há sessão, redirecionar para login
  if (isProtectedRoute && !session && !isPublicRoute) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirect', pathname) // Salvar URL original para redirecionar após login
    return NextResponse.redirect(url)
  }
  
  // Se está logado e tenta acessar login/signup, redirecionar para ads-loader
  if ((pathname === '/login' || pathname === '/signup') && session) {
    const url = req.nextUrl.clone()
    url.pathname = '/ads-loader'
    return NextResponse.redirect(url)
  }

  return res
}

// Configure matcher if you want to target specific routes later
export const config = {
  matcher: ['/((?!_next|static|.*\\.\
(?:png|jpg|jpeg|gif|svg|ico|webp|txt)).*)'],
}


