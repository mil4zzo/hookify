import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Only send errors in production
  enabled: process.env.NODE_ENV === "production",

  // Sample rate for error events (1.0 = 100%)
  sampleRate: 1.0,

  // Filtrar erros irrelevantes
  ignoreErrors: [
    // Erros de extensões de browser
    "ResizeObserver loop",
    "Non-Error exception captured",
    // Erros de rede comuns (reconexão automática)
    "Failed to fetch",
    "NetworkError",
    "Load failed",
    // Erros de navegação
    "NEXT_REDIRECT",
  ],

  beforeSend(event) {
    // Não enviar erros de 401 (esperado quando sessão expira)
    if (event.extra?.status === 401) return null
    return event
  },
})
