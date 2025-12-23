import { OpportunityRow } from "@/lib/utils/opportunity";
import { RankingsResponse } from "@/lib/api/schemas";
import { useFormatCurrency } from "@/lib/utils/currency";
import { IconChevronLeft, IconChevronRight, IconBulbFilled, IconMoodEmptyFilled } from "@tabler/icons-react";
import { AdStatusIcon } from "@/components/common/AdStatusIcon";
import type { CSSProperties } from "react";
import { getTopBadgeVariantFromRank, getTopBadgeRowStyles, getTopBadgeEmoji } from "@/lib/utils/topBadgeStyles";
import { MetricRanks } from "@/lib/utils/metricRankings";
import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { InsightsModal } from "./InsightsModal";
import { GemsTopItem } from "@/lib/utils/gemsTopMetrics";
import { AdPlayArea } from "@/components/common/AdPlayArea";
import { StandardCard } from "@/components/common/StandardCard";

type OpportunityWidgetProps = {
  rows: OpportunityRow[];
  averages?: RankingsResponse["averages"];
  actionType: string;
  onAdClick?: (row: OpportunityRow, openVideo?: boolean) => void;
  /** Rankings globais de métricas (calculados a partir de todos os anúncios) */
  globalMetricRanks?: MetricRanks;
  /** Top 5 hooks da seção Gems (para InsightsModal) */
  gemsTopHook?: GemsTopItem[];
  /** Top 5 Website CTR da seção Gems (para InsightsModal) */
  gemsTopWebsiteCtr?: GemsTopItem[];
  /** Top 5 CTR da seção Gems (para InsightsModal) */
  gemsTopCtr?: GemsTopItem[];
  /** Top 5 Page Conv da seção Gems (para InsightsModal) */
  gemsTopPageConv?: GemsTopItem[];
  /** Top 5 Hold Rate da seção Gems (para InsightsModal) */
  gemsTopHoldRate?: GemsTopItem[];
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
const ROW_BASE_CLASS = "grid grid-cols-7 gap-2 py-2 px-3 rounded items-center border border-border";
const ROW_MUTED_CLASS = `${ROW_BASE_CLASS} bg-border`;
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

// Função para determinar se a métrica está acima da média
function isAboveAverage(current: number, average: number, lowerIsBetter: boolean = false): boolean {
  if (average <= 0) return false; // Sem média válida
  if (lowerIsBetter) {
    // Para métricas onde menor é melhor, "acima da média" significa pior (current > average)
    return current > average;
  } else {
    // Para métricas onde maior é melhor, "acima da média" significa melhor (current >= average)
    return current >= average;
  }
}

// Função para obter a cor do círculo baseado no status da métrica
function getMetricStatusColor(current: number, average: number, lowerIsBetter: boolean = false): string | null {
  if (average <= 0) return null; // Sem média válida

  if (lowerIsBetter) {
    // Para métricas onde menor é melhor (ex: CPR)
    if (current <= average) {
      return "bg-green-600 dark:bg-green-400";
    }

    const ratio = current / average;
    if (ratio > 1 && ratio <= 1.25) {
      return "bg-yellow-600 dark:bg-yellow-400";
    }
    if (ratio > 1.25 && ratio <= 1.5) {
      return "bg-orange-600 dark:bg-orange-400";
    }
    if (ratio > 1.5) {
      return "bg-red-600 dark:bg-red-400";
    }
  } else {
    // Para métricas onde maior é melhor (ex: Hook, CTR, etc)
    if (current >= average) {
      return "bg-green-600 dark:bg-green-400";
    }

    const ratio = current / average;
    if (ratio >= 0.75 && ratio < 1) {
      return "bg-yellow-600 dark:bg-yellow-400";
    }
    if (ratio >= 0.5 && ratio < 0.75) {
      return "bg-orange-600 dark:bg-orange-400";
    }
    if (ratio < 0.5) {
      return "bg-red-600 dark:bg-red-400";
    }
  }
  return null;
}

// Função para determinar o status da métrica e retornar um círculo colorido
function getMetricStatusIcon(current: number, average: number, lowerIsBetter: boolean = false) {
  const colorClass = getMetricStatusColor(current, average, lowerIsBetter);
  if (!colorClass) return null;

  return <div className={`h-3 w-3 rounded-full ${colorClass}`} />;
}

export function OpportunityWidget({ rows, averages, actionType, onAdClick, globalMetricRanks, gemsTopHook, gemsTopWebsiteCtr, gemsTopCtr, gemsTopPageConv, gemsTopHoldRate }: OpportunityWidgetProps) {
  const formatCurrency = useFormatCurrency();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [selectedCardForInsights, setSelectedCardForInsights] = useState<OpportunityRow | null>(null);

  // Valores médios
  const avgHook = averages?.hook || 0;
  const avgHoldRate = averages?.hold_rate || 0;
  const avgWebsiteCtr = averages?.website_ctr || 0;
  const avgConnectRate = averages?.connect_rate || 0;
  const avgPageConv = averages?.per_action_type?.[actionType]?.page_conv || 0;
  const avgCpr = averages?.per_action_type?.[actionType]?.cpr || 0;

  // Usar rankings globais se fornecidos, senão criar rankings vazios (sem medalhas)
  const metricRanks: MetricRanks = globalMetricRanks || {
    hookRank: new Map(),
    holdRateRank: new Map(),
    websiteCtrRank: new Map(),
    connectRateRank: new Map(),
    pageConvRank: new Map(),
    ctrRank: new Map(),
    cprRank: new Map(),
    spendRank: new Map(),
  };

  // Função para verificar se pode rolar
  const checkScrollability = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1);
  }, []);

  // Verificar scrollabilidade ao montar e quando o tamanho mudar
  useEffect(() => {
    // Aguardar um frame para garantir que o DOM foi renderizado
    const timeoutId = setTimeout(() => {
      checkScrollability();
    }, 0);

    const container = scrollContainerRef.current;
    if (!container) {
      clearTimeout(timeoutId);
      return;
    }

    const handleScroll = () => checkScrollability();
    const resizeObserver = new ResizeObserver(() => {
      // Aguardar um frame após resize para garantir que o layout foi atualizado
      setTimeout(() => checkScrollability(), 0);
    });

    container.addEventListener("scroll", handleScroll);
    resizeObserver.observe(container);

    return () => {
      clearTimeout(timeoutId);
      container.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
    };
  }, [rows.length, checkScrollability]);

  // Função para rolar para a esquerda
  const scrollLeft = () => {
    if (!scrollContainerRef.current) return;
    const cardWidth = 280 + 16; // width do card + gap
    scrollContainerRef.current.scrollBy({
      left: -cardWidth * 2, // Rola 2 cards por vez
      behavior: "smooth",
    });
    // Atualizar estado após um pequeno delay para permitir que o scroll aconteça
    setTimeout(() => checkScrollability(), 100);
  };

  // Função para rolar para a direita
  const scrollRight = () => {
    if (!scrollContainerRef.current) return;
    const cardWidth = 280 + 16; // width do card + gap
    scrollContainerRef.current.scrollBy({
      left: cardWidth * 2, // Rola 2 cards por vez
      behavior: "smooth",
    });
    // Atualizar estado após um pequeno delay para permitir que o scroll aconteça
    setTimeout(() => checkScrollability(), 100);
  };

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 rounded-lg border border-dashed border-border bg-muted-30">
        <div className="flex flex-col items-center gap-3 text-center max-w-md">
          <div className="p-4 rounded-full bg-muted-50">
            <IconMoodEmptyFilled className="h-8 w-8 text-muted-foreground" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-semibold text-foreground">Nenhuma oportunidade encontrada</h3>
            <p className="text-sm text-muted-foreground">Não há anúncios com potencial de melhoria no período selecionado. Tente ajustar os filtros ou selecionar outro período.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Gradiente lateral esquerdo */}
      {canScrollLeft && <div className="absolute left-0 top-0 bottom-0 w-20 z-[5] pointer-events-none bg-gradient-to-r from-background via-background/80 to-transparent" />}

      {/* Botão anterior */}
      {canScrollLeft && (
        <Button variant="outline" size="icon" className="absolute left-0 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full shadow-lg bg-background/80 backdrop-blur-sm hover:bg-background" onClick={scrollLeft} aria-label="Anterior">
          <IconChevronLeft className="h-5 w-5" />
        </Button>
      )}

      {/* Container de scroll */}
      <div ref={scrollContainerRef} className="flex gap-4 overflow-x-auto scroll-smooth [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
        {rows.map((r, idx) => {
          // Componente interno para cada card com seu próprio estado
          return <OpportunityCard key={`${r.ad_id || r.ad_name || idx}`} row={r} idx={idx} formatCurrency={formatCurrency} avgHook={avgHook} avgHoldRate={avgHoldRate} avgWebsiteCtr={avgWebsiteCtr} avgConnectRate={avgConnectRate} avgPageConv={avgPageConv} avgCpr={avgCpr} metricRanks={metricRanks} onAdClick={onAdClick} onInsightsClick={() => setSelectedCardForInsights(r)} />;
        })}
      </div>

      {/* Gradiente lateral direito */}
      {canScrollRight && <div className="absolute right-0 top-0 bottom-0 w-20 z-[5] pointer-events-none bg-gradient-to-l from-background via-background/80 to-transparent" />}

      {/* Botão próximo */}
      {canScrollRight && (
        <Button variant="outline" size="icon" className="absolute right-0 top-1/2 -translate-y-1/2 z-10 h-10 w-10 rounded-full shadow-lg bg-background/80 backdrop-blur-sm hover:bg-background" onClick={scrollRight} aria-label="Próximo">
          <IconChevronRight className="h-5 w-5" />
        </Button>
      )}

      {/* Modal de Insights */}
      {selectedCardForInsights && (
        <InsightsModal
          row={selectedCardForInsights}
          isOpen={!!selectedCardForInsights}
          onClose={() => setSelectedCardForInsights(null)}
          formatCurrency={formatCurrency}
          avgCpr={avgCpr}
          actionType={actionType}
          gemsTopHook={gemsTopHook}
          gemsTopWebsiteCtr={gemsTopWebsiteCtr}
          gemsTopCtr={gemsTopCtr}
          gemsTopPageConv={gemsTopPageConv}
          gemsTopHoldRate={gemsTopHoldRate}
          averages={averages}
          cardComponent={<OpportunityCard row={selectedCardForInsights} idx={rows.findIndex((r) => r.ad_id === selectedCardForInsights.ad_id || r.ad_name === selectedCardForInsights.ad_name)} formatCurrency={formatCurrency} avgHook={avgHook} avgHoldRate={avgHoldRate} avgWebsiteCtr={avgWebsiteCtr} avgConnectRate={avgConnectRate} avgPageConv={avgPageConv} avgCpr={avgCpr} metricRanks={metricRanks} onAdClick={onAdClick} onInsightsClick={() => setSelectedCardForInsights(null)} isInOverlay={true} />}
        />
      )}
    </div>
  );
}

