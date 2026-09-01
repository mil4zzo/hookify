"use client";

import React from "react";
import type { ColumnDef, Column } from "@tanstack/react-table";
import { IconAlertTriangle, IconArrowNarrowDown, IconArrowNarrowUp, IconSquareCheck } from "@tabler/icons-react";
import { IconFilter } from "@tabler/icons-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MetricCell } from "@/components/manager/MetricCell";
import type { RankingsItem } from "@/lib/api/schemas";
import type { CreateManagerTableColumnsParams } from "@/components/manager/managerTableColumns";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import { formatMetricValue, getManagerMetricLabel, getMetricNumericValue, getMetricNumericValueOrNull, type ManagerMetricKey } from "@/lib/metrics";
import { isManagerMetricColumnVisible } from "@/components/manager/managerColumnPreferences";

export const SortIcon = ({
  column,
  invertDirection = false,
}: {
  column: Column<RankingsItem, unknown>;
  /** Quando true: asc mostra seta baixo, desc mostra seta cima (primeiro clique = seta baixo) */
  invertDirection?: boolean;
}) => {
  const sorted = column.getIsSorted();
  if (sorted === "asc") return invertDirection ? <IconArrowNarrowDown className="w-4 h-4" /> : <IconArrowNarrowUp className="w-4 h-4" />;
  if (sorted === "desc") return invertDirection ? <IconArrowNarrowUp className="w-4 h-4" /> : <IconArrowNarrowDown className="w-4 h-4" />;
  return null;
};


/** Funil do header: alguma condição da regra cita este campo. */
const ActiveFilterIcon = ({ onReveal, field }: { onReveal: (fieldId: string) => void; field: string }) => (
  <button
    type="button"
    className="shrink-0 rounded text-primary hover:bg-primary-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    title="Ver onde esta coluna está sendo filtrada"
    aria-label="Ver o filtro desta coluna"
    onClick={(e) => {
      // O header ordena no clique: sem parar a propagação, revelar reordenaria junto.
      e.stopPropagation();
      onReveal(field);
    }}
  >
    <IconFilter className="h-3.5 w-3.5 fill-current" />
  </button>
);

