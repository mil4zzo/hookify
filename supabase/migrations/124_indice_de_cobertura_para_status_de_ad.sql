-- 124: `ads_user_adid_idx` vira indice de COBERTURA (substituicao, nao adicao).
--
-- ACHADO (EXPLAIN da RPC do Manager, 2026-08-25)
-- ----------------------------------------------
-- A funcao e plpgsql, entao EXPLAIN na chamada so mostra "Result". Para ver o
-- plano de dentro, a consulta principal do `_base_v116` foi reconstruida como
-- SQL puro com parametros reais (3 packs, 42 dias, usuario com 119k linhas de
-- metrica) e medida com EXPLAIN (ANALYZE, BUFFERS).
--
-- O CTE `status_agg` faz um join a `ads` para CADA (group_key, ad_id, user_id)
-- distinto — 13.141 buscas — para produzir 77 linhas de resultado. O planner
-- estimava 200 linhas onde havia 13.141 (erro de 65x, tipico de fronteira de
-- CTE, onde as estatisticas se perdem) e escolhia laco aninhado com
-- `Index Scan using ads_pkey`: 0,435 ms por busca = ~5,7 s.
--
-- Cada busca ia ao heap so para ler `effective_status` e `meta_created_time`.
-- Com essas duas colunas em INCLUDE, vira `Index Only Scan` e o heap sai do
-- caminho.
--
-- MEDIDO (A/B sob cache identico: DROP do indice dentro de transacao revertida)
--   sem cobertura: 6.829 / 7.580 / 8.463 ms
--   com cobertura: 3.411 / 3.443 / 3.449 ms
--   => 2,2x mais rapido na consulta principal do Manager
--
-- POR QUE SUBSTITUIR EM VEZ DE ADICIONAR
-- --------------------------------------
-- `ads_user_adid_idx` era exatamente (user_id, ad_id). O novo tem o MESMO
-- prefixo, entao atende toda consulta que o antigo atendia. Manter os dois
-- seria pagar escrita duas vezes pela mesma chave. Bonus: o novo saiu MENOR
-- (5.528 kB contra 8.432 kB) — o antigo estava inchado.
--
-- CUSTO DE ESCRITA, MEDIDO (nao estimado)
-- ---------------------------------------
-- Coluna em INCLUDE conta como indexada para efeito de HOT (Heap-Only Tuple).
-- Medido com UPDATE de valor DIFERENTE em 500 linhas, dentro de transacao
-- revertida: a taxa de HOT em `ads` cai de 37% para 0%.
--
-- O impacto em tempo, porem, e pequeno: 59 ms com o indice contra 57 ms sem,
-- para o mesmo lote de 500 linhas. Perder HOT importa menos aqui porque `ads`
-- tem 70k linhas e o custo por UPDATE ja e dominado pelo heap.
--
-- Trade explicito: ~2 ms a mais por lote de escrita de status, em troca de
-- ~4,2 s por consulta do Manager. Registrado para que a conta possa ser
-- refeita se `ads` crescer uma ordem de grandeza.
--
-- CONCURRENTLY: nao pode rodar dentro de transacao. Se o runner de migration
-- envolver tudo num BEGIN, rodar este arquivo via psql direto.

CREATE INDEX CONCURRENTLY IF NOT EXISTS ads_user_ad_status_idx
  ON public.ads (user_id, ad_id)
  INCLUDE (effective_status, meta_created_time);

DROP INDEX CONCURRENTLY IF EXISTS ads_user_adid_idx;

COMMENT ON INDEX public.ads_user_ad_status_idx IS
'Substitui ads_user_adid_idx (mesmo prefixo user_id, ad_id). As colunas em INCLUDE fazem o status_agg do wrapper do Manager virar Index Only Scan: 13.141 buscas por chamada deixam de ir ao heap (medido 2,2x na consulta principal). Custo: zera a taxa de HOT em UPDATE de effective_status (37% -> 0%), impacto medido de ~2 ms por lote de 500 linhas.';
