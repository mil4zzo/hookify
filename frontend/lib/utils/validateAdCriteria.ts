/**
 * Utilitário para avaliar se um anúncio atende aos critérios de validação
 */

import { ValidationCondition } from "@/components/common/ValidationCriteriaBuilder";
import { getFieldInfo, getOperatorsForFieldType } from "@/lib/config/adMetricsFields";

/**
 * Tipo para representar as métricas de um anúncio
 */
export interface AdMetricsData {
  [key: string]: any;
  // Campos de texto
  campaign_name?: string;
  adset_name?: string;
  ad_name?: string;
  account_id?: string;
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  // Campos numéricos
  clicks?: number;
  impressions?: number;
  inline_link_clicks?: number;
  reach?: number;
  video_total_plays?: number;
  plays?: number; // Campo alternativo para video_total_plays
  video_total_thruplays?: number;
  video_watched_p50?: number;
  spend?: number;
  cpm?: number;
  ctr?: number;
  frequency?: number;
  website_ctr?: number;
  connect_rate?: number;
  profile_ctr?: number;
  // Campos derivados
  cpr?: number;
  page_conv?: number;
  hook?: number;
  overall_conversion?: number; // website_ctr * connect_rate * page_conv
  // Data
  date?: string;
}

/**
 * Avalia uma condição individual contra as métricas do anúncio
 */
function evaluateCondition(condition: ValidationCondition, metrics: AdMetricsData): boolean {
  if (condition.type !== "condition" || !condition.field || !condition.operator || condition.value === undefined) {
    return false;
  }

  const fieldValue = metrics[condition.field];
  const conditionValue = condition.value;
  const operator = condition.operator;

  // Se o campo não existe nas métricas, retorna false
  if (fieldValue === undefined || fieldValue === null) {
    return false;
  }

  const fieldInfo = getFieldInfo(condition.field);
  const fieldType = fieldInfo?.type || "text";

  // Converter valores para comparação
  let metricValue: any = fieldValue;
  let compareValue: any = conditionValue;

  if (fieldType === "integer" || fieldType === "numeric") {
    metricValue = Number(metricValue);
    compareValue = Number(compareValue);
    
    if (isNaN(metricValue) || isNaN(compareValue)) {
      return false;
    }
  }

  // Avaliar operador
  switch (operator) {
    case "EQUAL":
      return metricValue === compareValue;
    case "NOT_EQUAL":
      return metricValue !== compareValue;
    case "GREATER_THAN":
      return metricValue > compareValue;
    case "GREATER_THAN_OR_EQUAL":
      return metricValue >= compareValue;
    case "LESS_THAN":
      return metricValue < compareValue;
    case "LESS_THAN_OR_EQUAL":
      return metricValue <= compareValue;
    case "CONTAIN":
      return String(metricValue).toLowerCase().includes(String(compareValue).toLowerCase());
    case "NOT_CONTAIN":
      return !String(metricValue).toLowerCase().includes(String(compareValue).toLowerCase());
    case "STARTS_WITH":
      return String(metricValue).toLowerCase().startsWith(String(compareValue).toLowerCase());
    case "ENDS_WITH":
      return String(metricValue).toLowerCase().endsWith(String(compareValue).toLowerCase());
    default:
      return false;
  }
}

/**
 * Avalia um grupo de condições contra as métricas do anúncio
 */
function evaluateGroup(
  group: ValidationCondition,
  metrics: AdMetricsData,
  globalLogic: "AND" | "OR" = "AND"
): boolean {
  if (group.type !== "group" || !group.conditions || group.conditions.length === 0) {
    return false;
  }

  const groupLogic = group.groupLogic || "OR";
  const results = group.conditions.map((condition) => {
    if (condition.type === "condition") {
      return evaluateCondition(condition, metrics);
    } else if (condition.type === "group") {
      return evaluateGroup(condition, metrics, globalLogic);
    }
    return false;
  });

  // Aplicar lógica do grupo (AND ou OR)
  if (groupLogic === "AND") {
    return results.every((r) => r === true);
  } else {
    return results.some((r) => r === true);
  }
}

/**
 * Avalia se um anúncio atende a todos os critérios de validação
 * @param conditions - Array de condições de validação
 * @param metrics - Métricas do anúncio
 * @param globalLogic - Operador lógico global (AND ou OR) para conectar condições/grupos
 * @returns true se o anúncio atende aos critérios, false caso contrário
 */
export function evaluateValidationCriteria(
  conditions: ValidationCondition[],
  metrics: AdMetricsData,
  globalLogic: "AND" | "OR" = "AND"
): boolean {
  if (!conditions || conditions.length === 0) {
    // Se não há critérios, considera válido (não filtra)
    return true;
  }

  const results = conditions.map((condition) => {
    if (condition.type === "condition") {
      return evaluateCondition(condition, metrics);
    } else if (condition.type === "group") {
      return evaluateGroup(condition, metrics, globalLogic);
    }
    return false;
  });

  // Aplicar lógica global (AND ou OR)
  if (globalLogic === "AND") {
    return results.every((r) => r === true);
  } else {
    return results.some((r) => r === true);
  }
}

/**
 * Agrega métricas de múltiplos anúncios para avaliação em grupo (ad_name)
 * Soma campos numéricos e mantém campos de texto do primeiro item
 */
