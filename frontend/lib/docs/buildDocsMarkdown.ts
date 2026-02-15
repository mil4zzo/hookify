/**
 * Gera a documentação completa da plataforma em Markdown.
 * Espelha o conteúdo exibido na página /docs para exportação.
 */

export interface PageDocInput {
  id: string;
  title: string;
  path: string;
  summary: string;
  features: string[];
}

export interface MetaPermission {
  scope: string;
  description: string;
  usedFor?: string[];
  appReviewNotes?: string[];
}

export interface MetaEndpoint {
  method: string;
  path: string;
  description: string;
}

export interface MetaMetric {
  category: string;
  metrics: string;
}

export interface MetaParam {
  param: string;
  value: string;
  description: string;
}

export interface TableColumnInput {
  name: string;
  type: string;
  description: string;
}

export interface TableDocInput {
  id: string;
  name: string;
  description: string;
  columns: TableColumnInput[];
}

export interface DocsMarkdownConfig {
  pageDocs: PageDocInput[];
  metaBaseUrlTemplate?: string;
  metaCurrentVersion?: string;
  metaPermissions: MetaPermission[];
  metaEndpoints: MetaEndpoint[];
  metaMetrics: MetaMetric[];
  metaParams: MetaParam[];
  supabaseTables: TableDocInput[];
  metaOAuthFlow?: string[];
  metaAppReviewChecklist?: Array<{ title: string; items: string[] }>;
  metaSecurityAndData?: string[];
}

