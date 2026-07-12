export type AppError = {
  status?: number
  code?: string
  message: string
  details?: unknown
}

export function parseError(err: unknown): AppError {
  // axios error
  const anyErr = err as any
  
  // Erro de resposta HTTP
  if (anyErr?.response) {
    const status = anyErr.response.status
    const data = anyErr.response.data
    
    // Tentar extrair mensagem mais específica
    let message = 'Erro inesperado'
    
    // Tratar erros de validação do Pydantic/FastAPI (array de erros)
    if (Array.isArray(data?.detail)) {
      const validationErrors = data.detail
        .map((e: any) => {
          if (typeof e === 'object' && e.msg) {
            const field = e.loc?.join('.') || 'campo'
            return `${field}: ${e.msg}`
          }
          return typeof e === 'string' ? e : JSON.stringify(e)
        })
        .join(', ')
      message = `Erro de validação: ${validationErrors}`
    } else if (data?.detail) {
      // Se detail é objeto estruturado (com code/message), extrair message
      if (typeof data.detail === 'object' && data.detail !== null && 'message' in data.detail) {
        message = data.detail.message
        // Preservar code se disponível
        if (data.detail.code) {
          return {
            status,
            message,
            code: data.detail.code,
            details: data.detail.details || data.detail,
          }
        }
      } else if (typeof data.detail === 'string') {
        message = data.detail
      } else {
        message = JSON.stringify(data.detail)
      }
    } else if (data?.message) {
      message = typeof data.message === 'string' ? data.message : JSON.stringify(data.message)
    } else if (data?.error?.message) {
      message = typeof data.error.message === 'string' ? data.error.message : JSON.stringify(data.error.message)
    } else if (anyErr.message) {
      message = typeof anyErr.message === 'string' ? anyErr.message : JSON.stringify(anyErr.message)
    }
    
    return { 
      status, 
      message, 
      details: data,
      code: anyErr.code || 'HTTP_ERROR'
    }
  }
  
  // Erro de rede/conexão
  if (anyErr?.request) {
    const code = anyErr.code || 'NETWORK'
    let message = 'Falha de conexão com o servidor'
    
    // Mensagens mais específicas baseadas no código de erro
    switch (anyErr.code) {
      case 'ECONNREFUSED':
        message = 'Servidor recusou a conexão. Verifique se o backend está rodando.'
        break
      case 'ENOTFOUND':
        message = 'Servidor não encontrado. Verifique a URL do backend.'
        break
      case 'ECONNABORTED':
        message = 'Timeout na requisição: A busca de anúncios demorou mais que 20 minutos. Tente novamente ou reduza o período de busca.'
        break
      case 'ETIMEDOUT':
        message = 'Timeout de conexão. Verifique sua conexão com a internet.'
        break
      default:
        message = `Erro de rede: ${anyErr.message || 'Falha de conexão com o servidor'}`
    }
    
    return { 
      code, 
      message, 
      details: anyErr.message 
    }
  }
  
  // Erro genérico
  return { 
    message: (anyErr?.message as string) ?? 'Erro desconhecido', 
    details: err,
    code: anyErr?.code || 'UNKNOWN'
  }
}

export const isUnauthorized = (e: AppError) => e.status === 401
export const isRateLimited = (e: AppError) => e.status === 429

/**
 * Normaliza erros vindos do Supabase Auth (@supabase/auth-js) para AppError.
 *
 * Motivação: quando o gateway do Supabase está fora do ar, a chamada de auth
 * falha com um `TypeError: Failed to fetch` (ou `AuthRetryableFetchError`) —
 * às vezes com a resposta 5xx sem cabeçalhos CORS, que o browser reporta como
 * "blocked by CORS policy". Sem normalização, `showError` mostra a string crua
 * "Failed to fetch" (curto-circuita em toast.tsx pois há `.message` string),
 * que não diz nada ao usuário. Aqui traduzimos a assinatura de indisponibilidade
 * para uma mensagem acionável e mantemos os erros legítimos (ex.: senha errada)
 * intactos.
 */
export function normalizeAuthError(error: unknown): AppError {
  const anyErr = error as any
  const msg = typeof anyErr?.message === 'string' ? anyErr.message : ''
  const name = typeof anyErr?.name === 'string' ? anyErr.name : ''
  const status = typeof anyErr?.status === 'number' ? anyErr.status : undefined

  // Assinatura de "servidor de auth inacessível": falha de fetch/rede ou 5xx do gateway.
  const isUnreachable =
    name === 'AuthRetryableFetchError' ||
    (name === 'TypeError' && /fetch/i.test(msg)) ||
    /failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(msg) ||
    status === 0 || status === 502 || status === 503 || status === 504

  if (isUnreachable) {
    return {
      code: 'AUTH_UNREACHABLE',
      status,
      message:
        'Não foi possível conectar ao servidor de autenticação. Ele pode estar temporariamente indisponível — aguarde alguns instantes e tente novamente.',
      details: msg,
    }
  }

  // Traduções pontuais das mensagens em inglês mais comuns do Supabase Auth.
  const AUTH_MESSAGE_PT: Record<string, string> = {
    'Invalid login credentials': 'E-mail ou senha incorretos.',
    'Email not confirmed': 'E-mail ainda não confirmado. Verifique sua caixa de entrada.',
    'User already registered': 'Já existe uma conta com este e-mail.',
  }
  if (msg && AUTH_MESSAGE_PT[msg]) {
    return { status, code: anyErr?.code ?? name, message: AUTH_MESSAGE_PT[msg] }
  }

  if (msg) return { status, code: anyErr?.code ?? name ?? 'AUTH_ERROR', message: msg }
  return { code: 'AUTH_ERROR', message: 'Erro de autenticação. Tente novamente.', details: error }
}


