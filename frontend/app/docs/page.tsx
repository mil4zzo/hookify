"use client";

import { ComponentType, ReactNode, useCallback } from "react";
import { PageContainer } from "@/components/common/PageContainer";
import { PageIcon } from "@/lib/utils/pageIcon";
import { StandardCard } from "@/components/common/StandardCard";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  IconBook2,
  IconCardsFilled,
  IconSitemapFilled,
  IconSunFilled,
  IconDiamond,
  IconArrowRight,
  IconBulb,
  IconCode,
  IconBrandMeta,
  IconDatabase,
  IconCopy,
} from "@tabler/icons-react";
import { buildFullDocsMarkdown } from "@/lib/docs/buildDocsMarkdown";
import { showSuccess, showError } from "@/lib/utils/toast";
import {
  META_BASE_URL_TEMPLATE,
  META_CURRENT_VERSION,
  META_PERMISSIONS,
  META_ENDPOINTS,
  META_METRICS,
  META_PARAMS,
  META_OAUTH_FLOW,
  META_APP_REVIEW_CHECKLIST,
  META_SECURITY_AND_DATA,
} from "@/lib/docs/metaDevReference";

// ─── Types ───────────────────────────────────────────────────────────────────

interface PageDoc {
  id: string;
  title: string;
  path: string;
  icon: ComponentType<{ className?: string }>;
  summary: string;
  features: string[];
}

interface TableColumn {
  name: string;
  type: string;
  description: string;
}

interface TableDoc {
  id: string;
  name: string;
  description: string;
  columns: TableColumn[];
}

// ─── Page Documentation Data ─────────────────────────────────────────────────

const PAGE_DOCS: PageDoc[] = [
  {
    id: "packs",
    title: "Packs",
    path: "/packs",
    icon: IconCardsFilled,
    summary:
      "Importe e gerencie seus packs de anúncios do Facebook Ads. Packs são coleções de anúncios agrupados por filtros que você define.",
    features: [
      "Criar packs com filtros por campanha, conjunto de anúncios e anúncio",
      "Definir período de datas para cada pack",
      "Auto-refresh para manter os dados sempre atualizados",
      "Exportar dados via CSV ou sincronizar com Google Sheets",
      "Visualizar status de cada anúncio (ativo, pausado, etc.)",
      "Acompanhar progresso de carregamento dos dados",
    ],
  },
  {
    id: "manager",
    title: "Manager",
    path: "/manager",
    icon: IconSitemapFilled,
    summary:
      "Visualize e analise a performance dos seus anúncios em detalhe, com múltiplas formas de agrupamento e comparação.",
    features: [
      "Agrupar dados por anúncio individual, nome de anúncio, conjunto ou campanha",
      "Filtrar por período de datas e tipo de conversão (ex: landing page view, purchase)",
      "Comparar métricas individuais com médias gerais para identificar tendências",
      "Expandir agrupamentos para ver os anúncios individuais dentro de cada grupo",
      "Tabela ordenável com métricas como CPR, CPM, CTR, taxa de conversão e mais",
      "Selecionar múltiplos packs para análise cruzada",
    ],
  },
  {
    id: "insights",
    title: "Insights",
    path: "/insights",
    icon: IconSunFilled,
    summary:
      "Identifique oportunidades de otimização e descubra os destaques nos seus anúncios com análises automáticas.",
    features: [
      "Aba Oportunidades: anúncios com performance abaixo da média, rankeados por potencial de impacto",
      "Aba Insights: kanban visual agrupando anúncios por tipo de otimização necessária",
      "Aba Gems: top 5 anúncios por métrica (hook rate, CTR, conversão, custo, etc.)",
      "Filtrar por tipo de métrica para focar na análise desejada",
      "Agrupar por pack para ver oportunidades separadamente",
      "Critérios de validação aplicados para analisar apenas anúncios maduros",
    ],
  },
  {
    id: "gold",
    title: "G.O.L.D.",
    path: "/gold",
    icon: IconDiamond,
    summary:
      "Rankings e classificação dos anúncios com melhor performance geral, destacando os verdadeiros campeões.",
    features: [
      "Leaderboard visual com visualização em kanban e tabela",
      "Classificação por múltiplas métricas de performance",
      "Sistema de badges para os top performers (top 3)",
      "Filtros por período e tipo de conversão",
      "Critérios de validação aplicados automaticamente",
    ],
  },
];