export function buildMetricColumns(params: CreateManagerTableColumnsParams): ColumnDef<RankingsItem, unknown>[] {
  const { columnHelper, activeColumns, byKey, endDate, cellMode, averagesRef, formatAverageRef, filteredAveragesRef, formatFilteredAverageRef, selectionAveragesRef, formatSelectionAverageRef, formatCurrencyRef, formatPct, globalFilterRef, filteredFieldIdsRef, onRevealField, viewMode, colorMetricValue, hasSheetIntegration, mqlLeadscoreMin, actionTypeRef, getRowKey, openSettings } = params;

  const shouldShow = (id: ManagerColumnType) => isManagerMetricColumnVisible(id, { activeColumns, hasSheetIntegration });

  const isMinimal = viewMode === "minimal";

  const sumMetrics = new Set(["spend", "impressions", "clicks", "reach", "lpv", "plays", "thruplays", "results", "mqls"]);

  /**
   * Terceira linha do header: o RECORTE ativo, abaixo da régua (média do pack).
   *
   * UMA linha de recorte, nunca duas — um header de 4 linhas fica ilegível no modo
   * minimal, e as duas leituras respondem à mesma pergunta ("e nesse subconjunto?").
   * A seleção ganha do filtro porque é o recorte mais deliberado: o usuário apontou
   * linha a linha, agora, com o mouse.
   *
   * Vive fora de `renderMetricHeader` porque o CPMQL tem header próprio (o alerta de
   * leadscore) e precisa da MESMA leitura — duplicar aqui foi como as duas versões
   * divergiram antes.
   */
  const renderSubsetAverage = (metricId: string) => {
    const isSum = sumMetrics.has(metricId);
    const hasActiveFilters = (globalFilterRef.current && globalFilterRef.current.trim() !== "") || (filteredFieldIdsRef.current && filteredFieldIdsRef.current.size > 0);
    const selectionCount = selectionAveragesRef.current?.count ?? 0;
    const kind: "selection" | "filter" | null = selectionCount > 0 ? "selection" : hasActiveFilters && !!filteredAveragesRef.current ? "filter" : null;
    if (!kind) return null;

    // Métrica sem leitura no recorte (CPR sem conversão, por ex.) deixa o slot VAZIO em vez
    // de cair para o outro recorte: a linha inteira do header fala do mesmo subconjunto.
    const value = kind === "selection" ? formatSelectionAverageRef.current(metricId) : formatFilteredAverageRef.current(metricId);
    if (!value) return null;

    const tooltip = kind === "selection" ? `${isSum ? "Soma" : "Média"} dos ${selectionCount} selecionados` : isSum ? "Soma total dos filtrados" : "Média dos anúncios filtrados";
    const textSize = isMinimal ? "text-2xs" : "text-xs";
    const avgLeading = isMinimal ? "leading-none" : "";

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`${textSize} text-primary font-semibold flex items-center gap-0.5 cursor-help ${avgLeading}`}>
              {/* Sem ícone no recorte por FILTRO: o funil já significa "esta coluna tem filtro"
                  ao lado do título, e este valor aparece em TODAS as colunas quando qualquer
                  filtro está ativo. O recorte por SELEÇÃO leva ícone porque divide o mesmo slot
                  e a mesma cor com o filtrado — sem ele, marcar linhas com um filtro aplicado
                  trocaria o significado do número sem nada mudar na tela. */}
              {kind === "selection" && <IconSquareCheck className="h-3 w-3 shrink-0" />}
              {value}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="text-xs">{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  const renderMetricHeader = (metricId: string, label: string, column: Column<RankingsItem, unknown>) => {
    const isSum = sumMetrics.has(metricId);
    const textSize = isMinimal ? "text-2xs" : "text-xs";
    const avgLeading = isMinimal ? "leading-none" : "";

    return (
      <div className={`flex flex-col items-center ${isMinimal ? "gap-1" : "gap-0.5"}`}>
        <div className={`flex items-center ${isMinimal ? "gap-0.5" : "gap-1"}`}>
          <SortIcon column={column} />
          <span className={isMinimal ? "text-xs" : ""}>{label}</span>
          {filteredFieldIdsRef.current.has(metricId) && <ActiveFilterIcon onReveal={onRevealField} field={metricId} />}
        </div>
        {formatAverageRef.current(metricId) && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`${textSize} text-muted-foreground font-normal cursor-help ${avgLeading}`}>{formatAverageRef.current(metricId)}</span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="text-xs">{isSum ? "Soma total do pack" : "Média dos anúncios validáveis do pack"}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {renderSubsetAverage(metricId)}
      </div>
    );
  };

  const getMetricContext = () => ({
    actionType: actionTypeRef.current,
    mqlLeadscoreMin,
  });

  const getMetricValueOrNull = (row: RankingsItem, metricId: string) => getMetricNumericValueOrNull(row, metricId, getMetricContext());

  const getMetricValue = (row: RankingsItem, metricId: string) => getMetricNumericValue(row, metricId, getMetricContext());

  const formatMetricCellValue = (metricId: string, value: number | null | undefined) => {
    if (value == null || !Number.isFinite(value)) return "—";
    return formatMetricValue(metricId, value, { currencyFormatter: formatCurrencyRef.current });
  };


  const cols: ColumnDef<RankingsItem, unknown>[] = [];

  // Bloco padrão para métricas sem tratamento especial de header/cell.
  // percentageFilter: valores em escala 0-1 (filtro digitado como "80" vira 0.8);
  // nullable: preserva null (célula mostra "—") em vez de coagir para 0.
  const pushStandardMetricColumn = (metricId: ManagerMetricKey, opts: { percentageFilter?: boolean; nullable?: boolean } = {}) => {
    if (!shouldShow(metricId)) return;
    const getValue = (row: RankingsItem) => (opts.nullable ? getMetricValueOrNull(row, metricId) : getMetricValue(row, metricId));
    cols.push(
      columnHelper.accessor(
        (row) => getValue(row as RankingsItem),
        {
          id: metricId,
          header: ({ column }) => {
            return renderMetricHeader(metricId, getManagerMetricLabel(metricId), column);
          },
          sortingFn: "auto",
          cell: (info) => {
            const value = info.getValue() as number | null;
            return <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatMetricCellValue(metricId, value)}</span>} metric={metricId} getRowKey={getRowKey} byKey={byKey} endDate={endDate} cellMode={cellMode} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} colorMetricValue={colorMetricValue} lightweight />;
          },
        },
      ) as any,
    );
  };

  // Spend
  if (shouldShow("spend")) {
    cols.push(
      columnHelper.accessor("spend", {
        header: ({ column }) => {
          return renderMetricHeader("spend", getManagerMetricLabel("spend"), column);
        },
        sortingFn: "auto",
        cell: (info) => <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatCurrencyRef.current(Number(info.getValue()) || 0)}</span>} metric="spend" getRowKey={getRowKey} byKey={byKey} endDate={endDate} cellMode={cellMode} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} colorMetricValue={colorMetricValue} lightweight />,
      }) as any,
    );
  }

  // Impressions
  if (shouldShow("impressions")) {
    cols.push(
      columnHelper.accessor(
        (row) => getMetricValue(row as RankingsItem, "impressions"),
        {
          id: "impressions",
          header: ({ column }) => {
            return renderMetricHeader("impressions", getManagerMetricLabel("impressions"), column);
          },
          sortingFn: "auto",
          cell: (info) => {
            const impressions = Number(info.getValue() || 0);
            return <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatMetricCellValue("impressions", impressions)}</span>} metric="impressions" getRowKey={getRowKey} byKey={byKey} endDate={endDate} cellMode={cellMode} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} colorMetricValue={colorMetricValue} lightweight />;
          },
        },
      ) as any,
    );
  }

  // Clicks / Reach / Frequency
  pushStandardMetricColumn("clicks");
  pushStandardMetricColumn("reach");
  pushStandardMetricColumn("frequency", { nullable: true });

  // Results
  if (shouldShow("results")) {
    cols.push(
      columnHelper.accessor(
        (row) => getMetricValue(row as RankingsItem, "results"),
        {
          id: "results",
          header: ({ column }) => {
          return renderMetricHeader("results", getManagerMetricLabel("results"), column);
          },
          sortingFn: "auto",
          cell: (info) => {
            const results = Number(info.getValue() || 0);
            return <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatMetricCellValue("results", results)}</span>} metric="results" getRowKey={getRowKey} byKey={byKey} endDate={endDate} cellMode={cellMode} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} colorMetricValue={colorMetricValue} lightweight />;
          },
        },
      ) as any,
    );
  }

  // MQLs
  if (shouldShow("mqls")) {
    cols.push(
      columnHelper.accessor(
        // Corte indefinido -> null atravessa (0 afirmaria "nenhum lead qualificou")
        (row) => getMetricValueOrNull(row as RankingsItem, "mqls"),
        {
          id: "mqls",
          header: ({ column }) => {
          return renderMetricHeader("mqls", getManagerMetricLabel("mqls"), column);
          },
          sortingFn: "auto",
          cell: (info) => {
            const mqls = info.getValue() as number | null;
            return <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatMetricCellValue("mqls", mqls)}</span>} metric="mqls" getRowKey={getRowKey} byKey={byKey} endDate={endDate} cellMode={cellMode} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} colorMetricValue={colorMetricValue} lightweight />;
          },
        },
      ) as any,
    );
  }

  // CPR
  if (shouldShow("cpr")) {
    cols.push(
      columnHelper.accessor(
        (row) => getMetricValueOrNull(row as RankingsItem, "cpr"),
        {
          id: "cpr",
          header: ({ column }) => {
            return renderMetricHeader("cpr", getManagerMetricLabel("cpr"), column);
          },
          sortingFn: "auto",
          cell: (info) => {
            const ad = info.row.original as RankingsItem;
            const cpr = info.getValue() as number | null;
            const value = formatMetricCellValue("cpr", cpr);
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{value}</span>} metric="cpr" getRowKey={getRowKey} byKey={byKey} endDate={endDate} cellMode={cellMode} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} colorMetricValue={colorMetricValue} lightweight />;
          },
        },
      ) as any,
    );
  }

  // CPC
  if (shouldShow("cpc")) {
    cols.push(
      columnHelper.accessor(
        (row) => getMetricValueOrNull(row as RankingsItem, "cpc"),
        {
          id: "cpc",
          header: ({ column }) => {
            return renderMetricHeader("cpc", getManagerMetricLabel("cpc"), column);
          },
          sortingFn: "auto",
          cell: (info) => {
            const ad = info.row.original as RankingsItem;
            const cpc = info.getValue() as number | null;
            const value = formatMetricCellValue("cpc", cpc);
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{value}</span>} metric="cpc" getRowKey={getRowKey} byKey={byKey} endDate={endDate} cellMode={cellMode} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} colorMetricValue={colorMetricValue} lightweight />;
          },
        },
      ) as any,
    );
  }

  // CPLC
  if (shouldShow("cplc")) {
    cols.push(
      columnHelper.accessor(
        (row) => getMetricValueOrNull(row as RankingsItem, "cplc"),
        {
          id: "cplc",
          header: ({ column }) => {
            return renderMetricHeader("cplc", getManagerMetricLabel("cplc"), column);
          },
          sortingFn: "auto",
          cell: (info) => {
            const ad = info.row.original as RankingsItem;
            const cplc = info.getValue() as number | null;
            const value = formatMetricCellValue("cplc", cplc);
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{value}</span>} metric="cplc" getRowKey={getRowKey} byKey={byKey} endDate={endDate} cellMode={cellMode} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} colorMetricValue={colorMetricValue} lightweight />;
          },
        },
      ) as any,
    );
  }

  // CPMQL
  if (shouldShow("cpmql")) {
    cols.push(
      columnHelper.accessor(
        (row) => getMetricValueOrNull(row as RankingsItem, "cpmql"),
        {
          id: "cpmql",
          header: ({ column }) => {
            const textSize = isMinimal ? "text-2xs" : "text-xs";
            const avgLeading = isMinimal ? "leading-none" : "";
            return (
              <div className={`flex flex-col items-center ${isMinimal ? "gap-1" : "gap-0.5"}`}>
                <div className={`flex items-center ${isMinimal ? "gap-0.5" : "gap-1.5"}`}>
                  {mqlLeadscoreMin == null && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openSettings("leadscore");
                            }}
                            className="text-warning hover:text-warning-80 transition-colors"
                          >
                            <IconAlertTriangle className={isMinimal ? "h-3 w-3" : "h-4 w-4"} />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>
                            Configure seu leadscore mínimo{" "}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                openSettings("leadscore");
                              }}
                              className="underline font-medium hover:text-primary"
                            >
                              clicando aqui
                            </button>
                            .
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  <SortIcon column={column} />
                  <span className={isMinimal ? "text-xs" : ""}>{getManagerMetricLabel("cpmql")}</span>
                  {filteredFieldIdsRef.current.has("cpmql") && <ActiveFilterIcon onReveal={onRevealField} field="cpmql" />}
                </div>
                {formatAverageRef.current("cpmql") && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={`${textSize} text-muted-foreground font-normal cursor-help ${avgLeading}`}>{formatAverageRef.current("cpmql")}</span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        <p className="text-xs">Média dos anúncios validáveis do pack</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {renderSubsetAverage("cpmql")}
              </div>
            );
          },
          sortingFn: "auto",
          cell: (info) => {
            const ad = info.row.original as RankingsItem;
            const cpmql = info.getValue() as number | null;
            const value = formatMetricCellValue("cpmql", cpmql);
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{value}</span>} metric="cpmql" getRowKey={getRowKey} byKey={byKey} endDate={endDate} cellMode={cellMode} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} colorMetricValue={colorMetricValue} lightweight />;
          },
        },
      ) as any,
    );
  }

  // CPM
  if (shouldShow("cpm")) {
    cols.push(
      columnHelper.accessor(
        (row) => {
          const ad = row as RankingsItem;
          const cpm = typeof ad.cpm === "number" ? ad.cpm : 0;
          return Number.isFinite(cpm) ? cpm : 0;
        },
        {
          id: "cpm",
          header: ({ column }) => {
          return renderMetricHeader("cpm", getManagerMetricLabel("cpm"), column);
          },
          sortingFn: "auto",
          cell: (info) => {
            const ad = info.row.original as RankingsItem;
            const cpm = Number(info.getValue() || 0);
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{formatCurrencyRef.current(cpm)}</span>} metric="cpm" getRowKey={getRowKey} byKey={byKey} endDate={endDate} cellMode={cellMode} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} colorMetricValue={colorMetricValue} lightweight />;
          },
        },
      ) as any,
    );
  }

  // Scroll Stop
  pushStandardMetricColumn("scroll_stop", { percentageFilter: true, nullable: true });

  // Hook
  if (shouldShow("hook")) {
    cols.push(
      columnHelper.accessor("hook", {
        header: ({ column }) => {
          return renderMetricHeader("hook", getManagerMetricLabel("hook"), column);
        },
        cell: (info) => {
          const original = info.row.original as RankingsItem;
          const hookValue = info.getValue() ?? original.hook ?? 0;
          const hookAsPct = Number(hookValue) * 100;
          return <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatPct(hookAsPct)}</span>} metric="hook" getRowKey={getRowKey} byKey={byKey} endDate={endDate} cellMode={cellMode} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} colorMetricValue={colorMetricValue} lightweight />;
        },
        sortingFn: "auto",
      }) as any,
    );
  }

  // Hold Rate / 50% View / 75% View / Plays / ThruPlays
  pushStandardMetricColumn("hold_rate", { percentageFilter: true, nullable: true });
  pushStandardMetricColumn("video_watched_p50", { nullable: true });
  pushStandardMetricColumn("video_watched_p75", { nullable: true });
  pushStandardMetricColumn("plays");
  pushStandardMetricColumn("thruplays");

  // Link CTR
  if (shouldShow("website_ctr")) {
    cols.push(
      columnHelper.accessor(
        (row) => getMetricValueOrNull(row as RankingsItem, "website_ctr"),
        {
          id: "website_ctr",
          header: ({ column }) => {
            return renderMetricHeader("website_ctr", getManagerMetricLabel("website_ctr"), column);
          },
          sortingFn: "auto",
          cell: (info) => {
            const ad = info.row.original as RankingsItem;
            const websiteCtr = Number(info.getValue() || 0);
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{formatPct(websiteCtr * 100)}</span>} metric="website_ctr" getRowKey={getRowKey} byKey={byKey} endDate={endDate} cellMode={cellMode} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} colorMetricValue={colorMetricValue} lightweight />;
          },
        },
      ) as any,
    );
  }

  // Connect Rate
  if (shouldShow("connect_rate")) {
    cols.push(
      columnHelper.accessor("connect_rate", {
        header: ({ column }) => {
          return renderMetricHeader("connect_rate", getManagerMetricLabel("connect_rate"), column);
        },
        sortingFn: "auto",
        cell: (info) => <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatPct(Number(Number(info.getValue()) * 100))}</span>} metric="connect_rate" getRowKey={getRowKey} byKey={byKey} endDate={endDate} cellMode={cellMode} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} colorMetricValue={colorMetricValue} lightweight />,
      }) as any,
    );
  }

  // LPV
  pushStandardMetricColumn("lpv");

  // Leadscore médio
  pushStandardMetricColumn("leadscore_avg", { nullable: true });

  // % de MQLs (taxa de qualificação) — ratioPercent, escala 0-1, logo percentageFilter
  pushStandardMetricColumn("mql_rate", { percentageFilter: true, nullable: true });

  // Page Conversion
  if (shouldShow("page_conv")) {
    cols.push(
      columnHelper.accessor(
        (row) => getMetricValueOrNull(row as RankingsItem, "page_conv"),
        {
          id: "page_conv",
          header: ({ column }) => {
            return renderMetricHeader("page_conv", getManagerMetricLabel("page_conv"), column);
          },
          sortingFn: "auto",
          cell: (info) => {
            const ad = info.row.original as RankingsItem;
            const pageConv = Number(info.getValue() || 0);
            return <MetricCell row={ad} value={<span className="text-center inline-block w-full">{formatPct(pageConv * 100)}</span>} metric="page_conv" getRowKey={getRowKey} byKey={byKey} endDate={endDate} cellMode={cellMode} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} colorMetricValue={colorMetricValue} lightweight />;
          },
        },
      ) as any,
    );
  }

  // CTR
  if (shouldShow("ctr")) {
    cols.push(
      columnHelper.accessor("ctr", {
        header: ({ column }) => {
          return renderMetricHeader("ctr", getManagerMetricLabel("ctr"), column);
        },
        sortingFn: "auto",
        cell: (info) => <MetricCell row={info.row.original} value={<span className="text-center inline-block w-full">{formatPct(Number(Number(info.getValue()) * 100))}</span>} metric="ctr" getRowKey={getRowKey} byKey={byKey} endDate={endDate} cellMode={cellMode} averages={averagesRef.current} formatCurrency={formatCurrencyRef.current} actionType={actionTypeRef.current} hasSheetIntegration={hasSheetIntegration} mqlLeadscoreMin={mqlLeadscoreMin} minimal={isMinimal} colorMetricValue={colorMetricValue} lightweight />,
      }) as any,
    );
  }

  return cols;
}
