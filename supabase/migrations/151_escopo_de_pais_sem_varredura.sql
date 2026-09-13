-- ===========================================================================
-- 151. O escopo de pais deixa de ser uma varredura de `ads`.
--
-- POR QUE
-- -------
-- `upsert_parent_entities` precisa de uma coisa só: quais campanhas e conjuntos
-- têm anúncio importado — o filtro de escopo que impede o snapshot de conta
-- inteira de gravar milhares de pais que o Hookify não acompanha.
--
-- Para responder isso, `_fetch_present_parent_ids` baixava a tabela `ads`
-- INTEIRA do usuário (46.581 linhas), de mil em mil, e descartava tudo menos
-- duas colunas. Rodava em todo refresh e no sync on-focus (5 min por pack).
--
-- Medido em produção (pg_stat_statements, 26/08 a 09/09 — 14 dias):
--   175.008 chamadas, 5.011 s de banco. O MAIOR CONSUMIDOR do banco inteiro,
--   com folga sobre a RPC do Manager (3.588 s) e o grafo de conflito (1.075 s).
--
-- E a forma da paginação piorava tudo: `.range()` do PostgREST vira LIMIT/OFFSET,
-- e o Postgres precisa produzir e jogar fora tudo que veio antes.
--   OFFSET      0 ->  2,0 ms
--   OFFSET 20.000 -> 34,3 ms
--   OFFSET 40.000 -> 59,0 ms
--   OFFSET 60.000 -> 53,7 ms lendo 22.151 buffers para devolver ZERO linhas
-- Varredura completa: 47 páginas, ~1,4 s de banco, 47 idas e voltas HTTP.
--
-- MEDIDO PARA ESCOLHER A FORMA DA CONSULTA (produção, 09/09)
-- ---------------------------------------------------------
--   array_agg(distinct ...) direto sobre as 46.581 linhas ... 468 ms
--     (ordena em disco: "external merge Disk: 2200kB")
--   distinct dos PARES primeiro, agrega os 5.090 sobreviventes ... 84 ms
--     (HashAggregate, 593 kB de memória, nenhum arquivo temporário)
-- É a segunda que está aqui: reduzir antes de agregar tira o sort do caminho.
--
--   47 idas e ~1.400 ms  ->  1 ida e 84 ms.
--
-- POR QUE NÃO FILTRAR PELOS IDS PERGUNTADOS (a ideia original, descartada)
-- -----------------------------------------------------------------------
-- Seria `where campaign_id = any($2)`, com os ids que o chamador já tem. Mais
-- barato no papel, INSEGURO na prática pelo PostgREST: ele devolveria uma linha
-- por ANÚNCIO (não por campanha), e o teto silencioso de 1.000 linhas cortaria a
-- resposta sem erro. Campanhas de verdade sumiriam do escopo e teriam orçamento
-- e status não gravados — perda de dado silenciosa, que é exatamente a classe de
-- bug que este projeto já pagou caro para aprender a não repetir.
-- Com a agregação no servidor, a resposta é um par de arrays: não há linhas para
-- truncar.
--
-- POR QUE NÃO UM ÍNDICE COBRINDO (user_id) INCLUDE (campaign_id, adset_id)
-- -----------------------------------------------------------------------
-- Levaria os 84 ms para talvez 20 ms, tornando a leitura index-only. Mas `ads` é
-- upsertada em massa a cada refresh (3.725 chamadas, 119 ms de média) e todo
-- índice novo é imposto a TODA escrita. 84 ms uma vez por refresh não é mais o
-- problema — otimizá-lo seria pagar na escrita por um ganho que ninguém sente.
-- Se um dia a leitura voltar a pesar, o índice está aqui documentado.
--
-- SEGURANÇA: SECURITY INVOKER (o default), DE PROPÓSITO
-- ----------------------------------------------------
-- Esta função NÃO é SECURITY DEFINER e não ganha guarda de `auth.uid()`, porque
-- precisa se comportar EXATAMENTE como o `select` direto que ela substitui, nos
-- dois clientes que a chamam (`supabase_repo._get_sb`):
--   - cliente com JWT do usuário -> a RLS de `ads` (`user_id = auth.uid()`) se
--     aplica normalmente; pedir o silo de outro devolve vazio, como hoje.
--   - service role (convenção P3.3b: caminho de pack COMPARTILHADO, escrita no
--     silo do dono) -> ignora RLS, como hoje, e o `p_user_id` explícito é o silo.
-- Marcar SECURITY DEFINER aqui CRIARIA um vazamento que hoje não existe: daria
-- ao portador de qualquer JWT a leitura do inventário de qualquer silo.
-- ===========================================================================
BEGIN;

DROP FUNCTION IF EXISTS public.present_parent_ids(uuid);

CREATE FUNCTION public.present_parent_ids(p_user_id uuid)
RETURNS TABLE (campaign_ids text[], adset_ids text[])
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  -- O `distinct` dos pares primeiro é o que evita o sort em disco: 46.581 linhas
  -- viram ~5.090 pares distintos, e só esses chegam ao array_agg.
  with pares as (
    select distinct campaign_id, adset_id
    from public.ads
    where user_id = p_user_id
  )
  select
    coalesce(array_agg(distinct campaign_id) filter (where campaign_id is not null), '{}'::text[]),
    coalesce(array_agg(distinct adset_id)    filter (where adset_id    is not null), '{}'::text[])
  from pares;
$$;

COMMENT ON FUNCTION public.present_parent_ids(uuid) IS
  'Campanhas e conjuntos com anúncio importado no silo do usuário, como dois arrays. '
  'Filtro de escopo de upsert_parent_entities. SECURITY INVOKER de propósito: a RLS de '
  '`ads` vale para o cliente com JWT, e o service role usa p_user_id como silo explícito '
  '(convenção P3.3b). Ver migration 151.';

GRANT EXECUTE ON FUNCTION public.present_parent_ids(uuid) TO authenticated, service_role;

COMMIT;
