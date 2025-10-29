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
    if (data?.detail) {
      message = data.detail
    } else if (data?.message) {
      message = data.message
    } else if (data?.error?.message) {
      message = data.error.message
    } else if (anyErr.message) {
      message = anyErr.message
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
        message = 'Timeout na requisição: A busca de anúncios demorou mais que 5 minutos. Tente novamente ou reduza o período de busca.'
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


