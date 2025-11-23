-- Migration: Add mql_leadscore_min to user_preferences
-- Permite que o usuário configure o leadscore mínimo para considerar um lead como MQL (Marketing Qualified Lead)

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS mql_leadscore_min numeric DEFAULT 0;

COMMENT ON COLUMN public.user_preferences.mql_leadscore_min IS 
  'Leadscore mínimo para considerar um lead como MQL (Marketing Qualified Lead). Valores >= este número são considerados MQLs. Usado para calcular quantidade de MQLs e custo por MQL.';

