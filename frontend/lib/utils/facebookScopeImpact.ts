/**
 * Mapa de impacto por scope do Facebook OAuth.
 *
 * Backend persiste em `facebook_connections.scopes` apenas os scopes que
 * vieram `granted` do `/me/permissions`, e `missing_scopes` é calculado
 * server-side comparando contra a lista de scopes críticos.
 *
 * Os textos abaixo são consumidos pelo `FacebookConnectionCard` quando a
 * connection está com `status='degraded'`. Mantidos em PT-BR pra exibição
 * direta ao usuário sem i18n adicional.
 */

export type ScopeCriticality = "blocking" | "high" | "medium" | "low";

export interface ScopeImpact {
  /** Nome curto, exibido como título do item na lista */
  label: string;
  /** Texto explicando o que o usuário perde sem essa permissão */
  impact: string;
  /** Severidade do impacto operacional */
  criticality: ScopeCriticality;
}

export const SCOPE_IMPACTS: Record<string, ScopeImpact> = {
  ads_read: {
    label: "Ler dados de anúncios",
    criticality: "blocking",
    impact:
      "Sem essa permissão a conexão é inútil — nenhuma conta de anúncios pode ser lida. Reconecte autorizando todas as permissões.",
  },
  ads_management: {
    label: "Gerenciar anúncios",
    criticality: "high",
    impact:
      "Você poderá visualizar seus anúncios, mas não poderá criar, editar ou pausar anúncios pela Hookify.",
  },
  business_management: {
    label: "Gerenciar Business Manager",
    criticality: "high",
    impact:
      "Contas de anúncios ligadas a um Business Manager não vão aparecer nem atualizar — só contas pessoais.",
  },
  pages_show_list: {
    label: "Listar Páginas",
    criticality: "medium",
    impact:
      "Sem essa permissão a Hookify não consegue obter o Page Access Token, necessário pra ler mídias de muitos anúncios. Thumbnails, vídeos e prévias podem ficar quebrados, e você não conseguirá criar anúncios novos (o seletor de Página fica vazio).",
  },
  pages_read_engagement: {
    label: "Ler engajamento de Páginas",
    criticality: "low",
    impact:
      "Algumas leituras avançadas de Página podem falhar (insights de posts orgânicos, leitura específica).",
  },
};

export function getScopeImpact(scope: string): ScopeImpact | undefined {
  return SCOPE_IMPACTS[scope];
}
