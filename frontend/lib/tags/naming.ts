/**
 * Normalização de nome de tag — ESPELHO da coluna gerada `tags.slug` (migration 116):
 *
 *   translate(lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))), acentos, sem_acentos)
 *
 * O banco tem um unique index sobre (user_id, slug). O frontend usa esta função
 * para decidir se oferece "Criar ...": sem o mesmo critério, ele ofereceria criar
 * "black  friday" quando "Black Friday" já existe, e o usuário levaria um 409
 * depois de clicar.
 *
 * Divergir daqui é um bug silencioso nos dois sentidos: oferecer o que o banco
 * rejeita, ou esconder um nome que o banco aceitaria.
 */
export function normalizeTagName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

/** True se `name` colide com alguma das tags existentes pelo critério do banco. */
export function isTagNameTaken(name: string, existingNames: readonly string[]): boolean {
  const needle = normalizeTagName(name)
  if (!needle) return false
  return existingNames.some((existing) => normalizeTagName(existing) === needle)
}
