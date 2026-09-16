/**
 * Teto de linhas pedido pelas telas de análise (Manager, Boards, Explorer, Insights,
 * GOLD, Plano). Nenhuma tela corta dados: é rede de segurança, igual ao teto da função
 * do banco (`fetch_manager_rankings_v161`, 100 mil). Um teto menor aqui corta em silêncio
 * — as somas e listas calculadas no navegador passam a enxergar só a fatia de maior gasto
 * (o `limit: 1000` do Explorer/Insights e o `limit: 10000` do Manager fizeram isso).
 */
export const ANALYTICS_ALL_ROWS_LIMIT = 100000;

/**
 * Quanto o navegador espera uma leitura de análise (Manager, detalhes, variações,
 * séries). A ordem é: banco desiste primeiro (20 s; a função do Manager, 40 s —
 * migration 164), depois o backend (25 s / 45 s), por último o navegador. Os 2 min
 * do cliente geral só apareceriam num backend travado — aqui o erro chega em 1 min.
 */
export const ANALYTICS_REQUEST_TIMEOUT_MS = 60_000
