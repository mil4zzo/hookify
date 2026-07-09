import type { NextConfig } from 'next'
import { withSentryConfig } from '@sentry/nextjs'

const isProd = process.env.NODE_ENV === 'production'

// Content-Security-Policy — allowlist dos hosts que o app realmente usa
// (Supabase, backend Hookify, Sentry, imagens do Meta). Emitida em
// **Report-Only**: não bloqueia nada, só reporta violações (console do
// navegador / endpoint de report). Para ATIVAR o bloqueio depois de validar
// que não há violação no fluxo normal, trocar a key abaixo de
// 'Content-Security-Policy-Report-Only' para 'Content-Security-Policy'.
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  // 'unsafe-inline' cobre os scripts de bootstrap/hidratação do Next e o JSON-LD;
  // 'unsafe-eval' só em dev (HMR/React Refresh). Upgrade futuro: CSP com nonce.
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  // 'unsafe-inline' necessário para estilos inline (framer-motion, recharts, visx, Tailwind runtime)
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.fbcdn.net https://www.facebook.com https://*.supabase.co",
  "font-src 'self' data:",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.hookifyads.com https://hookifyads.com https://*.sentry.io https://*.ingest.sentry.io${isProd ? '' : ' ws://localhost:* http://localhost:*'}`,
  "worker-src 'self' blob:",
].join('; ')

// Headers "seguros" vão em modo enforce; a CSP fica em Report-Only (acima).
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicy },
  // HSTS só em produção — em localhost forçaria https:// e quebraria o dev.
  ...(isProd
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  output: 'standalone',
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    optimizePackageImports: ["@tabler/icons-react"],
    clientTraceMetadata: ['sentry-trace', 'baggage'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.fbcdn.net',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'scontent.*.fna.fbcdn.net',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'scontent.fsdu8-1.fna.fbcdn.net',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'www.facebook.com',
        pathname: '/ads/image/**',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  webpack: (config, { isServer }) => {
    // Otimizar cache para strings grandes
    if (config.cache) {
      config.cache = {
        ...config.cache,
        compression: 'gzip' as const,
      };
    }
    return config;
  },
}

export default withSentryConfig(nextConfig, {
  // Upload source maps to Sentry for readable stack traces
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Suppress source map upload logs
  silent: !process.env.CI,

  // Tree-shake Sentry debug logging
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
  },
})


