-- Migration 116: tags de criativo (MVP)
--
-- POR QUE A TAG GRUDA EM ad_name, NAO EM ad_id
--   O Manager agrupa por ad_name e o fan-out medido e de ~34 ad_ids por nome
--   (12.787 anuncios para 371 criativos, periodo de 20 dias). Uma tag por ad_id
--   apareceria em 1 linha e faltaria nas outras 33 do mesmo criativo — erro
--   visivel na hora. A tag descreve o CRIATIVO ("esse video e topo de funil"),
--   nao a veiculacao.
--
--   Mesmo precedente de public.ad_transcriptions, que ja e chaveada por ad_name.
--
--   Efeito colateral desejado: a tag sobrevive ao anuncio sumir da Meta, porque
--   nao ha FK para public.ads. O criativo continua existindo como conceito.
--
-- POR QUE TAG PLANA (sem namespace chave:valor)
--   Decisao de produto de 2026-08-23. Namespace permitiria facetas e agrupamento
--   por chave, mas custa UX no MVP. O slug normalizado abaixo e o que impede a
--   degeneracao mais provavel de uma taxonomia plana: a mesma tag criada 3 vezes.
--
-- POR QUE O SLUG E COLUNA GERADA
--   Unicidade precisa valer no banco, nao na boa vontade do backend. Gerada
--   evita duas fontes de verdade. A extensao unaccent nao esta instalada neste
--   projeto, entao a dobra de acentos e feita com translate() — imutavel, que e
--   requisito de GENERATED ALWAYS ... STORED.
--
--   'Black Friday', 'black  friday' e 'BLACK FRIDAY' colidem. 'Acao' e 'acao'
--   tambem. E o suficiente para o MVP.
--
-- ESCOPO / COMPARTILHAMENTO
--   A tag e SEMPRE do usuario que a criou. Num pack compartilhado cada um ve as
--   suas — o convidado nao ve as do dono e vice-versa. Isso implementa a decisao
--   de que compartilhamento nao vaza tag: nome de tag carrega informacao interna
--   ('cliente-acme', 'testar-antes-de-cancelar') que nao deve viajar junto com o
--   pack. Por isso o join na RPC e por p_user_id (o espectador), nunca por
--   ad_metrics.user_id (o dono das linhas).

BEGIN;

-- ---------------------------------------------------------------------------
-- tags: o vocabulario do usuario
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  name       text NOT NULL,                    -- rotulo como o usuario digitou
  slug       text GENERATED ALWAYS AS (
               translate(
                 lower(btrim(regexp_replace(name, '\s+', ' ', 'g'))),
                 'áàâãäéèêëíìîïóòôõöúùûüçñ',
                 'aaaaaeeeeiiiiooooouuuucn'
               )
             ) STORED,
  color      text NOT NULL DEFAULT 'slate',    -- token do design system, nao hex
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tags_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT tags_name_max_len   CHECK (char_length(name) <= 40)
);

-- Unicidade por slug: bloqueia a duplicata que so difere em caixa/espaco/acento.
CREATE UNIQUE INDEX IF NOT EXISTS tags_user_slug_uidx
  ON public.tags (user_id, slug);

-- ---------------------------------------------------------------------------
-- ad_tags: a marcacao (criativo <-> tag)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ad_tags (
  user_id    uuid NOT NULL,
  tag_id     uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  ad_name    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- A PK serve a leitura "quais criativos tem a tag X" (prefixo user_id, tag_id)
  -- e ao mesmo tempo torna a marcacao idempotente: reaplicar em massa nao duplica.
  PRIMARY KEY (user_id, tag_id, ad_name),

  CONSTRAINT ad_tags_ad_name_not_blank CHECK (btrim(ad_name) <> '')
);

-- Serve o caminho inverso, que e o do read-path da RPC: "quais tags tem este
-- criativo". Sem ele o enriquecimento por linha vira seq scan em ad_tags.
CREATE INDEX IF NOT EXISTS ad_tags_user_name_idx
  ON public.ad_tags (user_id, ad_name);

-- ---------------------------------------------------------------------------
-- RLS: dono ve e escreve so o proprio. Mesmo formato de packs_modify_own.
-- ---------------------------------------------------------------------------
ALTER TABLE public.tags    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tags_modify_own ON public.tags;
CREATE POLICY tags_modify_own ON public.tags
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS ad_tags_modify_own ON public.ad_tags;
CREATE POLICY ad_tags_modify_own ON public.ad_tags
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

COMMENT ON TABLE public.tags IS
  'Vocabulario de tags do usuario (plano, sem namespace). slug e gerado e unico por usuario.';
COMMENT ON TABLE public.ad_tags IS
  'Marcacao tag <-> criativo. Chaveada por ad_name (criativo), nao ad_id, e sem FK para ads: a tag sobrevive ao anuncio sumir da Meta.';

COMMIT;
