# Guia de tradução (i18n) do frontend

Idiomas: `pt-BR` (base), `en-US` (em andamento), `es-ES` (depois). Biblioteca: `next-intl`.
O idioma vem da preferência do usuário (`settings.language`) e de um cookie (`hookify-locale`) que o servidor lê.

## Onde ficam os textos

`frontend/messages/`:

- `pt-BR.json` / `en-US.json` — núcleo (onboarding, nav, Manager).
- `<area>.pt-BR.json` / `<area>.en-US.json` — uma dupla por área (`manager-more`, `packs`, `ads`, `metrics`, `common`). Cada frente edita só os arquivos da sua área. Chaves de arquivos diferentes **se fundem** no mesmo namespace; o nome do arquivo não vira prefixo. Arquivo novo: registrar em `lib/i18n/messages.ts`.
- Teste de paridade (`lib/i18n/__tests__/messages.test.ts`): inglês tem **exatamente** as chaves do português, nada vazio, `<b>` balanceado.
- `.gitignore` ignora `*.json`: a exceção `!frontend/messages/*.json` já existe.

## Como usar

- **Componente**: `const t = useTranslations("namespace")` (de `next-intl`), `t("chave", { valores })`. Texto com negrito: `t.rich("chave", { b: (c) => <strong>{c}</strong> })`.
- **Fora de componente** (função pura, formatador, toast disparado em callback, config): `translate("namespace.chave", { valores })` de `@/lib/i18n/translate`. Lê o idioma **na hora da chamada**. Nunca guardar o resultado em constante de módulo: use função ou getter, senão o idioma congela na carga.
- **Coluna/lista montada fora de componente e memoizada**: receber `t` por parâmetro e colocá-lo nas dependências do `useMemo`.
- **Número/data**: `getAppLocale()`, `formatLocaleNumber`, `formatLocaleDate` de `@/lib/i18n/locale`. Nunca escrever `"pt-BR"`/`"en-US"` à mão (o `npm run check:i18n` barra).
- **Plural e gênero**: ICU dentro da mensagem. `{count, plural, one {# anúncio} other {# anúncios}}`, `{kind, select, campaign {desta} other {deste}}`. Nada de montar frase colando palavra solta: a frase inteira vive no catálogo (inglês ordena diferente).

## Regras de conteúdo

- O texto `pt-BR` é **exatamente o que já aparecia na tela** (a tela em português não pode mudar).
- Termos que ficam em inglês nos dois idiomas: Hook, Hold Rate, Scroll Stop, 50% View, 75% View, Connect Rate, Plays, ThruPlays, Pack, CPL Max, CPL Real, Score, nomes de produto Meta (Ads Manager).
- Vocabulário en-US: conjunto = "ad set", anúncio = "ad", campanha = "campaign", criativo = "creative", gasto = "spend", Otimize = "Optimize".
- **Não traduzir**: mensagens vindas do backend, `logger.*`/`console.*`, comentários, ids/enums/chaves de storage, classes CSS, páginas legais (termos, privacidade, exclusão de dados — texto jurídico exige revisão humana), páginas de desenvolvimento (`docs`, `design-system`, `ui-demo`, `test-ui`, `api-test`).
- Teste existente que confere texto em português continua valendo (idioma padrão é pt-BR). Só mude teste se a API do código mudou.
