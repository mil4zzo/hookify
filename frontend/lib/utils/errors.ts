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
      // Se detail é string, usar diretamente
      message = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail)
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