// Função helper para formatar valor com símbolo da moeda pequeno
function formatCurrencyWithSmallSymbol(formatted: string) {
  // Tenta separar símbolo do valor (ex: "R$ 10,50" ou "$10.50")
  const match = formatted.match(/^([^\d\s.,]+)\s*(.+)$/);
  if (match) {
    return (
      <>
        <span className="text-[0.6em] align-top mt-[1px]">{match[1]}</span>
        <span>{match[2]}</span>
      </>
    );
  }
  return formatted;
}

// Componente interno para cada card
function OpportunityCard({ row, idx, formatCurrency, avgHook, avgHoldRate, avgWebsiteCtr, avgConnectRate, avgPageConv, avgCpr, metricRanks, onAdClick, onInsightsClick, isInOverlay = false }: { row: OpportunityRow; idx: number; formatCurrency: (value: number) => string; avgHook: number; avgHoldRate: number; avgWebsiteCtr: number; avgConnectRate: number; avgPageConv: number; avgCpr: number; metricRanks: MetricRanks; onAdClick?: (row: OpportunityRow, openVideo?: boolean) => void; onInsightsClick?: () => void; isInOverlay?: boolean }) {
  const r = row;

  // Obter rankings para este anúncio
  const hookRank = r.ad_id ? metricRanks.hookRank.get(r.ad_id) ?? null : null;
  const holdRateRank = r.ad_id ? metricRanks.holdRateRank.get(r.ad_id) ?? null : null;
  const websiteCtrRank = r.ad_id ? metricRanks.websiteCtrRank.get(r.ad_id) ?? null : null;
  const connectRateRank = r.ad_id ? metricRanks.connectRateRank.get(r.ad_id) ?? null : null;
  const pageConvRank = r.ad_id ? metricRanks.pageConvRank.get(r.ad_id) ?? null : null;

  // Obter variantes e emojis de medalha para cada métrica
  const hookVariant = getTopBadgeVariantFromRank(hookRank);
  const holdRateVariant = getTopBadgeVariantFromRank(holdRateRank);
  const websiteCtrVariant = getTopBadgeVariantFromRank(websiteCtrRank);
  const connectRateVariant = getTopBadgeVariantFromRank(connectRateRank);
  const pageConvVariant = getTopBadgeVariantFromRank(pageConvRank);

  const hookEmoji = getTopBadgeEmoji(hookVariant);
  const holdRateEmoji = getTopBadgeEmoji(holdRateVariant);
  const websiteCtrEmoji = getTopBadgeEmoji(websiteCtrVariant);
  const connectRateEmoji = getTopBadgeEmoji(connectRateVariant);
  const pageConvEmoji = getTopBadgeEmoji(pageConvVariant);

  // Obter estilos de badge para cada métrica premiada (apenas background e color, mantém estrutura)
  const hookBadgeStyles = getTopBadgeRowStyles(hookVariant);
  const holdRateBadgeStyles = getTopBadgeRowStyles(holdRateVariant);
  const websiteCtrBadgeStyles = getTopBadgeRowStyles(websiteCtrVariant);
  const connectRateBadgeStyles = getTopBadgeRowStyles(connectRateVariant);
  const pageConvBadgeStyles = getTopBadgeRowStyles(pageConvVariant);

  // CPR objetivo (potencial)
  const cprObjective = r.cpr_potential;

  // Número de variações
  const variationCount = r.ad_count || 1;

  const handleCardClick = () => {
    if (onAdClick) {
      onAdClick(row);
    }
  };

  return (
    <StandardCard
      variant="default"
      padding="none"
      interactive={!isInOverlay}
      onClick={isInOverlay ? undefined : handleCardClick}
      className="overflow-hidden flex flex-col flex-shrink-0"
      style={{
        width: "280px",
      }}
    >
      {/* Conteúdo */}
      <div className="flex flex-col gap-3 p-4">
        {/* Header com thumbnail, nome e variações */}
        <div className="flex-shrink-0">
          <div className="flex items-start gap-3">
            {/* Thumbnail quadrada com botão de play */}
            <AdPlayArea
              ad={r}
              aspectRatio="1:1"
              size={56}
              className="rounded"
              onPlayClick={(e) => {
                e.stopPropagation();
                if (onAdClick) {
                  onAdClick(row, true);
                }
              }}
            />
            {/* Título e gasto */}
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              <h3 className="text-lg font-bold leading-tight text-foreground truncate">{r.ad_name || r.ad_id || "—"}</h3>
              <div className="flex items-center gap-2">
                <AdStatusIcon status={(r as any).effective_status} />
                <span className="text-xs text-muted-foreground">
                  {formatCurrency(r.spend)} ({variationCount} ads)
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* CPR destacado: Atual → Meta */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground font-medium uppercase">CPR Atual</span>
            <span className={`${getValueColor(r.cpr_actual, avgCpr, true)} text-lg font-bold leading-none flex items-stretch gap-1`}>{formatCurrencyWithSmallSymbol(formatCurrency(r.cpr_actual))}</span>
          </div>
          <div className="text-foreground text-xl font-bold">→</div>
          <div className="flex flex-col items-end gap-1">
            <span className="text-[10px] text-muted-foreground font-medium uppercase">CPR Meta</span>
            <span className={`${getValueColor(cprObjective, avgCpr, true)} text-lg font-bold leading-none flex items-stretch gap-1`}>{formatCurrencyWithSmallSymbol(formatCurrency(cprObjective))}</span>
          </div>
        </div>

        <div className="border-t border-border" />

        {/* Tabela de métricas na parte inferior */}
        <div className="flex-shrink-0 space-y-2">
          {/* Headers */}
          <div className="grid grid-cols-7 gap-2 text-muted-foreground text-[10px] font-medium mb-1 px-3">
            <div className="col-span-3 flex items-center">MÉTRICA</div>
            <div className="col-span-2 flex items-center justify-end">ATUAL</div>
            <div className="col-span-2 flex items-center justify-end">MÉDIA</div>
          </div>

          {/* Hook */}
          <div
            className={ROW_MUTED_CLASS}
            style={{
              ...(hookBadgeStyles || {}),
              opacity: isAboveAverage(r.hook, avgHook) ? 0.25 : 1,
            }}
          >
            <div className={`col-span-3 ${hookBadgeStyles ? "" : "text-foreground"} font-semibold text-xs flex items-center gap-2 min-w-0`} style={hookBadgeStyles ? { color: hookBadgeStyles.color } : undefined}>
              <div className="flex-shrink-0 w-3 h-3 flex items-center justify-center">{hookEmoji ? <span className="text-base leading-none">{hookEmoji}</span> : getMetricStatusIcon(r.hook, avgHook)}</div>
              <span className="truncate">HOOK</span>
            </div>
            <div className={`col-span-2 ${hookBadgeStyles ? "" : getValueColor(r.hook, avgHook)} text-xs flex items-center justify-end`} style={hookBadgeStyles ? { color: hookBadgeStyles.color } : undefined}>
              {formatPct(r.hook)}
            </div>
            <div className={`col-span-2 ${hookBadgeStyles ? "" : "text-foreground"} text-xs flex items-center justify-end`} style={hookBadgeStyles ? { color: hookBadgeStyles.color } : undefined}>
              {formatPct(avgHook)}
            </div>
          </div>

          {/* Hold Rate */}
          <div
            className={ROW_MUTED_CLASS}
            style={{
              ...(holdRateBadgeStyles || {}),
              opacity: isAboveAverage(r.hold_rate, avgHoldRate) ? 0.25 : 1,
            }}
          >
            <div className={`col-span-3 ${holdRateBadgeStyles ? "" : "text-foreground"} font-semibold text-xs flex items-center gap-2 min-w-0`} style={holdRateBadgeStyles ? { color: holdRateBadgeStyles.color } : undefined}>
              <div className="flex-shrink-0 w-3 h-3 flex items-center justify-center">{holdRateEmoji ? <span className="text-base leading-none">{holdRateEmoji}</span> : getMetricStatusIcon(r.hold_rate, avgHoldRate)}</div>
              <span className="truncate">HOLD</span>
            </div>
            <div className={`col-span-2 ${holdRateBadgeStyles ? "" : getValueColor(r.hold_rate, avgHoldRate)} text-xs flex items-center justify-end`} style={holdRateBadgeStyles ? { color: holdRateBadgeStyles.color } : undefined}>
              {formatPct(r.hold_rate)}
            </div>
            <div className={`col-span-2 ${holdRateBadgeStyles ? "" : "text-foreground"} text-xs flex items-center justify-end`} style={holdRateBadgeStyles ? { color: holdRateBadgeStyles.color } : undefined}>
              {formatPct(avgHoldRate)}
            </div>
          </div>

          {/* CTR Link */}
          <MetricRow label="LINK CTR" current={r.website_ctr} average={avgWebsiteCtr} formatValue={formatPct2} medalEmoji={websiteCtrEmoji} badgeStyles={websiteCtrBadgeStyles} />

          {/* Connect Rate */}
          <MetricRow label="CONNECT" current={r.connect_rate} average={avgConnectRate} formatValue={formatPct} medalEmoji={connectRateEmoji} badgeStyles={connectRateBadgeStyles} />

          {/* Page */}
          <MetricRow label="PAGE" current={r.page_conv} average={avgPageConv} formatValue={formatPct} medalEmoji={pageConvEmoji} badgeStyles={pageConvBadgeStyles} />

          {/* Impacto */}
          <div className={`${ROW_GREEN_CLASS} hidden`}>
            <div className="col-span-3 text-foreground font-semibold text-xs flex items-center">IMPACTO</div>
            <div className="col-span-4 text-foreground text-sm font-semibold flex items-center justify-end">{formatPct(r.impact_relative)}</div>
          </div>

          {/* Botão INSIGHTS */}
          {!isInOverlay && (
            <Button
              variant="ghost"
              className="w-full flex items-center justify-center gap-2 mt-2 statuhover:text-primary-foreground hover:border-primary"
              onClick={(e) => {
                e.stopPropagation();
                if (onInsightsClick) {
                  onInsightsClick();
                }
              }}
              aria-label="Insights"
            >
              <IconBulbFilled className="h-4 w-4" />
              <span className="text-sm font-medium">Como melhorar?</span>
            </Button>
          )}
        </div>
      </div>
    </StandardCard>
  );
}