// ─── Meta API Data ───────────────────────────────────────────────────────────
// (conteúdo centralizado em lib/docs/metaDevReference.ts)

// ─── Supabase Tables Data ────────────────────────────────────────────────────

const SUPABASE_TABLES: TableDoc[] = [
  {
    id: "packs",
    name: "packs",
    description: "Packs de anúncios criados pelos usuários. Cada pack agrupa anúncios por filtros e período.",
    columns: [
      { name: "id", type: "UUID", description: "Chave primária" },
      { name: "user_id", type: "UUID", description: "FK para auth.users" },
      { name: "adaccount_id", type: "TEXT", description: "ID da conta de anúncio do Facebook" },
      { name: "name", type: "TEXT", description: "Nome do pack" },
      { name: "date_start", type: "DATE", description: "Data de início do período" },
      { name: "date_stop", type: "DATE", description: "Data final do período" },
      { name: "level", type: "TEXT", description: "Nível de agregação: 'campaign', 'adset' ou 'ad'" },
      { name: "filters", type: "JSONB", description: "Regras de filtro (campanha, conjunto, anúncio)" },
      { name: "stats", type: "JSONB", description: "Estatísticas agregadas do pack" },
      { name: "ad_ids", type: "TEXT[]", description: "Array de IDs dos anúncios no pack" },
      { name: "pack_ids", type: "UUID[]", description: "Array de IDs de packs (metadado)" },
      { name: "auto_refresh", type: "BOOLEAN", description: "Se auto-refresh está habilitado" },
      { name: "refresh_status", type: "TEXT", description: "Status: idle, queued, running, success, failed, cancelled" },
      { name: "last_refreshed_at", type: "DATE", description: "Data do último refresh" },
      { name: "refresh_progress_json", type: "JSONB", description: "JSON de progresso do refresh" },
      { name: "sheet_integration_id", type: "UUID", description: "FK para ad_sheet_integrations (ON DELETE SET NULL)" },
      { name: "created_at", type: "TIMESTAMPTZ", description: "Data de criação" },
      { name: "updated_at", type: "TIMESTAMPTZ", description: "Data de atualização" },
    ],
  },
  {
    id: "ads",
    name: "ads",
    description: "Dados dos anúncios importados. Cada registro representa um anúncio único com seus metadados e criativos.",
    columns: [
      { name: "ad_id", type: "TEXT", description: "Chave primária — ID do anúncio no Facebook" },
      { name: "user_id", type: "UUID", description: "FK para auth.users" },
      { name: "account_id", type: "TEXT", description: "ID da conta de anúncio" },
      { name: "campaign_id", type: "TEXT", description: "ID da campanha" },
      { name: "campaign_name", type: "TEXT", description: "Nome da campanha" },
      { name: "adset_id", type: "TEXT", description: "ID do conjunto de anúncios" },
      { name: "adset_name", type: "TEXT", description: "Nome do conjunto" },
      { name: "ad_name", type: "TEXT", description: "Nome do anúncio" },
      { name: "effective_status", type: "TEXT", description: "Status efetivo (ACTIVE, PAUSED, ARCHIVED, etc.)" },
      { name: "creative", type: "JSONB", description: "Dados do criativo (imagem/vídeo)" },
      { name: "creative_video_id", type: "TEXT", description: "ID do vídeo principal" },
      { name: "thumbnail_url", type: "TEXT", description: "URL da thumbnail" },
      { name: "adcreatives_videos_ids", type: "JSONB", description: "Array de IDs de vídeos do feed de criativos" },
      { name: "adcreatives_videos_thumbs", type: "JSONB", description: "Array de thumbnails dos vídeos" },
      { name: "thumb_storage_path", type: "TEXT", description: "Caminho da thumbnail no Supabase Storage" },
      { name: "pack_ids", type: "UUID[]", description: "Array de packs que contêm este anúncio" },
      { name: "leadscore", type: "NUMERIC", description: "Lead score (enriquecimento via Google Sheets)" },
      { name: "cpr_max", type: "NUMERIC", description: "CPR máximo (enriquecimento via Google Sheets)" },
      { name: "created_at", type: "TIMESTAMPTZ", description: "Data de criação" },
      { name: "updated_at", type: "TIMESTAMPTZ", description: "Data de atualização" },
    ],
  },
  {
    id: "ad_metrics",
    name: "ad_metrics",
    description: "Métricas diárias dos anúncios (time-series). Cada linha = 1 anúncio em 1 dia. ID composto: \"{date}-{ad_id}\".",
    columns: [
      { name: "id", type: "TEXT", description: "Chave primária composta: \"{date}-{ad_id}\"" },
      { name: "user_id", type: "UUID", description: "FK para auth.users" },
      { name: "ad_id", type: "TEXT", description: "ID do anúncio" },
      { name: "account_id", type: "TEXT", description: "ID da conta de anúncio" },
      { name: "campaign_id / campaign_name", type: "TEXT", description: "ID e nome da campanha" },
      { name: "adset_id / adset_name", type: "TEXT", description: "ID e nome do conjunto" },
      { name: "ad_name", type: "TEXT", description: "Nome do anúncio" },
      { name: "date", type: "DATE", description: "Data da métrica" },
      { name: "impressions", type: "INTEGER", description: "Total de impressões" },
      { name: "reach", type: "INTEGER", description: "Alcance único" },
      { name: "clicks", type: "INTEGER", description: "Total de cliques" },
      { name: "inline_link_clicks", type: "INTEGER", description: "Cliques no link" },
      { name: "lpv", type: "INTEGER", description: "Landing page views" },
      { name: "spend", type: "NUMERIC", description: "Gasto total" },
      { name: "cpm", type: "NUMERIC", description: "Custo por mil impressões" },
      { name: "ctr", type: "NUMERIC", description: "Click-through rate" },
      { name: "website_ctr", type: "NUMERIC", description: "CTR do website" },
      { name: "frequency", type: "NUMERIC", description: "Frequência média por pessoa" },
      { name: "video_total_plays", type: "INTEGER", description: "Total de plays do vídeo" },
      { name: "video_total_thruplays", type: "INTEGER", description: "Thruplays (assistido 75%+)" },
      { name: "video_watched_p50", type: "INTEGER", description: "Assistido até 50%" },
      { name: "video_play_curve_actions", type: "JSONB", description: "Curva de retenção (22 pontos, 0-100%)" },
      { name: "actions", type: "JSONB", description: "Array de ações [{action_type, value}]" },
      { name: "conversions", type: "JSONB", description: "Array de conversões [{action_type, value}]" },
      { name: "cost_per_conversion", type: "JSONB", description: "Array de custo por conversão [{action_type, value}]" },
      { name: "hold_rate", type: "NUMERIC", description: "Taxa de retenção do vídeo" },
      { name: "connect_rate", type: "NUMERIC", description: "Taxa de conexão" },
      { name: "profile_ctr", type: "NUMERIC", description: "CTR do perfil" },
      { name: "pack_ids", type: "UUID[]", description: "Array de packs associados" },
      { name: "raw_data", type: "JSONB", description: "Dados brutos da API do Meta" },
      { name: "created_at", type: "TIMESTAMPTZ", description: "Data de criação" },
      { name: "updated_at", type: "TIMESTAMPTZ", description: "Data de atualização" },
    ],
  },
  {
    id: "facebook_connections",
    name: "facebook_connections",
    description: "Conexões OAuth com o Facebook. Armazena tokens de acesso e status da conexão.",
    columns: [
      { name: "id", type: "UUID", description: "Chave primária" },
      { name: "user_id", type: "UUID", description: "FK para auth.users (ON DELETE CASCADE)" },
      { name: "facebook_user_id", type: "TEXT", description: "ID do usuário no Facebook" },
      { name: "facebook_name", type: "TEXT", description: "Nome do usuário no Facebook" },
      { name: "facebook_email", type: "TEXT", description: "Email do Facebook" },
      { name: "facebook_picture_url", type: "TEXT", description: "URL da foto de perfil" },
      { name: "access_token", type: "TEXT", description: "Token OAuth (armazenado criptografado)" },
      { name: "refresh_token", type: "TEXT", description: "Token de refresh" },
      { name: "expires_at", type: "TIMESTAMPTZ", description: "Expiração do token" },
      { name: "scopes", type: "TEXT[]", description: "Escopos OAuth concedidos" },
      { name: "is_primary", type: "BOOLEAN", description: "Se é a conexão principal" },
      { name: "status", type: "TEXT", description: "Status: 'active', 'expired', 'invalid'" },
      { name: "created_at", type: "TIMESTAMPTZ", description: "Data de criação" },
      { name: "updated_at", type: "TIMESTAMPTZ", description: "Data de atualização" },
    ],
  },
  {
    id: "google_accounts",
    name: "google_accounts",
    description: "Conexões OAuth com o Google. Usado para integração com Google Sheets.",
    columns: [
      { name: "id", type: "UUID", description: "Chave primária" },
      { name: "user_id", type: "UUID", description: "FK para auth.users (ON DELETE CASCADE)" },
      { name: "google_user_id", type: "TEXT", description: "ID do usuário no Google" },
      { name: "google_email", type: "TEXT", description: "Email do Google" },
      { name: "google_name", type: "TEXT", description: "Nome do usuário no Google" },
      { name: "access_token", type: "TEXT", description: "Token OAuth" },
      { name: "refresh_token", type: "TEXT", description: "Token de refresh" },
      { name: "expires_at", type: "TIMESTAMPTZ", description: "Expiração do token" },
      { name: "scopes", type: "TEXT[]", description: "Escopos OAuth concedidos" },
      { name: "is_primary", type: "BOOLEAN", description: "Se é a conta principal" },
      { name: "created_at", type: "TIMESTAMPTZ", description: "Data de criação" },
      { name: "updated_at", type: "TIMESTAMPTZ", description: "Data de atualização" },
    ],
  },
  {
    id: "ad_accounts",
    name: "ad_accounts",
    description: "Contas de anúncio do Facebook conectadas ao usuário.",
    columns: [
      { name: "id", type: "TEXT", description: "Chave primária — ID da conta de anúncio" },
      { name: "user_id", type: "UUID", description: "FK para auth.users" },
      { name: "name", type: "TEXT", description: "Nome da conta" },
      { name: "account_status", type: "INTEGER", description: "Código de status da conta" },
      { name: "user_tasks", type: "TEXT[]", description: "Permissões do usuário (DRAFT, ANALYZE, ADVERTISE, MANAGE)" },
      { name: "business_id", type: "TEXT", description: "ID do Business Manager" },
      { name: "business_name", type: "TEXT", description: "Nome do Business Manager" },
      { name: "instagram_accounts", type: "JSONB", description: "Contas do Instagram [{username, id}]" },
      { name: "created_at", type: "TIMESTAMPTZ", description: "Data de criação" },
      { name: "updated_at", type: "TIMESTAMPTZ", description: "Data de atualização" },
    ],
  },
  {
    id: "profiles",
    name: "profiles",
    description: "Perfil do usuário na plataforma.",
    columns: [
      { name: "user_id", type: "UUID", description: "Chave primária — FK para auth.users" },
      { name: "fb_user_id", type: "TEXT", description: "ID do Facebook vinculado" },
      { name: "name", type: "TEXT", description: "Nome do usuário" },
      { name: "email", type: "TEXT", description: "Email do usuário" },
      { name: "picture_url", type: "TEXT", description: "URL da foto de perfil" },
      { name: "created_at", type: "TIMESTAMPTZ", description: "Data de criação" },
      { name: "updated_at", type: "TIMESTAMPTZ", description: "Data de atualização" },
    ],
  },
  {
    id: "user_preferences",
    name: "user_preferences",
    description: "Preferências e configurações do usuário (idioma, moeda, critérios de validação, etc.).",
    columns: [
      { name: "user_id", type: "UUID", description: "Chave primária — FK para auth.users" },
      { name: "locale", type: "TEXT", description: "Idioma (pt-BR, en-US, es-ES)" },
      { name: "timezone", type: "TEXT", description: "Fuso horário" },
      { name: "currency", type: "TEXT", description: "Moeda (BRL, USD, EUR)" },
      { name: "theme", type: "TEXT", description: "Tema: 'dark' ou 'light'" },
      { name: "niche", type: "TEXT", description: "Nicho do negócio" },
      { name: "default_adaccount_id", type: "TEXT", description: "Conta de anúncio padrão" },
      { name: "has_completed_onboarding", type: "BOOLEAN", description: "Se o onboarding foi concluído" },
      { name: "validation_criteria", type: "JSONB", description: "Critérios de validação para anúncios maduros" },
      { name: "mql_leadscore_min", type: "NUMERIC", description: "Lead score mínimo para MQLs" },
      { name: "leadscore_count_sum", type: "NUMERIC", description: "Soma de leads para cálculo de MQL" },
      { name: "created_at", type: "TIMESTAMPTZ", description: "Data de criação" },
      { name: "updated_at", type: "TIMESTAMPTZ", description: "Data de atualização" },
    ],
  },
  {
    id: "ad_sheet_integrations",
    name: "ad_sheet_integrations",
    description: "Configurações de integração com Google Sheets para enriquecimento de métricas (leadscore, CPR max).",
    columns: [
      { name: "id", type: "UUID", description: "Chave primária" },
      { name: "owner_id", type: "UUID", description: "FK para auth.users" },
      { name: "pack_id", type: "UUID", description: "FK para packs (ON DELETE CASCADE)" },
      { name: "connection_id", type: "UUID", description: "FK para google_accounts" },
      { name: "spreadsheet_id", type: "TEXT", description: "ID da planilha no Google Sheets" },
      { name: "worksheet_title", type: "TEXT", description: "Nome da aba/worksheet" },
      { name: "match_strategy", type: "TEXT", description: "Estratégia de match (padrão: 'AD_ID')" },
      { name: "ad_id_column", type: "TEXT", description: "Coluna com os IDs dos anúncios" },
      { name: "date_column", type: "TEXT", description: "Coluna com as datas" },
      { name: "date_format", type: "TEXT", description: "Formato: 'DD/MM/YYYY' ou 'MM/DD/YYYY'" },
      { name: "leadscore_column", type: "TEXT", description: "Coluna do lead score" },
      { name: "cpr_max_column", type: "TEXT", description: "Coluna do CPR máximo" },
      { name: "last_synced_at", type: "TIMESTAMPTZ", description: "Último sync" },
      { name: "last_sync_status", type: "TEXT", description: "Status do último sync" },
      { name: "created_at", type: "TIMESTAMPTZ", description: "Data de criação" },
      { name: "updated_at", type: "TIMESTAMPTZ", description: "Data de atualização" },
    ],
  },
  {
    id: "jobs",
    name: "jobs",
    description: "Rastreamento de jobs assíncronos (refresh de packs, sync de dados).",
    columns: [
      { name: "id", type: "TEXT", description: "Chave primária — ID do job" },
      { name: "user_id", type: "UUID", description: "FK para auth.users" },
      { name: "status", type: "TEXT", description: "Status: meta_running, meta_completed, processing, persisting, completed, failed, cancelled" },
      { name: "progress", type: "INTEGER", description: "Progresso em porcentagem (0-100)" },
      { name: "message", type: "TEXT", description: "Mensagem de status" },
      { name: "payload", type: "JSONB", description: "Parâmetros do job" },
      { name: "result_count", type: "INTEGER", description: "Quantidade de resultados" },
      { name: "created_at", type: "TIMESTAMPTZ", description: "Data de criação" },
      { name: "updated_at", type: "TIMESTAMPTZ", description: "Data de atualização" },
    ],
  },
];

