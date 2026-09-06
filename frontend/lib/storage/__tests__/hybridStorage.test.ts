import test, { before, beforeEach } from "node:test";
import assert from "node:assert/strict";

/**
 * O bug que este teste tranca: quando o localStorage estourava a cota, o
 * fallback chamava `localStorage.clear()`. Ele salvava o token, mas levava junto
 * o que não tinha culpa nenhuma no estouro e o app não sabe reconstruir — a
 * seleção de packs, o período e o tipo de conversão do Topbar — e ainda o token
 * de sessão do Supabase, derrubando o login que estava tentando salvar.
 */
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }
  get length(): number {
    return this.data.size;
  }
}

const storage = new MemoryStorage();
(globalThis as unknown as Record<string, unknown>).window = globalThis;
(globalThis as unknown as Record<string, unknown>).localStorage = storage;

let clearHeavyLocalStorageKeys: typeof import("../hybridStorage")["clearHeavyLocalStorageKeys"];

before(async () => {
  ({ clearHeavyLocalStorageKeys } = await import("../hybridStorage"));
});

beforeEach(() => {
  storage.clear();
  // Pesado e regenerável — sai.
  storage.setItem("hookify-session", "x".repeat(1000));
  storage.setItem("hookify-pack-ids", '["p1"]');
  storage.setItem("hookify-rq-cache-v1", "{}");
  storage.setItem("hookify_packs", "[]");
  storage.setItem("hookify_adaccounts", "[]");
  // Escolha do usuário e sessão — fica.
  storage.setItem("hookify-filters:user-1", '{"state":{"packPreferences":{"alpha":false}}}');
  storage.setItem("sb-projeto-auth-token", "token-do-supabase");
  storage.setItem("hookify-settings", '{"state":{}}');
});

test("libera as chaves pesadas e regeneráveis", () => {
  clearHeavyLocalStorageKeys();

  for (const key of [
    "hookify-session",
    "hookify-pack-ids",
    "hookify-rq-cache-v1",
    "hookify_packs",
    "hookify_adaccounts",
  ]) {
    assert.equal(storage.getItem(key), null, `${key} deveria ter sido removida`);
  }
});

test("preserva a seleção de packs — é o que o usuário escolheu e ninguém reconstrói", () => {
  clearHeavyLocalStorageKeys();

  assert.equal(
    storage.getItem("hookify-filters:user-1"),
    '{"state":{"packPreferences":{"alpha":false}}}',
  );
});

test("preserva o token do Supabase — limpar tudo derrubava o login que se tentava salvar", () => {
  clearHeavyLocalStorageKeys();

  assert.equal(storage.getItem("sb-projeto-auth-token"), "token-do-supabase");
  assert.equal(storage.getItem("hookify-settings"), '{"state":{}}');
});

test("storage bloqueado pelo navegador não propaga exceção", () => {
  const original = storage.removeItem.bind(storage);
  storage.removeItem = () => {
    throw new Error("SecurityError: site data bloqueado");
  };

  assert.doesNotThrow(() => clearHeavyLocalStorageKeys());

  storage.removeItem = original;
});
