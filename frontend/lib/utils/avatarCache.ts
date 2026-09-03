/**
 * Cache local da foto de perfil exibida no Topbar.
 *
 * Existe para uma coisa só: pintar o avatar no primeiro frame, antes da query
 * de conexões do Facebook responder (senão aparecem as iniciais e a foto entra
 * depois, piscando).
 *
 * O cache é AMARRADO AO DONO (`uid`). A versão anterior guardava só a URL crua,
 * sem dono, e o localStorage sobrevive ao logout — ao entrar com outra conta o
 * Topbar pintava a foto da conta anterior até a query de conexões resolver.
 * Entrada em formato antigo (string crua) é tratada como sem dono e descartada.
 */
const AVATAR_CACHE_KEY = "hookify_avatar_url";

export type AvatarCacheEntry = { uid: string; url: string };

export function readAvatarCache(): AvatarCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AVATAR_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.uid !== "string" || typeof parsed.url !== "string") {
      localStorage.removeItem(AVATAR_CACHE_KEY);
      return null;
    }
    return { uid: parsed.uid, url: parsed.url };
  } catch {
    // Formato antigo (URL crua não é JSON válido) ou storage corrompido.
    try { localStorage.removeItem(AVATAR_CACHE_KEY); } catch {}
    return null;
  }
}

export function writeAvatarCache(uid: string, url: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(AVATAR_CACHE_KEY, JSON.stringify({ uid, url }));
  } catch {}
}

export function clearAvatarCache(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(AVATAR_CACHE_KEY); } catch {}
}