export function aggregateMetricsForGroup(ads: AdMetricsData[]): AdMetricsData {
  if (!ads || ads.length === 0) {
    return {};
  }

  if (ads.length === 1) {
    return ads[0];
  }

  const aggregated: AdMetricsData = {
    // Campos de texto do primeiro item
    campaign_name: ads[0].campaign_name,
    adset_name: ads[0].adset_name,
    ad_name: ads[0].ad_name,
    account_id: ads[0].account_id,
    campaign_id: ads[0].campaign_id,
    adset_id: ads[0].adset_id,
    ad_id: ads[0].ad_id,
  };

  // Agregar campos numéricos (soma)
  const numericFields = [
    "clicks",
    "impressions",
    "inline_link_clicks",
    "reach",
    "video_total_plays",
    "video_total_thruplays",
    "video_watched_p50",
    "spend",
  ];

  numericFields.forEach((field) => {
    if (field === "video_total_plays") {
      // video_total_plays pode vir como "plays" ou "video_total_plays"
      aggregated[field] = ads.reduce((sum, ad) => {
        const plays = Number(ad.video_total_plays) || Number(ad.plays) || 0;
        return sum + plays;
      }, 0);
    } else {
      aggregated[field] = ads.reduce((sum, ad) => sum + (Number(ad[field]) || 0), 0);
    }
  });

  // Calcular métricas derivadas agregadas
  const totalSpend = aggregated.spend || 0;
  const totalImpressions = aggregated.impressions || 0;
  const totalClicks = aggregated.clicks || 0;
  const totalInlineLinkClicks = aggregated.inline_link_clicks || 0;
  const totalReach = aggregated.reach || 0;
  const totalPlays = aggregated.video_total_plays || 0;

  // CTR agregado
  aggregated.ctr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;

  // CPM agregado - usar do backend se disponível, senão calcular
  // Se todos os ads têm cpm do backend, usar média ponderada por impressions
  const adsWithCpm = ads.filter((ad) => typeof (ad as any).cpm === "number" && !Number.isNaN((ad as any).cpm));
  if (adsWithCpm.length === ads.length && totalImpressions > 0) {
    // Média ponderada por impressions
    const cpmWeightedSum = ads.reduce((sum, ad) => {
      const cpm = (ad as any).cpm || 0;
      const impressions = Number(ad.impressions || 0);
      return sum + cpm * impressions;
    }, 0);
    aggregated.cpm = cpmWeightedSum / totalImpressions;
  } else {
    // Fallback: calcular se não todos têm cpm do backend
    aggregated.cpm = totalImpressions > 0 ? (totalSpend * 1000) / totalImpressions : 0;
  }

  // Frequency agregado
  aggregated.frequency = totalReach > 0 ? totalImpressions / totalReach : 0;

  // Website CTR agregado - usar do backend se disponível, senão calcular
  const adsWithWebsiteCtr = ads.filter((ad) => typeof (ad as any).website_ctr === "number" && !Number.isNaN((ad as any).website_ctr));
  if (adsWithWebsiteCtr.length === ads.length && totalImpressions > 0) {
    // Média ponderada por impressions
    const websiteCtrWeightedSum = ads.reduce((sum, ad) => {
      const websiteCtr = (ad as any).website_ctr || 0;
      const impressions = Number(ad.impressions || 0);
      return sum + websiteCtr * impressions;
    }, 0);
    aggregated.website_ctr = websiteCtrWeightedSum / totalImpressions;
  } else {
    // Fallback: calcular se não todos têm website_ctr do backend
    aggregated.website_ctr = totalImpressions > 0 ? totalInlineLinkClicks / totalImpressions : 0;
  }

  // Hook agregado (média ponderada por plays)
  const hookWeightedSum = ads.reduce((sum, ad) => {
    const hook = Number(ad.hook) || 0;
    const plays = Number(ad.video_total_plays) || Number(ad.plays) || 0;
    return sum + hook * plays;
  }, 0);
  aggregated.hook = totalPlays > 0 ? hookWeightedSum / totalPlays : 0;

  // Connect rate agregado (lpv / inline_link_clicks)
  const totalLpv = ads.reduce((sum, ad) => {
    const actions = ad.actions || [];
    const lpvAction = actions.find((a: any) => a.action_type === "landing_page_view");
    return sum + (lpvAction?.value || 0);
  }, 0);
  aggregated.connect_rate = totalInlineLinkClicks > 0 ? totalLpv / totalInlineLinkClicks : 0;

  // Page conv agregado (results / lpv)
  const totalResults = ads.reduce((sum, ad) => {
    const conversions = ad.conversions || {};
    // Soma todas as conversões (ou pode ser específico por actionType)
    return sum + Object.values(conversions).reduce((convSum: number, val: any) => convSum + (Number(val) || 0), 0);
  }, 0);
  aggregated.page_conv = totalLpv > 0 ? totalResults / totalLpv : 0;

  // CPR agregado (spend / results)
  aggregated.cpr = totalResults > 0 ? totalSpend / totalResults : 0;

  // Overall conversion agregado (website_ctr * connect_rate * page_conv)
  aggregated.overall_conversion = (aggregated.website_ctr || 0) * (aggregated.connect_rate || 0) * (aggregated.page_conv || 0);

  return aggregated;
}

