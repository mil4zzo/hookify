-- Adiciona coluna slot_media para o fluxo de duplicação de campanhas.
-- Estrutura: jsonb com { "slot_key": file_index, ... }
-- Diferente de slot_files (usado no fluxo de criação de anúncios/bundles),
-- slot_media é resolvido pelo campaign_bulk_service pelo slot_key do template.
alter table public.bulk_ad_items
  add column if not exists slot_media jsonb;
