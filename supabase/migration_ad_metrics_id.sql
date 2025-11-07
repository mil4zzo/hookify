-- Migration: Alterar ad_metrics.id de bigserial para text composto
-- Execute este script no Supabase SQL Editor APENAS se a tabela já existir com id bigserial
-- Para novas instalações, o schema.sql já está atualizado

-- IMPORTANTE: Faça backup dos dados antes de executar esta migração!

-- Verificar se já está no formato correto (id text) ou se precisa migrar (id bigserial)
DO $$
DECLARE
    current_type text;
BEGIN
    -- Verificar o tipo atual da coluna id
    SELECT data_type INTO current_type
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'ad_metrics'
      AND column_name = 'id';
    
    -- Se já for text, não precisa fazer nada
    IF current_type = 'text' THEN
        RAISE NOTICE 'Coluna id já está como text. Nenhuma migração necessária.';
        RETURN;
    END IF;
    
    -- Se não existir a tabela, não fazer nada
    IF current_type IS NULL THEN
        RAISE NOTICE 'Tabela ad_metrics não existe ou não tem coluna id. Use schema.sql para criar.';
        RETURN;
    END IF;
    
    -- Se for bigint/bigserial, precisa migrar
    IF current_type IN ('bigint', 'bigserial') THEN
        RAISE NOTICE 'Iniciando migração de id bigserial para text composto...';
        
        -- 1. Criar coluna temporária e preencher
        ALTER TABLE public.ad_metrics ADD COLUMN IF NOT EXISTS id_new text;
        UPDATE public.ad_metrics SET id_new = date::text || '-' || ad_id WHERE id_new IS NULL;
        
        -- 2. Remover constraint da primary key antiga
        ALTER TABLE public.ad_metrics DROP CONSTRAINT IF EXISTS ad_metrics_pkey;
        
        -- 3. Remover a coluna id antiga
        ALTER TABLE public.ad_metrics DROP COLUMN IF EXISTS id;
        
        -- 4. Renomear a coluna nova para id
        ALTER TABLE public.ad_metrics RENAME COLUMN id_new TO id;
        
        -- 5. Adicionar a primary key na nova coluna
        ALTER TABLE public.ad_metrics ADD PRIMARY KEY (id);
        
        -- 6. Recriar constraint única (ad_id, date)
        DROP INDEX IF EXISTS public.ad_metrics_unique_day;
        CREATE UNIQUE INDEX IF NOT EXISTS ad_metrics_unique_day ON public.ad_metrics(ad_id, date);
        
        RAISE NOTICE 'Migração concluída com sucesso!';
    ELSE
        RAISE WARNING 'Tipo inesperado para coluna id: %. Verifique manualmente.', current_type;
    END IF;
END $$;

-- Verificar resultado
SELECT 
    column_name, 
    data_type, 
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'ad_metrics'
  AND column_name = 'id';
