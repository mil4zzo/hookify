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

import { translate } from "@/lib/i18n/translate";

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
    get label() {
      return translate("utils.scopes.ads_read.label");
    },
    criticality: "blocking",
    get impact() {
      return translate("utils.scopes.ads_read.impact");
    },
  },
  ads_management: {
    get label() {
      return translate("utils.scopes.ads_management.label");
    },
    criticality: "high",
    get impact() {
      return translate("utils.scopes.ads_management.impact");
    },
  },
  business_management: {
    get label() {
      return translate("utils.scopes.business_management.label");
    },
    criticality: "high",
    get impact() {
      return translate("utils.scopes.business_management.impact");
    },
  },
  pages_show_list: {
    get label() {
      return translate("utils.scopes.pages_show_list.label");
    },
    criticality: "medium",
    get impact() {
      return translate("utils.scopes.pages_show_list.impact");
    },
  },
  pages_read_engagement: {
    get label() {
      return translate("utils.scopes.pages_read_engagement.label");
    },
    criticality: "low",
    get impact() {
      return translate("utils.scopes.pages_read_engagement.impact");
    },
  },
};

export function getScopeImpact(scope: string): ScopeImpact | undefined {
  return SCOPE_IMPACTS[scope];
}
