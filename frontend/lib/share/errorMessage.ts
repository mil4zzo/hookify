/**
 * Mensagem legível a partir do erro que o apiClient REALMENTE rejeita.
 *
 * O interceptor de resposta nunca propaga o erro cru do axios: ele rejeita um
 * `AppError` ({status, message, details, code}) já normalizado por `parseError`
 * (ver `lib/api/client.ts`). Um callsite que lê `error.response.data.detail`
 * — o formato do axios — só encontra `undefined`, e `error instanceof Error`
 * também falha porque `AppError` é objeto puro. O resultado é que TODA falha,
 * inclusive as que o backend explicou, cai no texto genérico.
 *
 * Foi exatamente assim que o 500 da criação de link ficou invisível em
 * 2026-09-04: o backend respondeu {"detail": "Internal Server Error"} com os
 * headers CORS certos, o `parseError` traduziu direito, e o dialog jogou fora.
 */
export function extractErrorDetail(
  error: unknown,
  fallback = "Tente novamente em instantes.",
): string {
  // Caminho real: AppError vindo do interceptor (mesma regra do showError).
  // Cobre também o Error nativo, que tem `message` string.
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  // Fallback: erro cru do axios, para chamadas que não passem pelo interceptor.
  const detail = (error as any)?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}
