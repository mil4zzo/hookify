-- 123: `ads.campaign_status` / `ads.adset_status` deixam de ter escritor (passo 3).
--
-- Nao ha DDL aqui. A mudanca real e no backend (o codigo parou de escrever essas
-- colunas); esta migration existe para que o SCHEMA conte a verdade — os
-- comentarios da 122 diziam "ainda escrito, como rede de rollback", o que deixou
-- de valer.
--
-- POR QUE
-- -------
-- Para registrar o status de 1.188 campanhas o backend reescrevia 70.982 linhas
-- de `ads` (59,7x de amplificacao; nos conjuntos, 19,4x), com ~11 MB de WAL por
-- UPDATE. Medido com pg_stat_statements, os dois UPDATEs de status de pai
-- somavam 22% de todo o tempo de banco do app.
--
-- Desde a migration 122 a fonte lida e `parent_entities` (UMA linha por pai).
-- Verificado antes de cortar: ZERO leitores das colunas em todo o sistema —
-- nenhuma funcao, view, policy ou indice (pg_proc/pg_class/pg_policy/pg_index),
-- nada no frontend, e no backend so restavam as escritas.
--
-- O QUE SAIU DO BACKEND
-- ---------------------
--   * `supabase_repo.write_parent_statuses` — REMOVIDA (era a fonte da
--     amplificacao: UPDATE por parent_id em todas as linhas de ad do pai)
--   * o UPDATE da coluna do pai no toggle unico e no toggle em lote
--   * a anulacao de `ads.adset_status` apos toggle de campanha (o equivalente
--     em `parent_entities` continua, via clear_parent_entity_adset_statuses)
--   * o encanamento morto que restou: `parent_statuses` do enricher ao
--     job_processor, e `fetch_parent_statuses` (que ja estava sem caller)
--
-- CONTINUA ESCRITO E LIDO: `ads.effective_status` — status do PROPRIO anuncio,
-- coisa diferente. E ele que alimenta a cascata de marcadores usada como
-- fallback pelo wrapper quando um pai nao tem linha em `parent_entities`.
--
-- ROLLBACK (mudou de forma — ler antes de precisar)
-- --------------------------------------------------
-- Ate a 122, reverter era trivial: as colunas seguiam frescas. Agora nao ha
-- escritor, entao elas congelam no estado de 2026-08-25 e envelhecem.
-- Reverter exige TRES passos, nesta ordem:
--   1. reverter o commit do passo 3 no backend (volta a escrever as colunas)
--   2. rodar um refresh de pack / sync on-focus por conta, para repovoa-las
--   3. so entao reverter a 122 (a leitura volta para `ads`)
-- Pular o passo 2 faz a tela exibir status congelado.
--
-- AS COLUNAS NAO SAO DROPADAS AQUI, de proposito: enquanto existirem, o caminho
-- de rollback acima e possivel. O DROP e uma terceira migration, depois de a
-- 122+123 rodarem em uso real sem incidente.

COMMENT ON COLUMN public.ads.adset_status IS
'MORTA desde a migration 123: sem leitor (desde a 122) e sem escritor. Os valores estao congelados no estado de 2026-08-25 e envelhecem — NAO usar. Verdade do status do conjunto: parent_entities.effective_status. Mantida apenas para viabilizar rollback da 122; DROP em migration futura.';

COMMENT ON COLUMN public.ads.campaign_status IS
'MORTA desde a migration 123: sem leitor (desde a 122) e sem escritor. Os valores estao congelados no estado de 2026-08-25 e envelhecem — NAO usar. Verdade do status da campanha: parent_entities.effective_status. Mantida apenas para viabilizar rollback da 122; DROP em migration futura.';

COMMENT ON COLUMN public.ads.effective_status IS
'effective_status do PROPRIO anuncio (nao confundir com o status do pai, que vive em parent_entities). Continua escrito e lido: alimenta a cascata de marcadores ADSET_PAUSED/CAMPAIGN_PAUSED usada como fallback pelo wrapper do Manager.';