export function buildFullDocsMarkdown(config: DocsMarkdownConfig): string {
  const {
    pageDocs,
    metaBaseUrlTemplate,
    metaCurrentVersion,
    metaPermissions,
    metaEndpoints,
    metaMetrics,
    metaParams,
    supabaseTables,
    metaOAuthFlow,
    metaAppReviewChecklist,
    metaSecurityAndData,
  } = config;

  const sections: string[] = [];

  // Título e intro
  sections.push("# Documentação Hookify\n");
  sections.push("Entenda como utilizar cada funcionalidade da plataforma Hookify.\n");

  // Hero - O que é o Hookify
  sections.push("## O que é o Hookify?\n");
  sections.push(
    "O Hookify é uma plataforma de análise e otimização de anúncios do Facebook Ads. " +
      "Ele permite que você importe seus dados de anúncios, analise a performance em profundidade " +
      "e identifique oportunidades de melhoria de forma visual e intuitiva.\n"
  );
  sections.push(
    "**Fluxo de uso:** Packs → Manager → Insights → G.O.L.D.\n"
  );

  // Páginas
  sections.push("## Páginas da plataforma\n");
  for (const page of pageDocs) {
    sections.push(`### ${page.title} (\`${page.path}\`)\n`);
    sections.push(`${page.summary}\n`);
    sections.push("**Funcionalidades:**\n");
    for (const f of page.features) {
      sections.push(`- ${f}\n`);
    }
    sections.push("\n");
  }

  // Dicas rápidas
  sections.push("## Dicas rápidas\n");
  sections.push("- Comece criando seus packs na página **Packs** para importar seus anúncios.\n");
  sections.push(
    "- Os filtros de pack, data e tipo de conversão são compartilhados entre Manager, Insights e G.O.L.D.\n"
  );
  sections.push(
    "- Configure os critérios de validação para garantir que apenas anúncios com dados suficientes sejam analisados.\n"
  );

  // Referência técnica - Meta API
  sections.push("---\n");
  sections.push("## Referência Técnica\n");
  sections.push("Documentação técnica para desenvolvedores sobre a API do Meta e o banco de dados.\n");

  sections.push("### Meta Marketing API\n");
  if (metaBaseUrlTemplate) {
    sections.push(`Base URL: \`${metaBaseUrlTemplate}\`\n`);
    if (metaCurrentVersion) {
      sections.push(`Versão atual usada: \`${metaCurrentVersion}\`\n`);
    }
  } else {
    sections.push("Base URL: `https://graph.facebook.com/{VERSION}/`\n");
  }

  sections.push("#### Permissões OAuth\n");
  for (const p of metaPermissions) {
    sections.push(`- \`${p.scope}\`: ${p.description}\n`);
    if (p.usedFor?.length) {
      for (const use of p.usedFor) sections.push(`  - Uso: ${use}\n`);
    }
    if (p.appReviewNotes?.length) {
      for (const note of p.appReviewNotes) sections.push(`  - App Review: ${note}\n`);
    }
  }

  sections.push("\n#### Endpoints\n");
  for (const e of metaEndpoints) {
    sections.push(`- **${e.method}** \`${e.path}\` — ${e.description}\n`);
  }

  sections.push("\n#### Métricas Coletadas\n");
  for (const m of metaMetrics) {
    sections.push(`- **${m.category}:** \`${m.metrics}\`\n`);
  }

  sections.push("\n#### Parâmetros da Requisição\n");
  for (const p of metaParams) {
    sections.push(`- \`${p.param}\` = \`${p.value}\`: ${p.description}\n`);
  }

  sections.push("\n#### Arquitetura de Coleta (2 Fases)\n");
  sections.push("**Fase 1 — Meta API Processing**\n");
  sections.push("- POST /{act_id}/insights com async=true → retorna report_run_id\n");
  sections.push("- Polling do status do job (máx. 60 polls × 5s = 5 min)\n");
  sections.push("- Quando completo, dispara Fase 2 em background\n\n");
  sections.push("**Fase 2 — Background Processing**\n");
  sections.push("- Paginação: coleta todos os insights (500 por página)\n");
  sections.push("- Enriquecimento: busca criativos (1 por ad_name) + status por ad_id\n");
  sections.push("- Formatação: converte para schema do frontend\n");
  sections.push("- Persistência: salva no Supabase (packs, ads, ad_metrics)\n\n");
  sections.push("**Tratamento de Erros**\n");
  sections.push("- Código 190: token expirado → marca conexão como \"expired\"\n");
  sections.push("- Cache de token com TTL de 5 min e circuit breaker de 1 min\n");
  sections.push("- Timeouts: insights 60s, job status 30s, detalhes de ad 90s\n");
  sections.push('- Se Meta pede "reduce data", batch é dividido pela metade automaticamente\n');

  if (metaOAuthFlow?.length) {
    sections.push("\n#### Fluxo OAuth (alto nível)\n");
    for (const item of metaOAuthFlow) sections.push(`- ${item}\n`);
  }

  if (metaSecurityAndData?.length) {
    sections.push("\n#### Segurança & tratamento de dados\n");
    for (const item of metaSecurityAndData) sections.push(`- ${item}\n`);
  }

  if (metaAppReviewChecklist?.length) {
    sections.push("\n#### Checklist (Meta App Review)\n");
    for (const section of metaAppReviewChecklist) {
      sections.push(`- **${section.title}**\n`);
      for (const item of section.items) sections.push(`  - ${item}\n`);
    }
  }

  // Supabase
  sections.push("### Banco de Dados (Supabase)\n");
  sections.push(
    "Todas as tabelas possuem **Row Level Security (RLS)** habilitado. " +
      "Cada usuário só acessa seus próprios dados via `user_id = auth.uid()`.\n"
  );
  sections.push("Tokens OAuth são armazenados criptografados no banco.\n");

  for (const table of supabaseTables) {
    sections.push(`#### Tabela: \`${table.name}\`\n`);
    sections.push(`${table.description}\n\n`);
    sections.push("| Coluna | Tipo | Descrição |\n");
    sections.push("|--------|------|----------|\n");
    for (const col of table.columns) {
      const name = col.name.replace(/\|/g, "\\|");
      const type = col.type.replace(/\|/g, "\\|");
      const desc = col.description.replace(/\|/g, "\\|");
      sections.push(`| ${name} | ${type} | ${desc} |\n`);
    }
    sections.push("\n");
  }

  return sections.join("");
}
