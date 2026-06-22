-- Migration: Add target_cpr to user_preferences
-- Permite que o usuário configure o custo-por-resultado alvo por tipo de conversão.
-- Usado pelo Plano de Ação (to-do list v0) para vereditos absolutos (cascata §8.6).
-- Formato: { "purchase": 15.00, "lead": 8.50 } — chave = action_type, valor = CPR alvo em moeda local.

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS target_cpr jsonb DEFAULT '{}';

COMMENT ON COLUMN public.user_preferences.target_cpr IS
  'CPR alvo por action_type (ex: {"purchase": 15.00, "lead": 8.50}). Usado pelo Plano de Ação para vereditos absolutos. Quando ausente, o plano usa modo relativo (vs. média do pack).';
