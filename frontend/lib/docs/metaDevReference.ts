/**
 * Referência técnica (Dev + Meta App Review).
 * Mantém conteúdo centralizado para uso na página /docs e exportação em Markdown.
 */

export const META_BASE_URL_TEMPLATE = "https://graph.facebook.com/{VERSION}/";
export const META_CURRENT_VERSION = "v24.0";

export type MetaPermissionDoc = {
  scope: string;
  description: string;
  /** Onde isso aparece/é usado no produto (para reviewers) */
  usedFor: string[];
  /** Observações curtas para App Review */
  appReviewNotes?: string[];
};

export const META_PERMISSIONS: MetaPermissionDoc[] = [
  {
    scope: "public_profile",
    description: "Leitura do perfil público do usuário (identificação básica).",
    usedFor: ["Login com Facebook e identificação do usuário conectado."],
    appReviewNotes: ["Usado apenas para autenticação e exibição básica do perfil."],
  },
  {
    scope: "email",
    description: "Acesso ao email do usuário (identidade e conta).",
    usedFor: ["Login/conta e vinculação do usuário no Hookify."],
    appReviewNotes: ["Usado para identificação da conta, não para marketing."],
  },
  {
    scope: "ads_read",
    description: "Leitura de contas de anúncio e insights (métricas).",
    usedFor: [
      "Listar contas de anúncio disponíveis ao usuário.",
      "Coletar insights/métricas para análise (Manager, Insights, G.O.L.D.).",
      "Importação de packs e atualização de métricas diárias.",
    ],
    appReviewNotes: [
      "Necessário para leitura de performance e análise.",
      "Não publicamos anúncios; apenas leitura e relatórios.",
    ],
  },
  {
    scope: "ads_management",
    description: "Gerenciamento de anúncios (alterar status, ex.: pausar/ativar).",
    usedFor: ["Ação opcional no Manager para pausar/ativar anúncios diretamente no Meta."],
    appReviewNotes: [
      "Permissão usada somente quando o usuário executa ação explícita (toggle de status).",
      "Sem automações de alteração em massa sem ação do usuário.",
    ],
  },
  {
    scope: "pages_show_list",
    description: "Listar páginas associadas ao usuário (para tokens/recursos de vídeo).",
    usedFor: [
      "Obter tokens de página quando necessário para acessar recursos de vídeos/criativos vinculados.",
    ],
    appReviewNotes: ["Usado apenas para habilitar carregamento de criativos/vídeos quando aplicável."],
  },
  {
    scope: "pages_read_engagement",
    description: "Leitura de dados de engajamento de páginas (quando necessário para criativos/vídeos).",
    usedFor: [
      "Suporte a leitura de informações relacionadas a mídia/engajamento quando exigido pelo Graph API.",
    ],
    appReviewNotes: ["Não publicamos conteúdo; apenas leitura para exibição/análise."],
  },
];

export type MetaEndpointDoc = {
  method: "GET" | "POST";
  path: string;
  description: string;
  /** Escopos normalmente associados ao uso */
  permissions?: string[];
};

export const META_ENDPOINTS: MetaEndpointDoc[] = [
  { method: "GET", path: "/me", description: "Dados do usuário autenticado", permissions: ["public_profile", "email"] },
  { method: "GET", path: "/me/adaccounts", description: "Listar contas de anúncio", permissions: ["ads_read"] },
  { method: "GET", path: "/me/accounts", description: "Obter tokens de página (para vídeos)", permissions: ["pages_show_list"] },
  { method: "POST", path: "/{act_id}/insights", description: "Iniciar job assíncrono de insights", permissions: ["ads_read"] },
  { method: "GET", path: "/{report_run_id}", description: "Verificar status do job", permissions: ["ads_read"] },
  { method: "GET", path: "/{report_run_id}/insights", description: "Buscar resultados paginados", permissions: ["ads_read"] },
  { method: "POST", path: "/{ad_id}", description: "Atualizar status do anúncio (ACTIVE/PAUSED)", permissions: ["ads_management"] },
  { method: "POST", path: "/{adset_id}", description: "Atualizar status do conjunto", permissions: ["ads_management"] },
  { method: "POST", path: "/{campaign_id}", description: "Atualizar status da campanha", permissions: ["ads_management"] },
  { method: "GET", path: "/{video_id}", description: "Obter URL do vídeo", permissions: ["ads_read"] },
];

export type MetaMetricDoc = { category: string; metrics: string };
export const META_METRICS: MetaMetricDoc[] = [
  { category: "Impressões", metrics: "impressions, reach, frequency" },
  { category: "Cliques", metrics: "clicks, inline_link_clicks, ctr, website_ctr" },
  { category: "Custo", metrics: "spend, cpm, cost_per_conversion" },
  { category: "Vídeo", metrics: "video_play_actions, video_thruplay_watched_actions, video_p50_watched_actions, video_play_curve_actions" },
  { category: "Ações", metrics: "actions, conversions (breakdown por action_type)" },
  { category: "Estrutura", metrics: "ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name" },
];

export type MetaParamDoc = { param: string; value: string; description: string };
export const META_PARAMS: MetaParamDoc[] = [
  { param: "level", value: "ad", description: "Granularidade dos dados" },
  { param: "time_increment", value: "1", description: "Breakdown diário (1 linha por dia)" },
  { param: "action_breakdowns", value: "action_type", description: "Breakdown de ações por tipo" },
  { param: "action_attribution_windows", value: '["7d_click","1d_view"]', description: "Janela de atribuição" },
  { param: "async", value: "true", description: "Processamento assíncrono (retorna report_run_id)" },
  { param: "limit", value: "5000", description: "Registros por página" },
  { param: "filtering", value: "[{field, operator, value}]", description: "Filtros (CONTAIN, EQUAL, NOT_CONTAIN, etc.)" },
];

export const META_OAUTH_FLOW: string[] = [
  "OAuth Login com Facebook → obtenção de access_token e escopos aprovados.",
  "Persistência segura do token e metadados (expiração, escopos) no banco.",
  "Renovação/reconexão quando expira (erro 190) com UX orientando o usuário.",
  "Operações de leitura (ads_read) e ações (ads_management) são sempre vinculadas ao usuário autenticado.",
];

export const META_APP_REVIEW_CHECKLIST: { title: string; items: string[] }[] = [
  {
    title: "Evidências para revisão",
    items: [
      "Descrever claramente que o app é de análise/otimização e consome insights para relatórios.",
      "Apontar as telas onde cada permissão é usada (ex.: importar packs, análises, controle de status).",
      "Fornecer um passo a passo de teste (conta de anúncio de teste + como disparar a coleta).",
      "Explicar que mudanças (ads_management) só acontecem mediante ação explícita do usuário.",
    ],
  },
  {
    title: "Boas práticas / conformidade",
    items: [
      "Princípio do menor privilégio: solicitar apenas escopos necessários.",
      "Não compartilhar tokens com terceiros; armazenar de forma segura (criptografado).",
      "RLS no banco: cada usuário acessa apenas seus dados.",
      "Logs e auditoria: manter rastreio de jobs e falhas sem vazar tokens.",
    ],
  },
];

export const META_SECURITY_AND_DATA: string[] = [
  "Tokens OAuth são armazenados criptografados no banco (nunca em plaintext no frontend).",
  "Acesso a dados protegido por RLS (Supabase): `user_id = auth.uid()`.",
  "Respeitar expiração e revogação: ao erro 190 marcar conexão como expirada e exigir reconexão.",
  "Evitar coleta excessiva: paginação e batches, com redução automática quando a Meta solicita (\"reduce data\").",
];

