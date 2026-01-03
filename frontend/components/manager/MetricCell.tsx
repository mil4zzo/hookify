"use client";

import React from "react";
import { SparklineBars } from "@/components/common/SparklineBars";
import { RankingsItem } from "@/lib/api/schemas";
import { computeMqlMetricsFromLeadscore } from "@/lib/utils/mqlMetrics";

type ManagerAverages = {
  count: number;
  spend: number;
  impressions: number;
  clicks: number;
  inline_link_clicks: number;
  lpv: number;
  plays: number;
  results: number;
  hook: number | null;
  scroll_stop: number | null;
  ctr: number | null;
  website_ctr: number | null;
  connect_rate: number | null;
  cpm: number | null;
  cpr: number | null;
  page_conv: number | null;
  cpmql: number | null;
  mqls: number;
};

interface MetricCellProps {
  row: RankingsItem | { original?: RankingsItem };
  value: React.ReactNode;
  metric: "hook" | "cpr" | "spend" | "ctr" | "website_ctr" | "connect_rate" | "page_conv" | "cpm" | "cpmql" | "results" | "mqls";
  getRowKey: (row: any) => string;
  byKey: Map<string, any>;
  endDate?: string;
  showTrends?: boolean;
  averages: ManagerAverages;
  formatCurrency: (n: number) => string;
  actionType?: string;
  hasSheetIntegration?: boolean;
  mqlLeadscoreMin?: number;
  minimal?: boolean; // Prop para modo minimal
}

// Custom comparison function for React.memo
function arePropsEqual(prev: MetricCellProps, next: MetricCellProps): boolean {
  // Value comparison removida: value é sempre um novo ReactNode criado inline,
  // então a comparação sempre retorna false, tornando o memo ineficaz.
  // O valor real já é verificado através da comparação do row.original abaixo.

  // Metric comparison
  if (prev.metric !== next.metric) return false;

  // Row comparison (check original object reference)
  const prevOriginal = "original" in prev.row ? prev.row.original : prev.row;
  const nextOriginal = "original" in next.row ? next.row.original : next.row;
  if (prevOriginal !== nextOriginal) return false;

  // Primitive props
  if (prev.endDate !== next.endDate) return false;
  if (prev.showTrends !== next.showTrends) return false;
  if (prev.actionType !== next.actionType) return false;
  if (prev.hasSheetIntegration !== next.hasSheetIntegration) return false;
  if (prev.mqlLeadscoreMin !== next.mqlLeadscoreMin) return false;
  if (prev.minimal !== next.minimal) return false;

  // Function references (should be stable if parent uses useCallback)
  if (prev.getRowKey !== next.getRowKey) return false;
  if (prev.formatCurrency !== next.formatCurrency) return false;

  // Map reference comparison (byKey should be stable via useMemo)
  if (prev.byKey !== next.byKey) return false;

  // Averages comparison (compare relevant metric average only)
  const avgKey = prev.metric === "cpmql" ? "cpmql" : prev.metric;
  if (prev.averages[avgKey] !== next.averages[avgKey]) return false;

  return true;
}

