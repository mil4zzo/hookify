import type { PublicShare } from "./types";

// Fetch público (sem Authorization) — NÃO usar o apiClient aqui: o interceptor
// de 401 dele dispara o handler global de sessão expirada, que não faz sentido
// numa página anônima. Mesmo padrão do health check (useServerHealth).
//
// Este é o ÚNICO fetch server-side do app (roda no processo Node do Next, não
// no browser). Em produção o container do frontend NÃO consegue alcançar o
// próprio domínio público (api.hookifyads.com → hairpin pelo Traefik falha de
// dentro da rede Docker) — por isso API_BASE_INTERNAL_URL (http://backend:8000,
// DNS interno do compose) tem precedência. Sem ela (dev local), cai no
// NEXT_PUBLIC_API_BASE_URL normal. Qualquer futuro fetch server-side → API
// precisa da mesma precedência.
const API_BASE =
  process.env.API_BASE_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  "http://localhost:8000";

// Espelha _TOKEN_LENGTH do backend (backend/app/routes/shares.py) — só para
// evitar uma request óbvia de graça; a validação real vive no backend.
const SHARE_TOKEN_LENGTH = 10;

/** Busca o snapshot público de um share. null = inexistente/revogado/expirado/erro. */
export async function fetchPublicShare(token: string): Promise<PublicShare | null> {
  const clean = (token || "").trim();
  if (clean.length !== SHARE_TOKEN_LENGTH) return null;
  try {
    const res = await fetch(`${API_BASE}/shares/public/${encodeURIComponent(clean)}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PublicShare;
    if (!Array.isArray(data?.items)) return null;
    return data;
  } catch {
    return null;
  }
}