// ─── Reusable Components ─────────────────────────────────────────────────────

function SectionTitle({ icon: Icon, children }: { icon: ComponentType<{ className?: string }>; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <Icon className="w-5 h-5 text-yellow-500" />
      <h2 className="text-base font-semibold text-foreground">{children}</h2>
    </div>
  );
}

function BulletItem({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <li className={`flex items-start gap-2 text-sm ${muted ? "text-muted-foreground" : "text-foreground"}`}>
      <span className="text-yellow-500 mt-0.5 shrink-0">•</span>
      <span>{children}</span>
    </li>
  );
}

// ─── Page Component ──────────────────────────────────────────────────────────

export default function DocsPage() {
  const handleCopyDocsMarkdown = useCallback(async () => {
    try {
      const markdown = buildFullDocsMarkdown({
        pageDocs: PAGE_DOCS.map(({ id, title, path, summary, features }) => ({
          id,
          title,
          path,
          summary,
          features,
        })),
        metaBaseUrlTemplate: META_BASE_URL_TEMPLATE,
        metaCurrentVersion: META_CURRENT_VERSION,
        metaPermissions: META_PERMISSIONS,
        metaEndpoints: META_ENDPOINTS,
        metaMetrics: META_METRICS,
        metaParams: META_PARAMS,
        supabaseTables: SUPABASE_TABLES,
        metaOAuthFlow: META_OAUTH_FLOW,
        metaAppReviewChecklist: META_APP_REVIEW_CHECKLIST,
        metaSecurityAndData: META_SECURITY_AND_DATA,
      });
      await navigator.clipboard.writeText(markdown);
      showSuccess("Documentação copiada em Markdown!");
    } catch {
      showError("Não foi possível copiar a documentação.");
    }
  }, []);

  return (
    <PageContainer
      title="Documentação"
      description="Entenda como utilizar cada funcionalidade da plataforma Hookify"
      icon={<PageIcon icon={IconBook2} />}
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={handleCopyDocsMarkdown}
          className="gap-2"
        >
          <IconCopy className="w-4 h-4" />
          Copiar em Markdown
        </Button>
      }
    >
      {/* Hero */}
      <StandardCard padding="lg">
        <h2 className="text-lg font-semibold text-foreground mb-2">
          O que é o Hookify?
        </h2>
        <p className="text-sm text-muted-foreground leading-relaxed mb-4">
          O Hookify é uma plataforma de análise e otimização de anúncios do
          Facebook Ads. Ele permite que você importe seus dados de anúncios,
          analise a performance em profundidade e identifique oportunidades de
          melhoria de forma visual e intuitiva.
        </p>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Fluxo de uso:</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline">Packs</Badge>
            <IconArrowRight className="w-3.5 h-3.5" />
            <Badge variant="outline">Manager</Badge>
            <IconArrowRight className="w-3.5 h-3.5" />
            <Badge variant="outline">Insights</Badge>
            <IconArrowRight className="w-3.5 h-3.5" />
            <Badge variant="outline">G.O.L.D.</Badge>
          </div>
        </div>
      </StandardCard>

      {/* Page Documentation */}
      <Accordion type="multiple" defaultValue={["packs"]}>
        {PAGE_DOCS.map((page) => (
          <AccordionItem key={page.id} value={page.id}>
            <AccordionTrigger>
              <div className="flex items-center gap-3">
                <page.icon className="w-5 h-5 text-yellow-500" />
                <span className="font-medium">{page.title}</span>
                <Badge variant="outline" className="text-[11px] px-2 py-0">
                  {page.path}
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <p className="text-muted-foreground mb-3">{page.summary}</p>
              <ul className="space-y-1.5">
                {page.features.map((feature, i) => (
                  <BulletItem key={i}>{feature}</BulletItem>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      {/* Tips */}
      <StandardCard padding="lg" variant="muted">
        <div className="flex items-center gap-2 mb-3">
          <IconBulb className="w-5 h-5 text-yellow-500" />
          <h3 className="text-sm font-semibold text-foreground">
            Dicas rápidas
          </h3>
        </div>
        <ul className="space-y-1.5">
          <BulletItem muted>
            Comece criando seus packs na página{" "}
            <span className="text-foreground font-medium">Packs</span> para
            importar seus anúncios
          </BulletItem>
          <BulletItem muted>
            Os filtros de pack, data e tipo de conversão são compartilhados
            entre Manager, Insights e G.O.L.D.
          </BulletItem>
          <BulletItem muted>
            Configure os critérios de validação para garantir que apenas
            anúncios com dados suficientes sejam analisados
          </BulletItem>
        </ul>
      </StandardCard>

      {/* ══════════════════════════════════════════════════════════════════ */}
      {/* Developer Section */}
      {/* ══════════════════════════════════════════════════════════════════ */}

      <div className="border-t border-border pt-6 mt-2">
        <div className="flex items-center gap-2.5 mb-1">
          <IconCode className="w-5 h-5 text-yellow-500" />
          <h2 className="text-lg font-semibold text-foreground">
            Referência Técnica
          </h2>
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          Documentação técnica para desenvolvedores sobre a API do Meta e o banco de dados.
        </p>
      </div>

      {/* ── Meta API ── */}
      <StandardCard padding="lg">
        <SectionTitle icon={IconBrandMeta}>Meta Marketing API</SectionTitle>
        <p className="text-sm text-muted-foreground mb-4">
          Base URL:{" "}
          <code className="text-xs bg-muted-50 px-1.5 py-0.5 rounded font-mono">
            {META_BASE_URL_TEMPLATE}
          </code>{" "}
          <span className="text-xs text-muted-foreground">
            (versão atual:{" "}
            <code className="text-xs bg-muted-50 px-1.5 py-0.5 rounded font-mono">
              {META_CURRENT_VERSION}
            </code>
            )
          </span>
        </p>

        <Accordion type="multiple" defaultValue={[]}>
          {/* Permissions */}
          <AccordionItem value="meta-permissions">
            <AccordionTrigger>
              <span className="font-medium">Permissões OAuth</span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2">
                {META_PERMISSIONS.map((p) => (
                  <div key={p.scope} className="rounded-md border border-border/60 p-3">
                    <div className="flex items-start gap-2 text-sm">
                      <code className="text-xs bg-muted-50 px-1.5 py-0.5 rounded font-mono text-yellow-500 shrink-0">
                        {p.scope}
                      </code>
                      <span className="text-muted-foreground">{p.description}</span>
                    </div>
                    {p.usedFor?.length ? (
                      <ul className="mt-2 space-y-1">
                        {p.usedFor.map((u, i) => (
                          <BulletItem key={i} muted>
                            Uso: {u}
                          </BulletItem>
                        ))}
                      </ul>
                    ) : null}
                    {p.appReviewNotes?.length ? (
                      <ul className="mt-2 space-y-1">
                        {p.appReviewNotes.map((n, i) => (
                          <BulletItem key={i} muted>
                            App Review: {n}
                          </BulletItem>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Endpoints */}
          <AccordionItem value="meta-endpoints">
            <AccordionTrigger>
              <span className="font-medium">Endpoints</span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2">
                {META_ENDPOINTS.map((e, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <Badge
                      variant={e.method === "POST" ? "default" : "outline"}
                      className="text-[10px] px-1.5 py-0 shrink-0 font-mono"
                    >
                      {e.method}
                    </Badge>
                    <code className="text-xs font-mono text-foreground shrink-0">{e.path}</code>
                    <span className="text-muted-foreground">— {e.description}</span>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Metrics */}
          <AccordionItem value="meta-metrics">
            <AccordionTrigger>
              <span className="font-medium">Métricas Coletadas</span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3">
                {META_METRICS.map((m) => (
                  <div key={m.category}>
                    <span className="text-sm font-medium text-foreground">{m.category}</span>
                    <p className="text-xs font-mono text-muted-foreground mt-0.5">{m.metrics}</p>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Parameters */}
          <AccordionItem value="meta-params">
            <AccordionTrigger>
              <span className="font-medium">Parâmetros da Requisição</span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-2">
                {META_PARAMS.map((p) => (
                  <div key={p.param} className="flex items-start gap-2 text-sm">
                    <code className="text-xs bg-muted-50 px-1.5 py-0.5 rounded font-mono text-yellow-500 shrink-0">
                      {p.param}
                    </code>
                    <code className="text-xs font-mono text-muted-foreground shrink-0">{p.value}</code>
                    <span className="text-muted-foreground">— {p.description}</span>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Architecture */}
          <AccordionItem value="meta-architecture">
            <AccordionTrigger>
              <span className="font-medium">Arquitetura de Coleta (2 Fases)</span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4">
                <div>
                  <span className="text-sm font-medium text-foreground">Fase 1 — Meta API Processing</span>
                  <ul className="mt-1.5 space-y-1">
                    <BulletItem muted>POST /{"{act_id}"}/insights com async=true → retorna report_run_id</BulletItem>
                    <BulletItem muted>Polling do status do job (máx. 60 polls × 5s = 5 min)</BulletItem>
                    <BulletItem muted>Quando completo, dispara Fase 2 em background</BulletItem>
                  </ul>
                </div>
                <div>
                  <span className="text-sm font-medium text-foreground">Fase 2 — Background Processing</span>
                  <ul className="mt-1.5 space-y-1">
                    <BulletItem muted>Paginação: coleta todos os insights (500 por página)</BulletItem>
                    <BulletItem muted>Enriquecimento: busca criativos (1 por ad_name) + status por ad_id</BulletItem>
                    <BulletItem muted>Formatação: converte para schema do frontend</BulletItem>
                    <BulletItem muted>Persistência: salva no Supabase (packs, ads, ad_metrics)</BulletItem>
                  </ul>
                </div>
                <div>
                  <span className="text-sm font-medium text-foreground">Tratamento de Erros</span>
                  <ul className="mt-1.5 space-y-1">
                    <BulletItem muted>Código 190: token expirado → marca conexão como &quot;expired&quot;</BulletItem>
                    <BulletItem muted>Cache de token com TTL de 5 min e circuit breaker de 1 min</BulletItem>
                    <BulletItem muted>Timeouts: insights 60s, job status 30s, detalhes de ad 90s</BulletItem>
                    <BulletItem muted>Se Meta pede &quot;reduce data&quot;, batch é dividido pela metade automaticamente</BulletItem>
                  </ul>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* OAuth Flow */}
          <AccordionItem value="meta-oauth-flow">
            <AccordionTrigger>
              <span className="font-medium">Fluxo OAuth (alto nível)</span>
            </AccordionTrigger>
            <AccordionContent>
              <ul className="space-y-1.5">
                {META_OAUTH_FLOW.map((item, i) => (
                  <BulletItem key={i} muted>
                    {item}
                  </BulletItem>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>

          {/* Security & Data */}
          <AccordionItem value="meta-security-data">
            <AccordionTrigger>
              <span className="font-medium">Segurança & tratamento de dados</span>
            </AccordionTrigger>
            <AccordionContent>
              <ul className="space-y-1.5">
                {META_SECURITY_AND_DATA.map((item, i) => (
                  <BulletItem key={i} muted>
                    {item}
                  </BulletItem>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>

          {/* App Review Checklist */}
          <AccordionItem value="meta-app-review">
            <AccordionTrigger>
              <span className="font-medium">Checklist (Meta App Review)</span>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4">
                {META_APP_REVIEW_CHECKLIST.map((section) => (
                  <div key={section.title}>
                    <span className="text-sm font-medium text-foreground">
                      {section.title}
                    </span>
                    <ul className="mt-1.5 space-y-1">
                      {section.items.map((item, i) => (
                        <BulletItem key={i} muted>
                          {item}
                        </BulletItem>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </StandardCard>

      {/* ── Supabase Tables ── */}
      <StandardCard padding="lg">
        <SectionTitle icon={IconDatabase}>Banco de Dados (Supabase)</SectionTitle>
        <p className="text-sm text-muted-foreground mb-1">
          Todas as tabelas possuem <strong className="text-foreground">Row Level Security (RLS)</strong> habilitado.
          Cada usuário só acessa seus próprios dados via <code className="text-xs bg-muted-50 px-1.5 py-0.5 rounded font-mono">user_id = auth.uid()</code>.
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          Tokens OAuth são armazenados criptografados no banco.
        </p>

        <Accordion type="multiple" defaultValue={[]}>
          {SUPABASE_TABLES.map((table) => (
            <AccordionItem key={table.id} value={`table-${table.id}`}>
              <AccordionTrigger>
                <div className="flex items-center gap-3">
                  <code className="text-xs font-mono text-yellow-500">{table.name}</code>
                  <span className="text-xs text-muted-foreground font-normal hidden sm:inline">
                    {table.description}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <p className="text-muted-foreground mb-3 sm:hidden">{table.description}</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-1.5 pr-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Coluna</th>
                        <th className="text-left py-1.5 pr-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Tipo</th>
                        <th className="text-left py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">Descrição</th>
                      </tr>
                    </thead>
                    <tbody>
                      {table.columns.map((col) => (
                        <tr key={col.name} className="border-b border-border/50">
                          <td className="py-1.5 pr-3">
                            <code className="text-xs font-mono text-foreground">{col.name}</code>
                          </td>
                          <td className="py-1.5 pr-3">
                            <code className="text-[11px] font-mono text-muted-foreground">{col.type}</code>
                          </td>
                          <td className="py-1.5 text-xs text-muted-foreground">{col.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </StandardCard>
    </PageContainer>
  );
}
