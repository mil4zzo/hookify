-- Rollback da 182 (duplicação de campanha). Apaga os lançamentos e a biblioteca de
-- mídias enviadas; as mídias continuam na biblioteca da conta na Meta.
-- Volte o backend ANTES: /campaign-launch usa as duas tabelas.
BEGIN;
DROP TABLE IF EXISTS public.campaign_launch_items;
DROP TABLE IF EXISTS public.ad_media_library;
COMMIT;
