/**
 * Serializa um objeto para injeção segura em `<script type="application/ld+json">`.
 *
 * O problema: `dangerouslySetInnerHTML` insere o texto CRU no HTML. Se qualquer string
 * do JSON contiver `</script>`, o browser fecha o bloco de script ali e passa a
 * interpretar o resto como HTML — um `<script>` malicioso vindo do dado vira código
 * executando na página (XSS).
 *
 * Hoje o conteúdo dos nossos schemas é estático (nome da empresa, FAQ escrito por nós),
 * então não há como explorar. Isto existe para o dia em que alguém tornar o FAQ dinâmico
 * (banco, CMS, input) e não lembrar de checar o `dangerouslySetInnerHTML` — aí o furo
 * abriria sozinho.
 *
 * Trocamos `<` pela sua forma escapada em JSON: continua sendo JSON válido (o parser do
 * Google lê igual), mas o browser não enxerga mais um `</script>` literal. U+2028/U+2029
 * também entram: são válidos em JSON mas quebram parsers de JS.
 */
const UNSAFE_IN_SCRIPT_TAG = /[<\u2028\u2029]/g;

export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(
    UNSAFE_IN_SCRIPT_TAG,
    (char) => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}
