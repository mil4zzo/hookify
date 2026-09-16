-- ===========================================================================
-- 159 — o banco desiste antes do cliente (fim da consulta órfã)
-- ===========================================================================
--
-- O PROBLEMA, EM UMA FRASE
-- ------------------------
-- Quando o backend desiste de esperar antes do banco, a consulta CONTINUA
-- rodando lá dentro. O usuário recebeu o erro, ninguém vai ler o resultado, e
-- o banco segue queimando CPU até o próprio teto — a "consulta órfã".
--
-- Medido em produção em 2026-09-15: um cliente que desiste em 0,15 s de uma
-- leitura de ~3 s deixa a consulta rodando por mais de 1 s depois. No incidente
-- de 14/09 ("Erro ao carregar variações."), com o backend repetindo 4 vezes,
-- isso virou até 4 cópias da mesma consulta de 18 s no banco ao mesmo tempo —
-- carga extra exatamente no momento em que ele já estava apertado.
--
-- COMO ESTAVA (medido em 15/09)
-- -----------------------------
--   caminho                         teto do banco   teto do cliente   resultado
--   ------------------------------- --------------- ----------------- ---------
--   Manager /rankings               30 s            35 s              ok
--   detalhe / variações             30 s            15 s              ÓRFÃ
--   detect_pack_conflicts           25 s (função)   15 s              ÓRFÃ
--   refresh (service_role)           8 s            15 s              ok
--
-- As duas linhas desalinhadas são exatamente as duas que deram problema.
--
-- A REGRA QUE PASSA A VALER
-- -------------------------
-- O teto do BANCO é sempre menor que o teto do CLIENTE. Duas consequências
-- boas, além de acabar com a órfã:
--   1. o erro que chega ao backend passa a ser `57014 statement timeout`, que
--      é inequívoco ("o banco desistiu") em vez de um ReadTimeout ambíguo
--      ("não sei se ele ainda está trabalhando");
--   2. 57014 já é tratado como NÃO repetível em todo o backend — então a
--      correção do banco e a do retry se reforçam em vez de brigarem.
--
-- POR QUE NO PAPEL, E NÃO FUNÇÃO POR FUNÇÃO
-- -----------------------------------------
-- Carimbar `statement_timeout` em cada função deixaria de fora as leituras que
-- não passam por função (`sb.table(...).select(...)`, a paginação de 1.000 em
-- 1.000). O papel cobre tudo e não pode ser esquecido numa função nova — é a
-- mesma lição da 158: o que depende de lembrar, se perde.
--
-- POR QUE 20 s
-- ------------
-- É teto de absurdo, não orçamento de trabalho. Depois do F5 e da 157, as
-- leituras do app medem: manager base 1,2 s, detalhe de entidade 0,35 s,
-- conflitos 0,5–0,8 s, série 0,22 s de média. 20 s é ~16x a mais lenta delas.
-- Uma tela que passa disso já está quebrada para quem está olhando: melhor um
-- erro claro em 20 s do que um spinner de 30 s que termina em erro do mesmo
-- jeito. Os piores casos históricos (27,9 s em rankings_core_v2, 29,7 s no
-- detalhe) são de ANTES dessas correções.
--
-- O frontend espera 2 minutos (axios), então ele não é o limitante em momento
-- nenhum desta cadeia.
--
-- NÃO MEXE em `authenticator`/`service_role` (8 s): esse lado já está alinhado,
-- e é por onde passam as ESCRITAS do refresh.
--
-- COMO CONFERIR (e a armadilha que pega quem tenta)
-- -------------------------------------------------
-- NÃO adianta `set role authenticated; select pg_sleep(25);` no psql: passa
-- direto. Configuração de papel (`rolconfig`) é aplicada no LOGIN, e `SET ROLE`
-- não é login — a sessão continua com o `statement_timeout` de quem conectou
-- (2 min, como `postgres`). Tentado em 15/09; o pg_sleep(25) completou.
--
-- `authenticated` nem sequer tem login: quem conecta é o `authenticator`. Quem
-- aplica o teto é o PostgREST, que lê `pg_db_role_setting` e o aplica por
-- transação, junto com o `SET LOCAL ROLE`. Então confira na fonte:
--
--     select r.rolname, s.setconfig
--     from pg_db_role_setting s join pg_roles r on r.oid = s.setrole
--     where r.rolname in ('anon','authenticated','authenticator');
--
-- Que o mecanismo atua de verdade já está provado pelo histórico do app: as
-- queries do Manager (papel `authenticated`) morriam com `57014` no cliff de
-- generic plan. 57014 é o teto do papel agindo.
--
-- SE PRECISAR VOLTAR ATRÁS
-- ------------------------
--   alter role authenticated set statement_timeout = '30s';
--   alter function public.detect_pack_conflicts(uuid[], uuid) set statement_timeout = '25s';
-- O sintoma que pediria isso: 57014 aparecendo em leitura legítima de usuário
-- grande. Nesse caso o certo é subir o teto E abrir tarefa para a consulta.
-- ===========================================================================

-- 1) Teto geral das leituras feitas com o JWT do usuário.
ALTER ROLE authenticated SET statement_timeout = '20s';

-- 2) A única função com teto próprio entra na mesma régua. Ela roda como
--    service_role (que herda 8 s do authenticator); o carimbo de 25 s existia
--    para dar folga a ela, e continua existindo — agora sob o teto do cliente.
ALTER FUNCTION public.detect_pack_conflicts(uuid[], uuid)
  SET statement_timeout TO '20s';

-- Prova no próprio arquivo: falha alto se algum dos dois não pegou.
DO $$
DECLARE
  v_papel text[];
  v_func  text[];
BEGIN
  SELECT rolconfig INTO v_papel FROM pg_roles WHERE rolname = 'authenticated';
  IF v_papel IS NULL OR NOT ('statement_timeout=20s' = ANY(v_papel)) THEN
    RAISE EXCEPTION '159: statement_timeout não ficou no papel authenticated. rolconfig=%', v_papel;
  END IF;

  SELECT proconfig INTO v_func
  FROM pg_proc WHERE oid = 'public.detect_pack_conflicts(uuid[], uuid)'::regprocedure;
  IF v_func IS NULL OR NOT ('statement_timeout=20s' = ANY(v_func)) THEN
    RAISE EXCEPTION '159: statement_timeout não ficou em detect_pack_conflicts. proconfig=%', v_func;
  END IF;
END;
$$;
