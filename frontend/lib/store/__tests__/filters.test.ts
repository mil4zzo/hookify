import test, { before } from "node:test";
import assert from "node:assert/strict";

/**
 * O bug que estes testes trancam: a seleção de packs morava numa chave única do
 * localStorage (`hookify-filters`). Trocar de conta no mesmo navegador fazia o
 * mapa de um usuário ser lido pelo outro — e, como pack desconhecido entra como
 * `true`, o sintoma era "logo de volta e está tudo marcado". Em pack
 * COMPARTILHADO era pior: os ids batiam e a desmarcação vazava de verdade.
 *
 * `window` e `localStorage` precisam existir ANTES do import do store: o
 * `createJSONStorage` do zustand resolve o storage na criação do módulo, e o
 * snapshot da chave global é lido no import.
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

/** Grava direto na chave, no formato do middleware `persist`. */
function seed(key: string, packPreferences: Record<string, boolean>): void {
  storage.setItem(
    key,
    JSON.stringify({ state: { packPreferences, dateRange: {}, actionType: "", usePackDates: false }, version: 1 }),
  );
}

// Estado herdado da era pré-escopo, para exercitar a adoção única.
seed("hookify-filters", { alpha: false, beta: true });

type FiltersModule = typeof import("../filters");
let useFiltersStore: FiltersModule["useFiltersStore"];
let bindFiltersToUser: FiltersModule["bindFiltersToUser"];

// O import tem que ser tardio (o projeto compila para CJS, sem top-level await)
// mas ainda depois do seed acima — o snapshot da chave global é lido no import.
before(async () => {
  const mod = await import("../filters");
  useFiltersStore = mod.useFiltersStore;
  bindFiltersToUser = mod.bindFiltersToUser;
});

test("antes de amarrar, boundUserId é null — é o gate que segura o syncPacksOnLoad", () => {
  // Sem este sinal, a sincronização rodaria sobre o mapa default (vazio),
  // marcaria todos os packs e gravaria isso por cima da preferência real.
  assert.equal(useFiltersStore.getState().boundUserId, null);
});

test("o primeiro usuário a logar adota o mapa global, e a chave global some", async () => {
  await bindFiltersToUser("user-1");

  assert.deepEqual(useFiltersStore.getState().packPreferences, { alpha: false, beta: true });
  assert.equal(useFiltersStore.getState().boundUserId, "user-1");
  assert.equal(storage.getItem("hookify-filters"), null, "chave global tem que sumir após a adoção");
  assert.notEqual(storage.getItem("hookify-filters:user-1"), null);
});

test("outro usuário no mesmo navegador NÃO herda a seleção — nem em pack compartilhado", async () => {
  // `beta` é o pack compartilhado: mesmo id nos dois silos. Antes do escopo,
  // user-2 abria o app já com beta desmarcado por decisão de user-1.
  useFiltersStore.getState().setPackPreferences({ alpha: false, beta: false });

  await bindFiltersToUser("user-2");

  assert.deepEqual(
    useFiltersStore.getState().packPreferences,
    {},
    "mapa do usuário anterior não pode sobreviver ao rehydrate",
  );
  assert.equal(useFiltersStore.getState().boundUserId, "user-2");
});

test("voltar para a conta anterior restaura a seleção dela", async () => {
  useFiltersStore.getState().setPackPreferences({ gama: true });

  await bindFiltersToUser("user-1");
  assert.deepEqual(useFiltersStore.getState().packPreferences, { alpha: false, beta: false });

  await bindFiltersToUser("user-2");
  assert.deepEqual(useFiltersStore.getState().packPreferences, { gama: true });
});

test("desmarcação sobrevive: `false` gravado não vira `true` na releitura", async () => {
  // O default de pack desconhecido é `true`; o que distingue "nunca vi" de
  // "o usuário desmarcou" é justamente o `false` persistido.
  await bindFiltersToUser("user-3");
  useFiltersStore.getState().setPackPreferences({ delta: false, epsilon: true });

  await bindFiltersToUser("user-1");
  await bindFiltersToUser("user-3");

  assert.deepEqual(useFiltersStore.getState().packPreferences, { delta: false, epsilon: true });
});
