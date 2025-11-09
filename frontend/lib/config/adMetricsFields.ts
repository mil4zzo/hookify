/**
 * Configuração dos campos disponíveis da tabela ad_metrics para uso em filtros de validação
 * Baseado no schema do Supabase (supabase/schema.sql)
 */

export interface AdMetricsField {
  label: string;
  value: string;
  type: "text" | "numeric" | "integer" | "date";
  description?: string;
}

/**
 * Campos de texto (strings) da tabela ad_metrics
 */
export const TEXT_FIELDS: AdMetricsField[] = [
  { label: "Campaign Name", value: "campaign_name", type: "text", description: "Nome da campanha" },
  { label: "Adset Name", value: "adset_name", type: "text", description: "Nome do conjunto de anúncios" },
  { label: "Ad Name", value: "ad_name", type: "text", description: "Nome do anúncio" },
  { label: "Account ID", value: "account_id", type: "text", description: "ID da conta do Facebook" },
  { label: "Campaign ID", value: "campaign_id", type: "text", description: "ID da campanha" },
  { label: "Adset ID", value: "adset_id", type: "text", description: "ID do conjunto de anúncios" },
  { label: "Ad ID", value: "ad_id", type: "text", description: "ID do anúncio" },
];

/**
 * Campos numéricos (inteiros) da tabela ad_metrics
 */
export const INTEGER_FIELDS: AdMetricsField[] = [
  { label: "Clicks", value: "clicks", type: "integer", description: "Número de cliques" },
  { label: "Impressions", value: "impressions", type: "integer", description: "Número de impressões" },
  { label: "Inline Link Clicks", value: "inline_link_clicks", type: "integer", description: "Cliques em links inline" },
  { label: "Reach", value: "reach", type: "integer", description: "Alcance" },
  { label: "Video Total Plays", value: "video_total_plays", type: "integer", description: "Total de reproduções de vídeo" },
  { label: "Video Total Thruplays", value: "video_total_thruplays", type: "integer", description: "Reproduções completas de vídeo" },
  { label: "Video Watched P50", value: "video_watched_p50", type: "integer", description: "Tempo médio assistido (percentil 50)" },
];

/**
 * Campos numéricos (decimais) da tabela ad_metrics
 */
export const NUMERIC_FIELDS: AdMetricsField[] = [
  { label: "Spend", value: "spend", type: "numeric", description: "Valor gasto" },
  { label: "CPM", value: "cpm", type: "numeric", description: "Custo por mil impressões" },
  { label: "CTR", value: "ctr", type: "numeric", description: "Taxa de clique" },
  { label: "Frequency", value: "frequency", type: "numeric", description: "Frequência média" },
  { label: "Website CTR", value: "website_ctr", type: "numeric", description: "Taxa de clique no site" },
  { label: "Connect Rate", value: "connect_rate", type: "numeric", description: "Taxa de conexão" },
  { label: "Profile CTR", value: "profile_ctr", type: "numeric", description: "Taxa de clique no perfil" },
];

/**
 * Campos de data da tabela ad_metrics
 */
export const DATE_FIELDS: AdMetricsField[] = [
  { label: "Date", value: "date", type: "date", description: "Data da métrica" },
];

/**
 * Todos os campos disponíveis para filtros de validação
 */
export const ALL_AD_METRICS_FIELDS: AdMetricsField[] = [
  ...TEXT_FIELDS,
  ...INTEGER_FIELDS,
  ...NUMERIC_FIELDS,
  ...DATE_FIELDS,
];

/**
 * Retorna os campos disponíveis formatados para uso em selects
 */
export function getAdMetricsFieldsForSelect(): Array<{ label: string; value: string }> {
  return ALL_AD_METRICS_FIELDS.map((field) => ({
    label: field.label,
    value: field.value,
  }));
}

/**
 * Retorna informações sobre um campo específico
 */
export function getFieldInfo(fieldValue: string): AdMetricsField | undefined {
  return ALL_AD_METRICS_FIELDS.find((field) => field.value === fieldValue);
}

/**
 * Operadores disponíveis para campos de texto
 */
export const TEXT_OPERATORS = [
  { label: "Contém", value: "CONTAIN" },
  { label: "É igual a", value: "EQUAL" },
  { label: "Não é igual a", value: "NOT_EQUAL" },
  { label: "Não contém", value: "NOT_CONTAIN" },
  { label: "Começa com", value: "STARTS_WITH" },
  { label: "Termina com", value: "ENDS_WITH" },
];

/**
 * Operadores disponíveis para campos numéricos (integer e numeric)
 */
export const NUMERIC_OPERATORS = [
  { label: "É igual a", value: "EQUAL" },
  { label: "Não é igual a", value: "NOT_EQUAL" },
  { label: "Maior que", value: "GREATER_THAN" },
  { label: "Maior ou igual a", value: "GREATER_THAN_OR_EQUAL" },
  { label: "Menor que", value: "LESS_THAN" },
  { label: "Menor ou igual a", value: "LESS_THAN_OR_EQUAL" },
];

/**
 * Operadores disponíveis para campos de data
 */
export const DATE_OPERATORS = [
  { label: "É igual a", value: "EQUAL" },
  { label: "Antes de", value: "BEFORE" },
  { label: "Depois de", value: "AFTER" },
  { label: "Entre", value: "BETWEEN" },
];

/**
 * Retorna os operadores disponíveis baseado no tipo do campo
 */
export function getOperatorsForFieldType(fieldType: "text" | "numeric" | "integer" | "date" | undefined): Array<{ label: string; value: string }> {
  if (!fieldType) {
    return TEXT_OPERATORS; // fallback padrão
  }

  switch (fieldType) {
    case "text":
      return TEXT_OPERATORS;
    case "numeric":
    case "integer":
      return NUMERIC_OPERATORS;
    case "date":
      return DATE_OPERATORS;
    default:
      return TEXT_OPERATORS; // fallback
  }
}

/**
 * Verifica se um operador é válido para um tipo de campo
 */
export function isOperatorValidForFieldType(operator: string, fieldType: "text" | "numeric" | "integer" | "date" | undefined): boolean {
  const validOperators = getOperatorsForFieldType(fieldType);
  return validOperators.some((op) => op.value === operator);
}

