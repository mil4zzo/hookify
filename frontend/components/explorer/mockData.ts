export type ExplorerAdStatus = "Gold" | "Otimizável" | "Lição" | "Descartável";

export type ExplorerTone = "positive" | "warning" | "critical" | "neutral";

export interface ExplorerSignalItem {
  title: string;
  detail: string;
  tone: ExplorerTone;
}

export interface ExplorerMetricChip {
  label: string;
  value: string;
  tone?: ExplorerTone;
}

export interface ExplorerStageCard {
  label: string;
  score: string;
  description: string;
  tone: ExplorerTone;
}

export interface ExplorerAdRecord {
  id: string;
  name: string;
  campaignName: string;
  accountName: string;
  summary: string;
  status: ExplorerAdStatus;
  score: number;
  scoreLabel: string;
  previewUrl: string | null;
  previewCaption: string;
  insights: ExplorerSignalItem[];
  actions: ExplorerSignalItem[];
  retentionMetrics: ExplorerMetricChip[];
  funnelMetrics: ExplorerMetricChip[];
  efficiencyMetrics: ExplorerMetricChip[];
  retentionStage: ExplorerStageCard;
  funnelStage: ExplorerStageCard;
  efficiencyStage: ExplorerStageCard;
}

export const explorerMockAds: ExplorerAdRecord[] = [
  {
    id: "ad-ugc-caderno",
    name: "UGC Planner | Dor forte | 15s",
    campaignName: "Planner Pro | Conversão",
    accountName: "Hookify Performance",
    summary: "Criativo com boa retenção inicial, mas perde força quando o usuário chega na etapa de clique e conexão.",
    status: "Otimizável",
    score: 6.4,
    scoreLabel: "Precisa de ajustes pontuais para voltar a escalar.",
    previewUrl: null,
    previewCaption: "Preview vertical do criativo principal selecionado.",
    insights: [
      {
        title: "Hook forte, meio de funil fraco",
        detail: "O anúncio segura atenção no começo, mas o ganho de intenção cai antes do clique qualificado.",
        tone: "warning",
      },
      {
        title: "CTR aceitável, connect rate abaixo do ideal",
        detail: "A promessa visual atrai, porém a transição para a página não sustenta o interesse no mesmo nível.",
        tone: "warning",
      },
      {
        title: "CPM controlado",
        detail: "O custo de entrega ainda não é o gargalo principal neste momento.",
        tone: "positive",
      },
    ],
    actions: [
      {
        title: "Reescrever CTA no criativo",
        detail: "Explique com mais clareza o ganho imediato do clique nos 5 segundos finais.",
        tone: "positive",
      },
      {
        title: "Testar variação de promessa",
        detail: "Substitua a copy genérica por uma dor específica que prepare melhor a transição para a página.",
        tone: "neutral",
      },
      {
        title: "Revisar dobra inicial da landing page",
        detail: "Garanta continuidade entre a promessa visual do anúncio e o primeiro bloco da página.",
        tone: "warning",
      },
    ],
    retentionMetrics: [
      { label: "Scroll Stop", value: "31%", tone: "positive" },
      { label: "Hook", value: "42%", tone: "positive" },
      { label: "Hold Rate", value: "28%", tone: "warning" },
      { label: "50% View", value: "21%", tone: "warning" },
    ],
    funnelMetrics: [
      { label: "CTR", value: "1,73%", tone: "neutral" },
      { label: "Link CTR", value: "1,24%", tone: "warning" },
      { label: "Conn Rate", value: "48%", tone: "critical" },
      { label: "Page Conv.", value: "18%", tone: "warning" },
    ],
    efficiencyMetrics: [
      { label: "CPM", value: "R$ 28,40", tone: "positive" },
      { label: "CPC", value: "R$ 1,64", tone: "warning" },
      { label: "CPR", value: "R$ 31,30", tone: "warning" },
      { label: "CPMQL", value: "R$ 74,10", tone: "critical" },
    ],
    retentionStage: {
      label: "Retention Score",
      score: "7.1/10",
      description: "A abertura prende bem, mas falta sustentação no miolo do vídeo.",
      tone: "positive",
    },
    funnelStage: {
      label: "Funnel Score",
      score: "5.3/10",
      description: "Existe interesse inicial, porém a passagem para clique qualificado ainda vaza demais.",
      tone: "warning",
    },
    efficiencyStage: {
      label: "Efficiency Lens",
      score: "6.4/10",
      description: "A entrega ainda permite teste, desde que os gargalos de conexão sejam atacados agora.",
      tone: "warning",
    },
  },
  {
    id: "ad-gold-checklist",
    name: "Checklist | Antes e depois | 22s",
    campaignName: "Checklist Viral | Scale",
    accountName: "Hookify Performance",
    summary: "Criativo equilibrado do começo ao fim, com boa retenção, clique saudável e conversão estável.",
    status: "Gold",
    score: 8.9,
    scoreLabel: "Criativo forte, pronto para escalar com segurança.",
    previewUrl: null,
    previewCaption: "Criativo com sinais consistentes em retenção e funil.",
    insights: [
      {
        title: "Narrativa consistente",
        detail: "A progressão do vídeo prepara bem o clique e reduz atrito na transição para a oferta.",
        tone: "positive",
      },
      {
        title: "Bom equilíbrio entre atenção e intenção",
        detail: "O anúncio não depende só de curiosidade; ele também conduz para ação.",
        tone: "positive",
      },
      {
        title: "Custo mantém escala viável",
        detail: "Os custos por clique e por resultado seguem proporcionais ao desempenho do funil.",
        tone: "positive",
      },
    ],
    actions: [
      {
        title: "Escalar gradualmente",
        detail: "Suba investimento com monitoramento de CPM e connect rate para preservar eficiência.",
        tone: "positive",
      },
      {
        title: "Clonar para novas audiências",
        detail: "Priorize públicos semelhantes mantendo a mesma estrutura de abertura e CTA.",
        tone: "neutral",
      },
      {
        title: "Criar variações de abertura",
        detail: "Teste hooks alternativos sem alterar a espinha do funil que já funciona.",
        tone: "neutral",
      },
    ],
    retentionMetrics: [
      { label: "Scroll Stop", value: "38%", tone: "positive" },
      { label: "Hook", value: "51%", tone: "positive" },
      { label: "Hold Rate", value: "34%", tone: "positive" },
      { label: "50% View", value: "27%", tone: "positive" },
    ],
    funnelMetrics: [
      { label: "CTR", value: "2,41%", tone: "positive" },
      { label: "Link CTR", value: "1,98%", tone: "positive" },
      { label: "Conn Rate", value: "71%", tone: "positive" },
      { label: "Page Conv.", value: "24%", tone: "positive" },
    ],
    efficiencyMetrics: [
      { label: "CPM", value: "R$ 30,20", tone: "neutral" },
      { label: "CPC", value: "R$ 1,25", tone: "positive" },
      { label: "CPR", value: "R$ 17,40", tone: "positive" },
      { label: "CPMQL", value: "R$ 39,60", tone: "positive" },
    ],
    retentionStage: {
      label: "Retention Score",
      score: "8.8/10",
      description: "Atenção forte do início ao meio do vídeo.",
      tone: "positive",
    },
    funnelStage: {
      label: "Funnel Score",
      score: "8.6/10",
      description: "Boa continuidade entre mensagem, clique e conversão.",
      tone: "positive",
    },
    efficiencyStage: {
      label: "Efficiency Lens",
      score: "8.9/10",
      description: "Escala saudável com margem para expansão controlada.",
      tone: "positive",
    },
  },
  {
    id: "ad-lesson-demo",
    name: "Demo rápida | Dashboard | 18s",
    campaignName: "Produto | Teste de Mensagem",
    accountName: "Hookify Performance",
    summary: "Criativo ensina algo importante: a demonstração gera atenção, mas a proposta de valor entra tarde demais.",
    status: "Lição",
    score: 4.8,
    scoreLabel: "Aprendizado útil, mas ainda não pronto para escala.",
    previewUrl: null,
    previewCaption: "Anúncio que sinaliza aprendizado, não necessariamente escala.",
    insights: [
      {
        title: "Boa curiosidade inicial",
        detail: "O usuário para para ver, mas demora a entender por que deve clicar.",
        tone: "warning",
      },
      {
        title: "Mensagem entra tarde",
        detail: "A clareza de benefício aparece quando parte da audiência já abandonou o vídeo.",
        tone: "critical",
      },
      {
        title: "Página converte melhor do que o anúncio sugere",
        detail: "O maior desperdício está antes do clique qualificado, não na oferta final.",
        tone: "neutral",
      },
    ],
    actions: [
      {
        title: "Antecipar benefício principal",
        detail: "Leve a transformação ou o resultado para os primeiros 3 segundos do vídeo.",
        tone: "positive",
      },
      {
        title: "Encurtar demonstração",
        detail: "Reduza blocos explicativos e deixe só o trecho que prova o ganho prometido.",
        tone: "warning",
      },
      {
        title: "Preservar aprendizado do teste",
        detail: "A estrutura de prova visual vale ser reaproveitada em uma nova versão mais agressiva.",
        tone: "neutral",
      },
    ],
    retentionMetrics: [
      { label: "Scroll Stop", value: "29%", tone: "warning" },
      { label: "Hook", value: "35%", tone: "warning" },
      { label: "Hold Rate", value: "19%", tone: "critical" },
      { label: "50% View", value: "13%", tone: "critical" },
    ],
    funnelMetrics: [
      { label: "CTR", value: "1,54%", tone: "warning" },
      { label: "Link CTR", value: "0,92%", tone: "critical" },
      { label: "Conn Rate", value: "67%", tone: "positive" },
      { label: "Page Conv.", value: "22%", tone: "positive" },
    ],
    efficiencyMetrics: [
      { label: "CPM", value: "R$ 34,80", tone: "warning" },
      { label: "CPC", value: "R$ 2,26", tone: "critical" },
      { label: "CPR", value: "R$ 34,90", tone: "warning" },
      { label: "CPMQL", value: "R$ 68,50", tone: "warning" },
    ],
    retentionStage: {
      label: "Retention Score",
      score: "4.6/10",
      description: "A promessa demora a ficar clara e a retenção sente isso.",
      tone: "critical",
    },
    funnelStage: {
      label: "Funnel Score",
      score: "5.4/10",
      description: "Quem chega à página até converte, mas poucos chegam com intenção.",
      tone: "warning",
    },
    efficiencyStage: {
      label: "Efficiency Lens",
      score: "4.8/10",
      description: "Vale como aprendizado de mensagem, não como peça pronta para escala.",
      tone: "warning",
    },
  },
  {
    id: "ad-discard-hard-sell",
    name: "Oferta direta | Desconto seco | 12s",
    campaignName: "Teste de urgência",
    accountName: "Hookify Performance",
    summary: "Criativo com baixa retenção e clique fraco; está queimando entrega sem construir intenção.",
    status: "Descartável",
    score: 2.6,
    scoreLabel: "Não vale insistir nesta versão do criativo.",
    previewUrl: null,
    previewCaption: "Criativo com sinais fracos em atenção e intenção.",
    insights: [
      {
        title: "Oferta entra sem contexto",
        detail: "O usuário recebe preço e urgência antes de entender por que deveria se importar.",
        tone: "critical",
      },
      {
        title: "Baixa retenção contamina o resto do funil",
        detail: "O criativo perde gente cedo demais para gerar cliques qualificados com consistência.",
        tone: "critical",
      },
      {
        title: "Custo já está sendo punido",
        detail: "O desempenho ruim começou a pressionar CPC e CPR ao mesmo tempo.",
        tone: "warning",
      },
    ],
    actions: [
      {
        title: "Pausar esta peça",
        detail: "Redirecione orçamento para versões que construam contexto antes da oferta.",
        tone: "warning",
      },
      {
        title: "Recomeçar pelo hook",
        detail: "Troque a entrada promocional por dor, contraste ou prova específica.",
        tone: "positive",
      },
      {
        title: "Não otimizar microdetalhes",
        detail: "O problema está na estrutura do criativo, não em ajustes finos de CTA.",
        tone: "neutral",
      },
    ],
    retentionMetrics: [
      { label: "Scroll Stop", value: "18%", tone: "critical" },
      { label: "Hook", value: "22%", tone: "critical" },
      { label: "Hold Rate", value: "11%", tone: "critical" },
      { label: "50% View", value: "7%", tone: "critical" },
    ],
    funnelMetrics: [
      { label: "CTR", value: "0,88%", tone: "critical" },
      { label: "Link CTR", value: "0,51%", tone: "critical" },
      { label: "Conn Rate", value: "41%", tone: "critical" },
      { label: "Page Conv.", value: "14%", tone: "warning" },
    ],
    efficiencyMetrics: [
      { label: "CPM", value: "R$ 41,10", tone: "critical" },
      { label: "CPC", value: "R$ 4,67", tone: "critical" },
      { label: "CPR", value: "R$ 58,20", tone: "critical" },
      { label: "CPMQL", value: "R$ 124,50", tone: "critical" },
    ],
    retentionStage: {
      label: "Retention Score",
      score: "2.9/10",
      description: "Queda muito cedo, sem construir interesse mínimo.",
      tone: "critical",
    },
    funnelStage: {
      label: "Funnel Score",
      score: "2.4/10",
      description: "Pouca gente chega ao clique com intenção real.",
      tone: "critical",
    },
    efficiencyStage: {
      label: "Efficiency Lens",
      score: "2.6/10",
      description: "Criativo ruim para aprender e pior ainda para escalar.",
      tone: "critical",
    },
  },
  {
    id: "ad-ugc-social-proof",
    name: "Prova social | Print + UGC | 20s",
    campaignName: "Social Proof Stack",
    accountName: "Hookify Performance",
    summary: "Boa credibilidade e intenção, com espaço para melhorar retenção no segundo bloco do vídeo.",
    status: "Gold",
    score: 8.1,
    scoreLabel: "Está forte, com uma ou duas melhorias que podem ampliar volume.",
    previewUrl: null,
    previewCaption: "Criativo com credibilidade forte e oportunidade de lapidar retenção.",
    insights: [
      {
        title: "Prova social empurra clique",
        detail: "O bloco de credibilidade ajuda a audiência a avançar para a página com menos atrito.",
        tone: "positive",
      },
      {
        title: "Retenção cai no segundo bloco",
        detail: "Há um momento mais lento que vale ser comprimido para preservar ritmo.",
        tone: "warning",
      },
      {
        title: "Oferta está bem casada com a landing",
        detail: "A página sustenta a expectativa criada pelo anúncio.",
        tone: "positive",
      },
    ],
    actions: [
      {
        title: "Enxugar trecho intermediário",
        detail: "Reduza a repetição entre prova social e CTA final para manter velocidade.",
        tone: "positive",
      },
      {
        title: "Clonar criativo para novos ângulos",
        detail: "A base de prova já funciona e pode receber hooks mais agressivos no início.",
        tone: "neutral",
      },
      {
        title: "Monitorar CPM ao escalar",
        detail: "A peça ainda está saudável, mas o custo pode subir em públicos mais amplos.",
        tone: "warning",
      },
    ],
    retentionMetrics: [
      { label: "Scroll Stop", value: "36%", tone: "positive" },
      { label: "Hook", value: "46%", tone: "positive" },
      { label: "Hold Rate", value: "25%", tone: "warning" },
      { label: "50% View", value: "22%", tone: "positive" },
    ],
    funnelMetrics: [
      { label: "CTR", value: "2,14%", tone: "positive" },
      { label: "Link CTR", value: "1,71%", tone: "positive" },
      { label: "Conn Rate", value: "74%", tone: "positive" },
      { label: "Page Conv.", value: "21%", tone: "positive" },
    ],
    efficiencyMetrics: [
      { label: "CPM", value: "R$ 29,70", tone: "neutral" },
      { label: "CPC", value: "R$ 1,39", tone: "positive" },
      { label: "CPR", value: "R$ 20,10", tone: "positive" },
      { label: "CPMQL", value: "R$ 45,20", tone: "positive" },
    ],
    retentionStage: {
      label: "Retention Score",
      score: "7.5/10",
      description: "Base forte, com espaço para melhorar ritmo no miolo do vídeo.",
      tone: "warning",
    },
    funnelStage: {
      label: "Funnel Score",
      score: "8.4/10",
      description: "A credibilidade ajuda a transformar atenção em intenção real.",
      tone: "positive",
    },
    efficiencyStage: {
      label: "Efficiency Lens",
      score: "8.1/10",
      description: "Ótima peça para escalar e refinar com parcimônia.",
      tone: "positive",
    },
  },
];