// Componente para linha de métrica
function MetricRow({ label, current, average, formatValue, medalEmoji, badgeStyles }: { label: string; current: number; average: number; formatValue: (v: number) => string; medalEmoji?: string; badgeStyles?: CSSProperties | null }) {
  return (
    <div
      className={ROW_MUTED_CLASS}
      style={{
        ...(badgeStyles || {}),
        opacity: isAboveAverage(current, average) ? 0.25 : 1,
      }}
    >
      <div className={`col-span-3 ${badgeStyles ? "" : "text-foreground"} font-semibold text-xs flex items-center gap-2 min-w-0`} style={badgeStyles ? { color: badgeStyles.color } : undefined}>
        <div className="flex-shrink-0 w-3 h-3 flex items-center justify-center">{medalEmoji ? <span className="text-base leading-none">{medalEmoji}</span> : getMetricStatusIcon(current, average, false)}</div>
        <span className="truncate">{label}</span>
      </div>
      <div className={`col-span-2 ${badgeStyles ? "" : getValueColor(current, average)} text-xs flex items-center justify-end`} style={badgeStyles ? { color: badgeStyles.color } : undefined}>
        {formatValue(current)}
      </div>
      <div className={`col-span-2 ${badgeStyles ? "" : "text-foreground"} text-xs flex items-center justify-end`} style={badgeStyles ? { color: badgeStyles.color } : undefined}>
        {formatValue(average)}
      </div>
    </div>
  );
}
