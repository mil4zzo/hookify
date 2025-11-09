import { OpportunityRow } from "@/lib/utils/opportunity";
import { RankingsResponse } from "@/lib/api/schemas";
import { useFormatCurrency } from "@/lib/utils/currency";
import { IconPlayerPlay } from "@tabler/icons-react";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";
import { useState, useCallback } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

type OpportunityCardsProps = {
  rows: OpportunityRow[];
  averages?: RankingsResponse["averages"];
  actionType: string;
};

function formatPct(v: number): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function formatPct2(v: number): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

// Estilização padronizada das linhas da tabela
const ROW_BASE_CLASS = "grid grid-cols-4 gap-2 py-2 px-3 rounded items-center";
const ROW_MUTED_CLASS = `${ROW_BASE_CLASS} bg-muted`;
const ROW_GREEN_CLASS = `${ROW_BASE_CLASS} bg-green-500/20`;

// Função para determinar a cor baseada na relação atual/média
function getValueColor(current: number, average: number, lowerIsBetter: boolean = false): string {
  if (average <= 0) return "text-foreground"; // Sem média válida

  if (lowerIsBetter) {
    // Para métricas onde menor é melhor (ex: CPR)
    // Se atual <= média, está abaixo/igual à média (melhor) = verde
    if (current <= average) return "text-green-600 dark:text-green-400";

    // Calcular ratio: atual/média (quanto maior que a média)
    const ratio = current / average;

    // Classificação baseada no ratio
    if (ratio > 1 && ratio <= 1.25) return "text-yellow-600 dark:text-yellow-400"; // 100%~125% = amarelo
    if (ratio > 1.25 && ratio <= 1.5) return "text-orange-600 dark:text-orange-400"; // 125%~150% = laranja
    if (ratio > 1.5) return "text-red-600 dark:text-red-400"; // 150%+ = vermelho
    return "text-foreground"; // Fallback
  } else {
    // Para métricas onde maior é melhor (ex: Hook, CTR, etc)
    const ratio = current / average;
    // Se atual >= média, está acima/igual à média (melhor) = verde
    if (current >= average) return "text-green-600 dark:text-green-400";

    // Classificação baseada no ratio
    if (ratio >= 0.75 && ratio < 1) return "text-yellow-600 dark:text-yellow-400"; // 75%~100% = amarelo
    if (ratio >= 0.5 && ratio < 0.75) return "text-orange-600 dark:text-orange-400"; // 50%~75% = laranja
    return "text-red-600 dark:text-red-400"; // 0%~50% = vermelho
  }
}

export function OpportunityCards({ rows, averages, actionType }: OpportunityCardsProps) {
  const formatCurrency = useFormatCurrency();

  // Valores médios
  const avgHook = averages?.hook || 0;
  const avgWebsiteCtr = averages?.website_ctr || 0;
  const avgConnectRate = averages?.connect_rate || 0;
  const avgPageConv = averages?.per_action_type?.[actionType]?.page_conv || 0;
  const avgCpr = averages?.per_action_type?.[actionType]?.cpr || 0;

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 custom-scrollbar">
      {rows.map((r, idx) => {
        // Componente interno para cada card com seu próprio estado
        return <OpportunityCard key={`${r.ad_id || r.ad_name || idx}`} row={r} idx={idx} formatCurrency={formatCurrency} avgHook={avgHook} avgWebsiteCtr={avgWebsiteCtr} avgConnectRate={avgConnectRate} avgPageConv={avgPageConv} avgCpr={avgCpr} />;
      })}
    </div>
  );
}

