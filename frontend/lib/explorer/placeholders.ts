import type { ExplorerPlaceholderPresentation } from "./types";

export const explorerPlaceholderPresentation: ExplorerPlaceholderPresentation = {
  statusLabel: "Sem classificacao",
  qualificationLabel: "Sem score",
  summary: "Classificacao, insights e acoes automaticas ficam para a proxima etapa. Nesta fase, o Explorer mostra apenas dados reais e metricas disponiveis.",
  insights: [
    {
      title: "Insights automaticos em breve",
      detail: "Esta area permanece como placeholder visual enquanto conectamos a camada analitica.",
      tone: "neutral",
    },
    {
      title: "Sem leitura automatica nesta versao",
      detail: "Os dados abaixo ja sao reais, mas ainda sem interpretacao textual automatizada.",
      tone: "neutral",
    },
  ],
  actions: [
    {
      title: "Acoes recomendadas em breve",
      detail: "As proximas iteracoes vao reutilizar a mesma base de dados para sugerir proximos passos.",
      tone: "neutral",
    },
    {
      title: "Sem classificacao acionavel por enquanto",
      detail: "Por enquanto, use o breakdown de metricas reais para leitura manual do criativo.",
      tone: "neutral",
    },
  ],
  retentionStage: {
    label: "Retencao",
    score: "—",
    description: "Placeholder temporario ate a camada de score ser implementada.",
    tone: "neutral",
  },
  funnelStage: {
    label: "Funil",
    score: "—",
    description: "Placeholder temporario ate a camada de score ser implementada.",
    tone: "neutral",
  },
  resultsStage: {
    label: "Resultados",
    score: "—",
    description: "Placeholder temporario ate a camada de score ser implementada.",
    tone: "neutral",
  },
};
