-- 182 — Duplicação de campanha com criativos novos (plano-duplicacao-de-campanha.md)
--
-- Duas tabelas, ambas escritas só pelo backend (service_role); o usuário apenas lê
-- as próprias linhas.
--
-- campaign_launch_items: um item = um criativo novo = uma campanha cópia do modelo.
--   Os ids criados na Meta são CHECKPOINTS: cada passo grava o id assim que a Meta
--   responde, e a retomada (deploy no meio, "tentar novamente") continua do último
--   checkpoint em vez de recopiar a campanha. É o que impede campanha duplicada.
--
-- ad_media_library: biblioteca das mídias já enviadas à biblioteca de uma conta na
--   Meta. A impressão digital (fingerprint) identifica o arquivo — `drive:{id}:{md5}`
--   para o Google Drive, `file:{nome}:{bytes}:{modificado}` para o computador —, e
--   reenviar o mesmo arquivo para a mesma conta custa zero upload.

CREATE TABLE IF NOT EXISTS public.ad_media_library (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id       text NOT NULL,              -- sem o prefixo act_
  source           text NOT NULL CHECK (source IN ('upload', 'drive')),
  fingerprint      text NOT NULL,
  file_name        text NOT NULL,
  media_type       text NOT NULL CHECK (media_type IN ('image', 'video')),
  size_bytes       bigint,
  width            integer,
  height           integer,
  duration_ms      integer,
  -- uploading: bytes indo para a Meta · processing: Meta codificando o vídeo ·
  -- ready: pronto para criativo · error: falhou (error_message diz o porquê)
  status           text NOT NULL DEFAULT 'uploading'
                   CHECK (status IN ('uploading', 'processing', 'ready', 'error')),
  bytes_sent       bigint NOT NULL DEFAULT 0,
  image_hash       text,
  video_id         text,
  -- capa do vídeo (frame preferido da Meta re-enviado em /adimages)
  thumbnail_hash   text,
  -- sessão de upload em pedaços do /advideos (retomada após queda)
  upload_session   jsonb,
  -- origem no Drive (para importar pelo servidor)
  drive_file_id    text,
  error_message    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_media_library_unique_fingerprint UNIQUE (user_id, account_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS ad_media_library_user_idx
  ON public.ad_media_library (user_id, updated_at DESC);

ALTER TABLE public.ad_media_library ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ad_media_library_read_own ON public.ad_media_library;
CREATE POLICY ad_media_library_read_own ON public.ad_media_library
  FOR SELECT USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.ad_media_library FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.ad_media_library FROM authenticated;
GRANT SELECT ON public.ad_media_library TO authenticated;
GRANT ALL ON public.ad_media_library TO service_role;


CREATE TABLE IF NOT EXISTS public.campaign_launch_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id              text NOT NULL,
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position            integer NOT NULL,          -- ordem do lote; vira o {index}
  ad_name             text NOT NULL,
  campaign_name       text NOT NULL,             -- já renderizado
  adset_name_template text NOT NULL,             -- {template_adset_name}/{index} resolvidos por conjunto
  -- { slot_key: ad_media_library.id }
  media               jsonb NOT NULL,
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'running', 'success', 'error')),
  step                text,                      -- último passo em andamento (para a tela)
  -- checkpoints
  meta_campaign_id    text,
  -- só no fallback de criação manual: um criativo por item, reusado nos conjuntos
  meta_creative_id    text,
  -- [{ source_adset_id, source_adset_name, adset_id, ad_id, ad_path }]
  adsets              jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message       text,
  error_code          text,
  error_details       jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaign_launch_items_unique_position UNIQUE (job_id, position)
);

CREATE INDEX IF NOT EXISTS campaign_launch_items_user_idx
  ON public.campaign_launch_items (user_id, created_at DESC);

ALTER TABLE public.campaign_launch_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaign_launch_items_read_own ON public.campaign_launch_items;
CREATE POLICY campaign_launch_items_read_own ON public.campaign_launch_items
  FOR SELECT USING (user_id = (SELECT auth.uid()));

REVOKE ALL ON public.campaign_launch_items FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.campaign_launch_items FROM authenticated;
GRANT SELECT ON public.campaign_launch_items TO authenticated;
GRANT ALL ON public.campaign_launch_items TO service_role;
