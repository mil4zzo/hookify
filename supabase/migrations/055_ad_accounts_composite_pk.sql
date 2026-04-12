-- Migration 055: ad_accounts — chave primária composta (id, user_id)
--
-- Problema: a tabela ad_accounts tinha id (facebook account id) como PK única,
-- o que fazia com que o upsert de um segundo usuário com acesso à mesma conta
-- sobrescrevesse o user_id do registro, desvinculando o usuário anterior.
--
-- Solução: promover a PK para (id, user_id), permitindo que múltiplos usuários
-- do Hookify sejam vinculados à mesma ad account do Facebook independentemente.
--
-- Impacto no backend: supabase_repo.upsert_ad_accounts já foi atualizado para
-- usar on_conflict="id,user_id".

-- 1. Remover a PK atual
ALTER TABLE public.ad_accounts DROP CONSTRAINT ad_accounts_pkey;

-- 2. Adicionar PK composta
ALTER TABLE public.ad_accounts ADD PRIMARY KEY (id, user_id);

-- 3. Adicionar índice em user_id para manter performance nas queries por usuário
--    (antes era coberto pelo pkey index de id; agora o pkey cobre (id, user_id))
CREATE INDEX IF NOT EXISTS ad_accounts_user_idx ON public.ad_accounts (user_id);
