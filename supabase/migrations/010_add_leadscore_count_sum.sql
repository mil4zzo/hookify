-- Migration: Add leadscore_values array to ad_metrics
-- Armazena array de leadscores individuais para aquele ad_id naquela date
-- Permite calcular média correta, soma, contagem, etc. quando há múltiplas datas
-- Exemplo: [24, 100, 80, 19] = 4 leads com leadscores 24, 100, 80, 19
-- Média = SUM(leadscore_values) / array_length(leadscore_values, 1)
-- Soma = SUM(leadscore_values)
-- Count = array_length(leadscore_values, 1)

ALTER TABLE public.ad_metrics
  ADD COLUMN IF NOT EXISTS leadscore_values numeric[];

-- Comentário para documentação
COMMENT ON COLUMN public.ad_metrics.leadscore_values IS 
  'Array de leadscores individuais daquele ad_id naquela date. Permite calcular média correta quando há múltiplas datas. Exemplo: [24, 100, 80, 19] representa 4 leads com leadscores 24, 100, 80, 19. Média = SUM(leadscore_values) / array_length(leadscore_values, 1)';

