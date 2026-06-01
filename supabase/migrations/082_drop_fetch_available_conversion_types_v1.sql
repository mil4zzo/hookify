-- 082_drop_fetch_available_conversion_types_v1.sql
--
-- Remove a RPC dedicada de conversion types, agora órfã.
--
-- Substituída pela materialização em packs.conversion_types (migration 081):
-- a lista é mantida via union incremental no refresh (upsert_ad_metrics) e o dropdown
-- do Manager deriva da união dos packs selecionados — sem RPC no read-path.
-- O endpoint /analytics/conversion-types e o hook useConversionTypes já foram removidos do código.
--
-- OPCIONAL e seguro: nada mais chama esta função. Aplique quando confortável.

DROP FUNCTION IF EXISTS public.fetch_available_conversion_types_v1(
  uuid, date, date, uuid[], text[], text, text, text
);
