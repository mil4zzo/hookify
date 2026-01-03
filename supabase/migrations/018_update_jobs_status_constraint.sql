-- Migration: Atualizar constraint de status da tabela jobs
-- Adiciona novos status para arquitetura "2 fases" de processamento

-- Remover constraint antiga
ALTER TABLE public.jobs 
DROP CONSTRAINT IF EXISTS jobs_status_check;

-- Adicionar nova constraint com todos os status permitidos
ALTER TABLE public.jobs 
ADD CONSTRAINT jobs_status_check 
CHECK (status IN (
  -- Status antigos (mantidos para compatibilidade)
  'pending',
  'running',
  'completed',
  'failed',
  'error',
  -- Novos status para arquitetura "2 fases"
  'meta_running',      -- Meta API ainda processando
  'meta_completed',    -- Meta terminou, aguardando processamento interno
  'processing',        -- Coletando/paginando/enriquecendo/formatando
  'persisting',        -- Gravando ads/metrics/pack/stats
  'cancelled'          -- Cancelado pelo usuário
));

-- Comentário para documentação
COMMENT ON CONSTRAINT jobs_status_check ON public.jobs IS 
'Status permitidos para jobs. Novos status (meta_running, meta_completed, processing, persisting, cancelled) foram adicionados para suportar arquitetura "2 fases" de processamento.';
































