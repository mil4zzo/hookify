/**
 * Utilitários para tratamento centralizado de erros de autenticação Google.
 * Elimina duplicação de lógica de detecção de token expirado.
 */

import { AppError } from "./errors";

// Códigos de erro do Google (deve corresponder aos códigos do backend)
export const GOOGLE_TOKEN_EXPIRED = "GOOGLE_TOKEN_EXPIRED";
export const GOOGLE_TOKEN_INVALID = "GOOGLE_TOKEN_INVALID";
export const GOOGLE_CONNECTION_NOT_FOUND = "GOOGLE_CONNECTION_NOT_FOUND";
export const GOOGLE_SHEETS_ERROR = "GOOGLE_SHEETS_ERROR";
export const GOOGLE_DRIVE_ERROR = "GOOGLE_DRIVE_ERROR";
export const GOOGLE_AUTH_ERROR = "GOOGLE_AUTH_ERROR";

/**
 * Verifica se um erro é relacionado a token expirado/inválido do Google.
 * Também inclui GOOGLE_CONNECTION_NOT_FOUND porque se a integração existe mas a conexão não,
 * significa que o token foi revogado e o usuário precisa reconectar.
 */
export function isGoogleTokenError(error: AppError | Error | unknown): boolean {
  const appError = error as AppError;
  return (
    appError?.code === GOOGLE_TOKEN_EXPIRED ||
    appError?.code === GOOGLE_TOKEN_INVALID ||
    appError?.code === GOOGLE_CONNECTION_NOT_FOUND
  );
}

/**
 * Verifica se um erro é relacionado a conexão Google não encontrada.
 */
export function isGoogleConnectionNotFound(error: AppError | Error | unknown): boolean {
  const appError = error as AppError;
  return appError?.code === GOOGLE_CONNECTION_NOT_FOUND;
}

/**
 * Handler centralizado para erros de autenticação Google.
 * Limpa cache, dispara eventos e retorna se deve solicitar reconexão.
 */
export function handleGoogleAuthError(
  error: AppError | Error | unknown,
  connectionId?: string
): { shouldReconnect: boolean; message: string } {
  const appError = error as AppError;
  
  if (!isGoogleTokenError(appError)) {
    return { shouldReconnect: false, message: appError?.message || "Erro desconhecido" };
  }

  // Limpar cache de verificação da conexão se houver connectionId
  if (connectionId && typeof window !== "undefined") {
    try {
      const VERIFICATION_CACHE_KEY = "google_connections_verification_cache";
      const cache = localStorage.getItem(VERIFICATION_CACHE_KEY);
      if (cache) {
        const parsed = JSON.parse(cache);
        delete parsed[connectionId];
        localStorage.setItem(VERIFICATION_CACHE_KEY, JSON.stringify(parsed));
      }
    } catch (e) {
      console.error("Erro ao limpar cache de verificação:", e);
    }
  }

  // Disparar evento customizado para que o GoogleSheetIntegrationDialog trate
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("google-token-expired", {
        detail: {
          message: appError.message || "Token do Google expirado ou revogado. Por favor, reconecte sua conta Google.",
          source: "handleGoogleAuthError",
          connectionId: connectionId,
        },
      })
    );
  }

  return {
    shouldReconnect: true,
    message: appError.message || "Token do Google expirado ou revogado. Por favor, reconecte sua conta Google.",
  };
}

