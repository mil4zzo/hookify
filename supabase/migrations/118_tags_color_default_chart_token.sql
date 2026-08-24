-- Migration 118: default de tags.color passa a ser um token do design system
--
-- A 116 nasceu com DEFAULT 'slate', de uma paleta de familias cruas do Tailwind.
-- Na implementacao da UI essa paleta foi trocada pelos tokens --chart-* (paleta
-- categorica do design system, que ja responde a tema claro/escuro e passa no
-- check:design-system). 'slate' deixou de existir como cor valida.
--
-- Migration separada em vez de edicao da 116: a 116 ja foi aplicada. Reescrever
-- uma migration aplicada faz o arquivo mentir sobre o que rodou no banco.
--
-- Sem backfill: a tabela nao tinha linhas quando a paleta mudou. E o frontend
-- normaliza cor desconhecida para o default (lib/tags/colors.ts), entao uma linha
-- gravada fora do backend renderiza mesmo com valor legado.

BEGIN;

ALTER TABLE public.tags ALTER COLUMN color SET DEFAULT 'chart1';

COMMENT ON COLUMN public.tags.color IS
  'Token da paleta de tags (chart1..chart5). Validado no backend (TAG_COLORS) e mapeado em frontend/lib/tags/colors.ts.';

COMMIT;
