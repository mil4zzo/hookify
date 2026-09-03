/**
 * Chave do cache síncrono do React Query (localStorage).
 *
 * Vive fora do ReactQueryProvider ("use client") porque o logout, na store de
 * sessão, precisa apagá-la sem arrastar o provider junto.
 */
export const REACT_QUERY_PERSIST_KEY = 'hookify-rq-cache-v1'