// Componente interno para cada card
function OpportunityCard({ row, idx, formatCurrency, avgHook, avgWebsiteCtr, avgConnectRate, avgPageConv, avgCpr }: { row: OpportunityRow; idx: number; formatCurrency: (value: number) => string; avgHook: number; avgWebsiteCtr: number; avgConnectRate: number; avgPageConv: number; avgCpr: number }) {
  // Estado para controlar qual métrica está sendo hover/click
  const [hoveredMetric, setHoveredMetric] = useState<"website_ctr" | "connect_rate" | "page_conv" | null>(null);

  const r = row;

  // Calcular deltas e objetivos
  const hookDelta = avgHook > 0 && r.hook < avgHook ? avgHook - r.hook : 0;
  const hookObjective = r.hook + hookDelta;

  const websiteCtrDelta = avgWebsiteCtr > 0 && r.website_ctr < avgWebsiteCtr ? avgWebsiteCtr - r.website_ctr : 0;
  const websiteCtrObjective = r.website_ctr + websiteCtrDelta;

  const connectRateDelta = avgConnectRate > 0 && r.connect_rate < avgConnectRate ? avgConnectRate - r.connect_rate : 0;
  const connectRateObjective = r.connect_rate + connectRateDelta;

  const pageConvDelta = avgPageConv > 0 && r.page_conv < avgPageConv ? avgPageConv - r.page_conv : 0;
  const pageConvObjective = r.page_conv + pageConvDelta;

  // Delta do CPR: razão entre objetivo e atual (ex: 0.7 = objetivo é 70% do atual = redução de 30%)
  const cprRatio = r.cpr_actual > 0 && r.cpr_potential > 0 ? r.cpr_potential / r.cpr_actual : 1;
  // Redução percentual como decimal (ex: 0.3 = 30%), formatPct vai multiplicar por 100
  const cprDelta = 1 - cprRatio;
  const cprObjective = r.cpr_potential;

  // Número de variações
  const variationCount = r.ad_count || 1;

  // Obter thumbnail para o player de vídeo (prioridade: adcreatives_videos_thumbs[0], fallback: thumbnail)
  const videoThumbnail = Array.isArray(r.adcreatives_videos_thumbs) && r.adcreatives_videos_thumbs.length > 0 && r.adcreatives_videos_thumbs[0] ? r.adcreatives_videos_thumbs[0] : r.thumbnail ? getAdThumbnail({ thumbnail: r.thumbnail } as any) : null;

  // Calcular CPR individual e melhoria para cada métrica
  const getCprForMetric = useCallback(
    (metric: "website_ctr" | "connect_rate" | "page_conv"): { cpr: number; improvement: number } => {
      let cpr = 0;
      if (metric === "website_ctr") {
        cpr = r.cpr_if_website_ctr_only;
      } else if (metric === "connect_rate") {
        cpr = r.cpr_if_connect_rate_only;
      } else if (metric === "page_conv") {
        cpr = r.cpr_if_page_conv_only;
      }
      const improvement = r.cpr_actual > 0 && cpr > 0 ? 1 - cpr / r.cpr_actual : 0;
      return { cpr, improvement };
    },
    [r]
  );

  // Handlers para hover/click
  const handleMetricEnter = useCallback((metric: "website_ctr" | "connect_rate" | "page_conv") => {
    setHoveredMetric(metric);
  }, []);

  const handleMetricLeave = useCallback(() => {
    setHoveredMetric(null);
  }, []);

  const handleMetricClick = useCallback((metric: "website_ctr" | "connect_rate" | "page_conv") => {
    setHoveredMetric((prev) => (prev === metric ? null : metric));
  }, []);

  return (
    <div
      className="bg-card border border-border rounded-lg overflow-hidden flex flex-col flex-shrink-0"
      style={{
        aspectRatio: "9/16",
        width: "280px",
      }}
    >
      {/* Conteúdo */}
      <div className="flex flex-col h-full">
        {/* Header com nome e variações */}
        <div className="p-4 flex-shrink-0">
          <div className="flex flex-col gap-1">
            <h3 className="text-lg font-bold leading-tight text-foreground truncate">{r.ad_name || r.ad_id || "—"}</h3>
            <span className="text-xs text-muted-foreground">
              {formatCurrency(r.spend)} ({variationCount} ads)
            </span>
          </div>
        </div>

        {/* Área central de mídia com botão de play */}
        <div className="flex-1 flex items-center justify-center px-4 relative">
          <div className="w-full h-full rounded-lg bg-muted flex items-center justify-center relative overflow-hidden">
            {/* Thumbnail do vídeo como background */}
            {videoThumbnail && (
              <div
                className="absolute inset-0 z-0"
                style={{
                  backgroundImage: `url(${videoThumbnail})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                }}
              />
            )}
            {/* Overlay escuro para melhorar contraste do botão */}
            <div className="absolute inset-0 z-[1] bg-black/40" />
            {/* Botão de play */}
            <button className="relative z-10 w-16 h-16 rounded-full bg-primary hover:bg-primary-90 transition-colors flex items-center justify-center shadow-lg">
              <IconPlayerPlay className="w-8 h-8 text-primary-foreground ml-1" fill="currentColor" />
            </button>
          </div>
        </div>

        {/* Tabela de métricas na parte inferior */}
        <div className="p-4 flex-shrink-0 space-y-2">
          {/* Headers */}
          <div className="grid grid-cols-4 gap-2 text-muted-foreground text-[10px] font-medium mb-1 px-3">
            <div className="col-span-1 flex items-center">MÉTRICA</div>
            <div className="flex items-center justify-end">ATUAL</div>
            <div className="flex items-center justify-end">Δ</div>
            <div className="flex items-center justify-end">OBS</div>
          </div>

          {/* Hook */}
          <div className={ROW_MUTED_CLASS}>
            <div className="col-span-1 text-foreground font-semibold text-xs flex items-center">HOOK</div>
            <div className={`${getValueColor(r.hook, avgHook)} text-xs flex items-center justify-end`}>{formatPct(r.hook)}</div>
            <div className="flex items-center justify-end">{hookDelta > 0 ? <span className="inline-block px-2 py-0.5 rounded bg-green-500/20 text-green-600 dark:text-green-300 text-[10px] font-medium">{formatPct(hookDelta)}</span> : <span className="text-muted-foreground text-xs">—</span>}</div>
            <div className="text-foreground text-xs flex items-center justify-end">{formatPct(hookObjective)}</div>
          </div>

          {/* CTR Link - Interativo */}
          <MetricRow label="CTR" current={r.website_ctr} average={avgWebsiteCtr} delta={websiteCtrDelta} objective={websiteCtrObjective} formatValue={formatPct2} isHovered={hoveredMetric === "website_ctr"} onEnter={() => handleMetricEnter("website_ctr")} onLeave={handleMetricLeave} onClick={() => handleMetricClick("website_ctr")} cprData={hoveredMetric === "website_ctr" ? getCprForMetric("website_ctr") : null} formatCurrency={formatCurrency} cprActual={r.cpr_actual} />

          {/* Connect Rate - Interativo */}
          <MetricRow label="CONNECT" current={r.connect_rate} average={avgConnectRate} delta={connectRateDelta} objective={connectRateObjective} formatValue={formatPct} isHovered={hoveredMetric === "connect_rate"} onEnter={() => handleMetricEnter("connect_rate")} onLeave={handleMetricLeave} onClick={() => handleMetricClick("connect_rate")} cprData={hoveredMetric === "connect_rate" ? getCprForMetric("connect_rate") : null} formatCurrency={formatCurrency} cprActual={r.cpr_actual} />

          {/* Page - Interativo */}
          <MetricRow label="PAGE" current={r.page_conv} average={avgPageConv} delta={pageConvDelta} objective={pageConvObjective} formatValue={formatPct} isHovered={hoveredMetric === "page_conv"} onEnter={() => handleMetricEnter("page_conv")} onLeave={handleMetricLeave} onClick={() => handleMetricClick("page_conv")} cprData={hoveredMetric === "page_conv" ? getCprForMetric("page_conv") : null} formatCurrency={formatCurrency} cprActual={r.cpr_actual} />

          {/* CPR */}
          <div className={ROW_MUTED_CLASS}>
            <div className="col-span-1 text-foreground font-semibold text-xs flex items-center">CPR</div>
            <div className={`${getValueColor(r.cpr_actual, avgCpr, true)} text-xs flex items-center justify-end`}>{formatCurrency(r.cpr_actual)}</div>
            <div className="flex items-center justify-end">{cprDelta > 0 ? <span className="inline-block px-2 py-0.5 rounded bg-green-500/20 text-green-600 dark:text-green-300 text-[10px] font-medium">{formatPct(cprDelta)}</span> : <span className="text-muted-foreground text-xs">—</span>}</div>
            <div className="text-foreground text-xs flex items-center justify-end">{formatCurrency(cprObjective)}</div>
          </div>

          {/* Impacto */}
          <div className={ROW_GREEN_CLASS}>
            <div className="col-span-1 text-foreground font-semibold text-xs flex items-center">IMPACTO</div>
            <div className="col-span-3 text-foreground text-sm font-semibold flex items-center justify-end">{formatPct(r.impact_relative)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Componente para linha de métrica interativa
function MetricRow({ label, current, average, delta, objective, formatValue, isHovered, onEnter, onLeave, onClick, cprData, formatCurrency, cprActual }: { label: string; current: number; average: number; delta: number; objective: number; formatValue: (v: number) => string; isHovered: boolean; onEnter: () => void; onLeave: () => void; onClick: () => void; cprData: { cpr: number; improvement: number } | null; formatCurrency: (v: number) => string; cprActual: number }) {
  // Mapear label para nome da métrica em português
  const metricNameMap: Record<string, string> = {
    CTR: "CTR",
    CONNECT: "Connect Rate",
    PAGE: "Conversão de Página",
  };
  // Nome curto para quando está acima da média (especialmente para PAGE)
  const metricNameShortMap: Record<string, string> = {
    CTR: "CTR",
    CONNECT: "Connect Rate",
    PAGE: "Conv. Página",
  };
  const metricName = metricNameMap[label] || label;
  const metricNameShort = metricNameShortMap[label] || metricName;

  // Verificar se a métrica já está acima da média
  const isAboveAverage = current >= average && average > 0;

  // Mensagem do tooltip (não mostrar se já está acima da média)
  // Usar o delta absoluto formatado (mesmo que aparece na linha)
  const tooltipMessage = isAboveAverage ? null : cprData && cprData.cpr > 0 && delta > 0 ? `Se você melhorar ${metricName} em ${formatValue(delta)}, seu CPR pode chegar à ${formatCurrency(cprData.cpr)}.` : null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`${ROW_MUTED_CLASS} transition-all duration-300 cursor-pointer ${isHovered ? "ring-2 ring-primary !bg-background" : ""}`} onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={onClick}>
            {!isHovered || !cprData ? (
              // Conteúdo normal da métrica
              <>
                <div className="col-span-1 text-foreground font-semibold text-xs flex items-center">{label}</div>
                <div className={`${getValueColor(current, average)} text-xs flex items-center justify-end`}>{formatValue(current)}</div>
                <div className="flex items-center justify-end">{delta > 0 ? <span className="inline-block px-2 py-0.5 rounded bg-green-500/20 text-green-600 dark:text-green-300 text-[10px] font-medium">{formatValue(delta)}</span> : <span className="text-muted-foreground text-xs">—</span>}</div>
                <div className="text-foreground text-xs flex items-center justify-end">{formatValue(objective)}</div>
              </>
            ) : isAboveAverage ? (
              // Mensagem quando já está acima da média
              <>
                <div className="col-span-4 text-green-600 dark:text-green-400 text-xs flex items-center justify-center">{metricNameShort} está acima da média</div>
              </>
            ) : (
              // Linha de CPR quando hover/click
              <>
                <div className="col-span-1 text-foreground font-semibold text-xs flex items-center">CPR</div>
                <div className="text-white text-xs flex items-center justify-end">{formatCurrency(cprActual)}</div>
                <div className="flex items-center justify-end">{cprData.improvement > 0 ? <span className="inline-block px-2 py-0.5 rounded bg-green-500/20 text-green-600 dark:text-green-300 text-[10px] font-medium">{formatPct(cprData.improvement)}</span> : <span className="text-muted-foreground text-xs">—</span>}</div>
                <div className="text-green-600 dark:text-green-400 text-xs flex items-center justify-end">{formatCurrency(cprData.cpr)}</div>
              </>
            )}
          </div>
        </TooltipTrigger>
        {tooltipMessage && (
          <TooltipContent>
            <p className="text-xs">{tooltipMessage}</p>
          </TooltipContent>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}
