import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { ROUTE_MINIMUM_TIER, canAccess, type Tier } from '@/lib/config/tierConfig'

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
  // Wrap in try/catch: if Supabase is unreachable (status 0), fail open so
  // the app doesn't hard-block on every request during a transient outage.
  let session = null
  try {
    const { data } = await supabase.auth.getSession()
    session = data.session
  } catch {
    // Network failure reaching Supabase auth — treat as unauthenticated.
    // Protected routes will redirect to login; public routes pass through.
  }
  
  const pathname = req.nextUrl.pathname

  // Rotas públicas que não requerem autenticação
  const PUBLIC_ROUTES = ['/login', '/callback', '/termos-de-uso', '/politica-de-privacidade', '/exclusao-de-dados', '/docs', '/pv', '/waitlist', '/waitlist-v2', '/suporte']

  // Todas as rotas são protegidas por padrão, exceto as explicitamente públicas acima
  const isPublicRoute = PUBLIC_ROUTES.some(route => pathname === route || pathname.startsWith(route + '/'))

  // Se não é rota pública e não há sessão, redirecionar para login
  if (!isPublicRoute && !session) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('redirect', pathname) // Salvar URL original para redirecionar após login
    return NextResponse.redirect(url)
  }
  
  // Se está logado e tenta acessar login, redirecionar para packs
  // EXCETO se houver parâmetro ?logout=true ou ?expired=true
  // (permite acesso após logout/expiração mesmo com cookies residuais)
  // Isso resolve o problema onde cookies ainda não foram completamente limpos após signOut
  const isLogoutRequest = req.nextUrl.searchParams.get('logout') === 'true'
  const isExpiredSessionRequest = req.nextUrl.searchParams.get('expired') === 'true'
  if (pathname === '/login' && session && !isLogoutRequest && !isExpiredSessionRequest) {
    const url = req.nextUrl.clone()
    url.pathname = '/packs'
    return NextResponse.redirect(url)
  }

  // Tier-based route protection
  const requiredTier = ROUTE_MINIMUM_TIER[pathname]
  if (requiredTier && session) {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('tier')
      .single()

    const userTier = (sub?.tier ?? 'standard') as Tier
    if (!canAccess(userTier, requiredTier)) {
      const url = req.nextUrl.clone()
      url.pathname = '/planos'
      url.searchParams.set('from', pathname)
      return NextResponse.redirect(url)
    }
  }

  return res
}

// Configure matcher if you want to target specific routes later
export const config = {
  matcher: ['/((?!_next|static|.*\\.\
(?:png|jpg|jpeg|gif|svg|ico|webp|txt)).*)'],
}