export const MetricCell = React.memo(function MetricCell({ row, value, metric, getRowKey, byKey, endDate, showTrends, averages, formatCurrency, actionType, hasSheetIntegration, mqlLeadscoreMin, minimal = false }: MetricCellProps) {
  // row já é o objeto agregado (info.row.original), então precisamos ajustar
  const original: RankingsItem = ("original" in row ? row.original : row) as RankingsItem;
  const rowKey = getRowKey(row);
  const dates = original.series?.axis || (endDate ? byKey.get(rowKey)?.axis : null);

  // Para CPR e Page, calcular a partir das séries disponíveis se não vierem do backend
  let s: Array<number | null> | undefined = undefined;

  // Primeiro, tentar obter do backend ou do byKey
  const serverSeries = original.series ? (original.series as any)[metric] : undefined;
  s = serverSeries || (endDate ? (byKey.get(rowKey)?.series as any)?.[metric] : null);

  // Se não encontramos CPR, Page, Results ou MQLs nas séries, calcular a partir das séries disponíveis
  if ((s === undefined || s === null) && (metric === "cpr" || metric === "page_conv" || metric === "results" || metric === "mqls")) {
    const seriesData = original.series ? (original.series as any) : endDate ? byKey.get(rowKey)?.series : undefined;
    if (seriesData) {
      const spendSeries = seriesData.spend || [];
      const lpvSeries = seriesData.lpv || [];
      const conversionsSeries = seriesData.conversions || [];
      const leadscoreSeries = seriesData.leadscore_values || [];

      if (metric === "cpr") {
        // CPR = spend / results (onde results vem de conversions[actionType])
        s = spendSeries.map((spend: number | null, idx: number) => {
          if (spend == null || spend <= 0) return null;
          const dayConversions = conversionsSeries[idx];
          if (!dayConversions || typeof dayConversions !== "object" || Array.isArray(dayConversions)) return null;
          const results = actionType && actionType.trim() ? Number(dayConversions[actionType] || 0) : 0;
          return results > 0 ? spend / results : null;
        });
      } else if (metric === "page_conv") {
        // Page conv = results / lpv
        s = lpvSeries.map((lpv: number | null, idx: number) => {
          if (lpv == null || lpv <= 0) return null;
          const dayConversions = conversionsSeries[idx];
          if (!dayConversions || typeof dayConversions !== "object" || Array.isArray(dayConversions)) return null;
          const results = actionType && actionType.trim() ? Number(dayConversions[actionType] || 0) : 0;
          return results > 0 ? results / lpv : null;
        });
      } else if (metric === "results") {
        // Results = conversions[actionType]
        s = conversionsSeries.map((dayConversions: any) => {
          if (!dayConversions || typeof dayConversions !== "object" || Array.isArray(dayConversions)) return null;
          const results = actionType && actionType.trim() ? Number(dayConversions[actionType] || 0) : 0;
          return results > 0 ? results : null;
        });
      } else if (metric === "mqls") {
        // MQLs vem diretamente do backend via seriesData.mqls
        // Fallback: calcular a partir de leadscore_values (para dados antigos)
        const mqlsSeries = seriesData.mqls || [];
        if (mqlsSeries.length > 0) {
          s = mqlsSeries;
        } else if (leadscoreSeries.length > 0) {
          // Fallback: calcular a partir de leadscore_values
          s = leadscoreSeries.map((leadscoreValues: any, idx: number) => {
            if (!leadscoreValues) return null;
            const spend = spendSeries[idx];
            const { mqlCount } = computeMqlMetricsFromLeadscore({
              spend: Number(spend || 0),
              leadscoreRaw: leadscoreValues,
              mqlLeadscoreMin: mqlLeadscoreMin || 0,
            });
            return mqlCount > 0 ? mqlCount : null;
          });
        }
      }
    }
  }

  // Normalizar s para sempre ser um array (padronizar undefined → array de nulls)
  // Isso garante que sempre renderizamos o sparkline, mesmo quando não há dados
  const normalizedSeries = s || (dates ? Array(dates.length).fill(null) : Array(5).fill(null));

  // Determinar se a métrica é "inversa" (menor é melhor: CPR, CPM e CPMQL)
  const isInverseMetric = metric === "cpr" || metric === "cpm" || metric === "cpmql";

  // Se showTrends estiver ativo, mostrar sparklines
  if (showTrends) {
    // Obter média do pack para esta métrica
    const avgValue = metric === "cpmql" ? (averages as any).cpmql : averages[metric];

    // Para spend, usar modo de tendência (byTrend) em vez de comparação com média
    const useTrendMode = metric === "spend";
    const packAverageForMetric = useTrendMode ? null : avgValue != null && Number.isFinite(avgValue) ? avgValue : null;

    // Obter série apropriada para determinar disponibilidade de dados baseada na métrica
    const seriesData = original.series ? (original.series as any) : undefined;
    let dataAvailability: boolean[] = [];
    let zeroValueLabel: string | undefined;

    if (seriesData) {
      switch (metric) {
        case "hook":
          // Hook precisa de plays, mas podemos usar impressions como proxy (se há impressões, pode haver plays)
          const impressionsForHook = seriesData.impressions || [];
          dataAvailability = impressionsForHook.map((imp: number | null) => imp != null && imp > 0);
          zeroValueLabel = "Sem hook";
          break;
        case "ctr":
          // CTR precisa de impressions
          const impressionsForCtr = seriesData.impressions || [];
          dataAvailability = impressionsForCtr.map((imp: number | null) => imp != null && imp > 0);
          zeroValueLabel = "Sem cliques";
          break;
        case "website_ctr":
          // Website CTR precisa de impressions
          const impressionsForWebsiteCtr = seriesData.impressions || [];
          dataAvailability = impressionsForWebsiteCtr.map((imp: number | null) => imp != null && imp > 0);
          zeroValueLabel = "Sem cliques";
          break;
        case "connect_rate":
          // Connect rate precisa de inline_link_clicks, mas podemos usar impressions como proxy
          const impressionsForConnect = seriesData.impressions || [];
          dataAvailability = impressionsForConnect.map((imp: number | null) => imp != null && imp > 0);
          zeroValueLabel = "Sem conexões";
          break;
        case "page_conv":
          // Page conv precisa de lpv
          const lpvSeries = seriesData.lpv || [];
          dataAvailability = lpvSeries.map((lpv: number | null) => lpv != null && lpv > 0);
          zeroValueLabel = "Sem leads";
          break;
        case "cpr":
          // CPR precisa de spend (para saber se houve investimento)
          const spendForCpr = seriesData.spend || [];
          dataAvailability = spendForCpr.map((spend: number | null) => spend != null && spend > 0);
          zeroValueLabel = "Sem leads";
          break;
        case "cpmql":
          // CPMQL precisa de spend (para saber se houve investimento)
          const spendForCpmql = seriesData.spend || [];
          dataAvailability = spendForCpmql.map((spend: number | null) => spend != null && spend > 0);
          zeroValueLabel = "Sem MQLs";
          break;
        case "results":
          // Results precisa de conversions
          const conversionsForResults = seriesData.conversions || [];
          dataAvailability = conversionsForResults.map((dayConv: any) => {
            if (!dayConv || typeof dayConv !== "object" || Array.isArray(dayConv)) return false;
            const results = actionType && actionType.trim() ? Number(dayConv[actionType] || 0) : 0;
            return results > 0;
          });
          zeroValueLabel = "Sem leads";
          break;
        case "mqls":
          // MQLs: usar mqls series do backend se disponível
          const mqlsForAvail = seriesData.mqls || [];
          const leadscoreForMqls = seriesData.leadscore_values || [];
          if (mqlsForAvail.length > 0) {
            // Dados vêm diretamente do backend
            dataAvailability = mqlsForAvail.map((mqls: number | null) => mqls != null && mqls > 0);
          } else if (leadscoreForMqls.length > 0) {
            // Fallback: usar leadscore_values
            dataAvailability = leadscoreForMqls.map((ls: any) => ls != null);
          }
          zeroValueLabel = "Sem MQLs";
          break;
        case "cpm":
          // CPM precisa de impressions
          const impressionsForCpm = seriesData.impressions || [];
          dataAvailability = impressionsForCpm.map((imp: number | null) => imp != null && imp > 0);
          // CPM não precisa de label especial, 0 é um valor válido
          break;
        case "spend":
          // Spend sempre tem dados se existe (não precisa de label especial)
          const spendSeries = seriesData.spend || [];
          dataAvailability = spendSeries.map((spend: number | null) => spend != null && spend > 0);
          break;
        default:
          // Para outras métricas, usar spend como fallback
          const fallbackSpend = seriesData.spend || [];
          dataAvailability = fallbackSpend.map((spend: number | null) => spend != null && spend > 0);
      }
    }

    return (
      <div className={`flex flex-col items-center ${minimal ? "gap-1" : "gap-3"}`}>
        <SparklineBars
          series={normalizedSeries}
          size="small"
          className={minimal ? "w-12 h-4" : undefined}
          valueFormatter={(n: number) => {
            if (metric === "spend" || metric === "cpr" || metric === "cpm" || metric === "cpmql") {
              return formatCurrency(n || 0);
            }
            if (metric === "results" || metric === "mqls") {
              return Math.round(n || 0).toString();
            }
            // percent-based metrics
            return `${(n * 100).toFixed(2)}%`;
          }}
          inverseColors={isInverseMetric}
          packAverage={packAverageForMetric}
          colorMode={useTrendMode ? "series" : undefined}
          dataAvailability={dataAvailability}
          zeroValueLabel={zeroValueLabel}
          dates={dates}
        />
        <span className={`${minimal ? "text-xs" : "text-base"} font-medium leading-none`}>{value}</span>
      </div>
    );
  }

  // Modo Performance: mostrar diferença percentual em relação à média
  // Para CPMQL, acessar explicitamente para evitar problemas de tipagem
  const avgValue = metric === "cpmql" ? (averages as any).cpmql : averages[metric];
  if (avgValue === null || avgValue === undefined) {
    // Se não há média disponível, mostrar apenas o valor
    return (
      <div className="flex flex-col items-center gap-3">
        <span className="text-base font-medium leading-none">{value}</span>
      </div>
    );
  }

  // Extrair valor numérico diretamente do original (mais confiável)
  let currentValue: number | null = null;
  switch (metric) {
    case "hook":
      currentValue = (original as any).hook != null ? Number((original as any).hook) : null;
      // hook vem em decimal (0-1), média também vem em decimal
      break;
    case "cpr":
      if (actionType) {
        const results = (original as any).conversions?.[actionType] || 0;
        currentValue = results > 0 ? Number((original as any).spend || 0) / results : null;
      }
      break;
    case "spend":
      currentValue = Number((original as any).spend || 0);
      break;
    case "ctr":
      currentValue = (original as any).ctr != null ? Number((original as any).ctr) : null;
      // ctr vem em decimal (0-1), média também vem em decimal
      break;
    case "website_ctr":
      currentValue = (original as any).website_ctr != null ? Number((original as any).website_ctr) : null;
      // website_ctr vem em decimal (0-1), média também vem em decimal
      break;
    case "connect_rate":
      currentValue = (original as any).connect_rate != null ? Number((original as any).connect_rate) : null;
      // connect_rate vem em decimal (0-1), média também vem em decimal
      break;
    case "page_conv":
      // Se o ad já tem page_conv calculado (vem do manager), usar esse valor
      if ("page_conv" in original && typeof (original as any).page_conv === "number" && !Number.isNaN((original as any).page_conv) && isFinite((original as any).page_conv)) {
        currentValue = (original as any).page_conv;
      } else if (actionType) {
        // Caso contrário, calcular baseado no actionType
        const results = (original as any).conversions?.[actionType] || 0;
        const lpv = Number((original as any).lpv || 0);
        currentValue = lpv > 0 ? results / lpv : null;
      }
      break;
    case "cpm":
      currentValue = typeof (original as any).cpm === "number" ? (original as any).cpm : null;
      break;
    case "cpmql":
      // CPMQL só é calculado quando há integração de planilha
      if (hasSheetIntegration) {
        const { cpmql: computedCpmql } = computeMqlMetricsFromLeadscore({
          spend: Number((original as any).spend || 0),
          leadscoreRaw: (original as any).leadscore_values,
          mqlLeadscoreMin: mqlLeadscoreMin || 0,
        });
        // Aceitar qualquer valor finito, mesmo que seja 0 (pode ser válido)
        currentValue = Number.isFinite(computedCpmql) ? computedCpmql : null;
      } else {
        currentValue = null;
      }
      break;
    case "results":
      // Results = conversions[actionType]
      if (actionType) {
        const results = (original as any).conversions?.[actionType] || 0;
        currentValue = Number(results);
      } else {
        currentValue = null;
      }
      break;
    case "mqls":
      // MQLs = calcular a partir de leadscore_values
      if (hasSheetIntegration) {
        const { mqlCount } = computeMqlMetricsFromLeadscore({
          spend: Number((original as any).spend || 0),
          leadscoreRaw: (original as any).leadscore_values,
          mqlLeadscoreMin: mqlLeadscoreMin || 0,
        });
        currentValue = mqlCount;
      } else {
        currentValue = null;
      }
      break;
  }

  if (currentValue === null || isNaN(currentValue) || !isFinite(currentValue)) {
    // Se não conseguimos extrair o valor, mostrar apenas o valor original
    return (
      <div className="flex flex-col items-center gap-3">
        <span className="text-base font-medium leading-none">{value}</span>
      </div>
    );
  }

  // Verificar se a média é válida
  // Para page_conv, avgValue pode ser 0 (nenhuma conversão), o que é válido
  if (isNaN(avgValue) || !isFinite(avgValue)) {
    return (
      <div className="flex flex-col items-center gap-3">
        <span className="text-base font-medium leading-none">{value}</span>
      </div>
    );
  }

  // Se a média for 0 e o valor atual também for 0, não há diferença para mostrar
  if (avgValue === 0 && currentValue === 0) {
    return (
      <div className="flex flex-col items-center gap-3">
        <span className="text-xs font-medium text-muted-foreground">0%</span>
        <span className="text-base font-medium leading-none">{value}</span>
      </div>
    );
  }

  // Se a média for 0 mas o valor atual não for 0
  if (avgValue === 0 && currentValue !== 0) {
    if (isInverseMetric) {
      // Para métricas inversas: valor > 0 quando média é 0 = pior (acima da média) = vermelho com "+"
      return (
        <div className="flex flex-col items-center gap-3">
          <span className="text-xs font-medium text-red-600 dark:text-red-400">+∞</span>
          <span className="text-base font-medium leading-none">{value}</span>
        </div>
      );
    } else {
      // Para métricas normais: valor > 0 quando média é 0 = melhor (acima da média) = verde com "+"
      return (
        <div className="flex flex-col items-center gap-3">
          <span className="text-xs font-medium text-green-600 dark:text-green-400">+∞</span>
          <span className="text-base font-medium leading-none">{value}</span>
        </div>
      );
    }
  }

  // Calcular diferença percentual
  // Para métricas inversas (CPR, CPM), a lógica é invertida: menor que a média é melhor
  let diffPercent: number;
  if (isInverseMetric) {
    // Para métricas inversas: se currentValue < avgValue, isso é melhor (positivo)
    // diffPercent = ((avgValue - currentValue) / avgValue) * 100
    diffPercent = ((avgValue - currentValue) / avgValue) * 100;
  } else {
    // Para métricas normais: se currentValue > avgValue, isso é melhor (positivo)
    // diffPercent = ((currentValue - avgValue) / avgValue) * 100
    diffPercent = ((currentValue - avgValue) / avgValue) * 100;
  }

  // Determinar cor baseado na diferença
  // Para métricas normais: positivo (acima da média) = verde, negativo (abaixo) = vermelho
  // Para métricas inversas: positivo (menor que média) = verde, negativo (maior que média) = vermelho
  const isPositive = diffPercent > 0;
  const colorClass = isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";

  // Para métricas inversas, inverter o sinal exibido: quando está melhor (positivo), mostrar "-" porque está abaixo da média numericamente
  // Para métricas normais, manter o sinal original
  let sign: string;
  if (isInverseMetric) {
    // Métricas inversas: diffPercent positivo = melhor = abaixo da média numericamente = mostrar "-"
    // diffPercent negativo = pior = acima da média numericamente = mostrar "+"
    sign = isPositive ? "-" : "+";
  } else {
    // Métricas normais: diffPercent positivo = melhor = acima da média = mostrar "+"
    // diffPercent negativo = pior = abaixo da média = mostrar "-"
    sign = isPositive ? "+" : "-";
  }

  return (
    <div className={`flex flex-col items-center ${minimal ? "gap-1" : "gap-3"}`}>
      <span className={`text-xs font-medium ${colorClass}`}>
        {sign}
        {Math.abs(diffPercent).toFixed(1)}%
      </span>
      <span className={`${minimal ? "text-xs" : "text-base"} font-medium leading-none`}>{value}</span>
    </div>
  );
}, arePropsEqual);
