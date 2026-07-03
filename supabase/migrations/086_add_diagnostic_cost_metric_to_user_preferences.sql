-- Migration: Add diagnostic_cost_metric to user_preferences
-- Persiste a métrica de custo escolhida pelo usuário no bloco de comparação dia-a-dia
-- do /plano (Widget 1 caret CPMQL/CPR). Controla os 3 widgets juntos.
-- Valores: 'cpr' (custo por resultado do evento selecionado) ou 'cpmql' (custo por MQL).
-- Quando 'cpmql' é escolhido sem dado de MQL nos dois dias, o app faz fallback para 'cpr'.

ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS diagnostic_cost_metric text DEFAULT 'cpr';

COMMENT ON COLUMN public.user_preferences.diagnostic_cost_metric IS
  'Métrica de custo escolhida no bloco de comparação do /plano: ''cpr'' ou ''cpmql''. Default ''cpr''. CPMQL exige dado de MQL; senão o app cai para CPR.';
