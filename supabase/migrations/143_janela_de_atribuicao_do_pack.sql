-- 143: o pack passa a saber a propria janela de atribuicao — e o refresh recua por ela
-- ============================================================================
--
-- PROBLEMA (medido em 2026-09-06, pack "EI.30 - CA4 Cap", act_375919623592885)
-- O /insights da Meta data a conversao pelo DIA EM QUE ELA ACONTECEU, mas so a
-- conta se o clique que a originou estiver DENTRO da janela consultada. O refresh
-- incremental pede `last_refreshed_at - 1 dia -> hoje`: um clique de 3 dias atras
-- que converte hoje fica fora da janela e a conversao nunca entra no banco — o
-- dia e gravado uma vez e congela. Gasto continua exato ao centavo (a Meta so
-- deixa de contar a conversao), por isso nenhuma conferencia de gasto acusa.
--
-- Tamanho do estrago, chave a chave banco x consulta unica do periodo (que e o
-- que o Gerenciador de Anuncios mostra — conferido na UI):
--   Captura_Evento (converte no mesmo dia)   213.057 vs 213.470   -0,19%
--   TYP_PreMatricula (converte dias depois)      725 vs     848   -14,5%
-- As 123 pre-matriculas que faltam sao 100% linhas que NAO EXISTEM no banco
-- (dia sem entrega, so com a conversao tardia) — nunca "linha com valor menor".
--
-- O QUE MUDA
-- O recuo deixa de ser 1 dia fixo e passa a ser a janela de atribuicao da conta,
-- que a propria Meta devolve por linha no campo `attribution_setting`
-- (`1d_view_7d_click`, `7d_click`, `1d_click`, ...). O maior valor visto nas
-- linhas do pack e gravado aqui a cada carga; o refresh seguinte recua por ele.
--   * `attribution_window_days`: o numero usado como recuo (7 nas contas atuais).
--     NULL = pack que ainda nao foi carregado depois desta migration; o codigo
--     cai no teto atual da Meta (7) ate a primeira carga calibrar.
--   * `attribution_setting`: o valor cru, para a UI mostrar de onde veio o numero.
--
-- POR QUE POR PACK, E NAO FIXO
-- A janela e do CONJUNTO de anuncios, entao clientes diferentes pagam recuos
-- diferentes: quem usa 1 dia nao deve pagar 7 dias de releitura todo dia (o recuo
-- de 7 quadruplica as linhas lidas: 1.645 -> 6.585 na consulta diaria medida).
--
-- COMPATIBILIDADE
-- Colunas novas, nulas, sem default: nenhuma leitura existente muda. O backend
-- trata NULL como "7"; o frontend mostra "—" ate a primeira carga.
-- ============================================================================

alter table public.packs
  add column if not exists attribution_window_days integer,
  add column if not exists attribution_setting text;

comment on column public.packs.attribution_window_days is
  'Recuo (dias) do refresh incremental = maior janela de atribuicao vista nas linhas do pack. NULL = ainda nao calibrado (codigo usa 7).';
comment on column public.packs.attribution_setting is
  'Valor cru do attribution_setting da Meta que originou attribution_window_days (ex.: 1d_view_7d_click).';
