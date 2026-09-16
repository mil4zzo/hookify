/**
 * Teto de linhas pedido pelas telas de análise (Manager, Boards, Explorer, Insights,
 * GOLD, Plano). Nenhuma tela corta dados: é rede de segurança, igual ao teto da função
 * do banco (`fetch_manager_rankings_v161`, 100 mil). Um teto menor aqui corta em silêncio
 * — as somas e listas calculadas no navegador passam a enxergar só a fatia de maior gasto
 * (o `limit: 1000` do Explorer/Insights e o `limit: 10000` do Manager fizeram isso).
 */
export const ANALYTICS_ALL_ROWS_LIMIT = 100000;
