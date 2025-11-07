"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Modal } from "@/components/common/Modal";
import { useFormatCurrency } from "@/lib/utils/currency";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createColumnHelper, getCoreRowModel, getSortedRowModel, getFilteredRowModel, getPaginationRowModel, useReactTable, flexRender, ColumnDef, SortingState, ColumnFiltersState, PaginationState } from "@tanstack/react-table";
import { IconArrowsSort, IconTrendingUp, IconTrendingDown, IconMinus, IconStar, IconEye, IconPlayerPlay, IconDownload, IconFilter, IconChevronLeft, IconChevronRight, IconChartBar, IconBolt, IconTarget, IconCurrencyDollar } from "@tabler/icons-react";

// Tipos para os dados de demonstração
interface DemoAd {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  campaign: string;
  impressions: number;
  clicks: number;
  spend: number;
  ctr: number;
  cpm: number;
  cpc: number;
  reach: number;
  frequency: number;
  video_views: number;
  video_view_rate: number;
  cost_per_video_view: number;
  performance_trend: number[]; // Array de valores para mini gráfico
  quality_score: number;
  audience_size: number;
  bid_strategy: "LOWEST_COST" | "TARGET_COST" | "BID_CAP";
  optimization_goal: string;
  created_at: string;
  last_updated: string;
}

// Dados fake para demonstração
const generateFakeData = (): DemoAd[] => {
  const campaigns = ["Summer Sale", "Black Friday", "Holiday Special", "New Product Launch", "Brand Awareness"];
  const statuses: ("ACTIVE" | "PAUSED" | "ARCHIVED")[] = ["ACTIVE", "PAUSED", "ARCHIVED"];
  const bidStrategies: ("LOWEST_COST" | "TARGET_COST" | "BID_CAP")[] = ["LOWEST_COST", "TARGET_COST", "BID_CAP"];
  const optimizationGoals = ["REACH", "IMPRESSIONS", "CLICKS", "CONVERSIONS", "VIDEO_VIEWS"];

  return Array.from({ length: 50 }, (_, i) => {
    const impressions = Math.floor(Math.random() * 100000) + 1000;
    const clicks = Math.floor(impressions * (Math.random() * 0.05 + 0.01));
    const spend = Math.random() * 5000 + 100;
    const ctr = (clicks / impressions) * 100;
    const cpm = (spend / impressions) * 1000;
    const cpc = spend / clicks;
    const reach = Math.floor(impressions * (Math.random() * 0.8 + 0.2));
    const frequency = impressions / reach;
    const videoViews = Math.floor(clicks * (Math.random() * 0.7 + 0.3));
    const videoViewRate = (videoViews / impressions) * 100;
    const costPerVideoView = spend / videoViews;
    const qualityScore = Math.floor(Math.random() * 4) + 1;
    const audienceSize = Math.floor(Math.random() * 10000000) + 100000;

    // Gerar dados de tendência para mini gráfico
    const performanceTrend = Array.from({ length: 7 }, () => Math.floor(Math.random() * 100) + 50);

    return {
      id: `ad_${i + 1}`,
      name: `Anúncio ${i + 1} - ${campaigns[Math.floor(Math.random() * campaigns.length)]}`,
      status: statuses[Math.floor(Math.random() * statuses.length)],
      campaign: campaigns[Math.floor(Math.random() * campaigns.length)],
      impressions,
      clicks,
      spend,
      ctr,
      cpm,
      cpc,
      reach,
      frequency,
      video_views: videoViews,
      video_view_rate: videoViewRate,
      cost_per_video_view: costPerVideoView,
      performance_trend: performanceTrend,
      quality_score: qualityScore,
      audience_size: audienceSize,
      bid_strategy: bidStrategies[Math.floor(Math.random() * bidStrategies.length)],
      optimization_goal: optimizationGoals[Math.floor(Math.random() * optimizationGoals.length)],
      created_at: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      last_updated: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
  });
};

// Componente para mini gráfico de tendência
const TrendChart = ({ data }: { data: number[] }) => {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min;

  return (
    <div className="w-20 h-8 flex items-end gap-0.5">
      {data.map((value, index) => {
        const height = range > 0 ? ((value - min) / range) * 100 : 50;
        const isIncreasing = index > 0 && value > data[index - 1];
        const isDecreasing = index > 0 && value < data[index - 1];

        return <div key={index} className={`w-2 rounded-sm ${isIncreasing ? "bg-green-500" : isDecreasing ? "bg-red-500" : "bg-gray-400"}`} style={{ height: `${Math.max(height, 10)}%` }} />;
      })}
    </div>
  );
};

// Componente para indicador de performance
const PerformanceIndicator = ({ value, type }: { value: number; type: "ctr" | "cpm" | "cpc" }) => {
  const getColor = () => {
    switch (type) {
      case "ctr":
        if (value >= 2) return "text-green-600 bg-green-50 border-border";
        if (value >= 1) return "text-yellow-600 bg-yellow-50 border-border";
        return "text-red-600 bg-red-50 border-border";
      case "cpm":
        if (value <= 10) return "text-green-600 bg-green-50 border-border";
        if (value <= 20) return "text-yellow-600 bg-yellow-50 border-border";
        return "text-red-600 bg-red-50 border-border";
      case "cpc":
        if (value <= 1) return "text-green-600 bg-green-50 border-border";
        if (value <= 3) return "text-yellow-600 bg-yellow-50 border-border";
        return "text-red-600 bg-red-50 border-border";
      default:
        return "text-gray-600 bg-gray-50 border-border";
    }
  };

  const getIcon = () => {
    switch (type) {
      case "ctr":
        return value >= 2 ? <IconTrendingUp className="w-3 h-3" /> : value >= 1 ? <IconMinus className="w-3 h-3" /> : <IconTrendingDown className="w-3 h-3" />;
      case "cpm":
        return value <= 10 ? <IconTrendingDown className="w-3 h-3" /> : value <= 20 ? <IconMinus className="w-3 h-3" /> : <IconTrendingUp className="w-3 h-3" />;
      case "cpc":
        return value <= 1 ? <IconTrendingDown className="w-3 h-3" /> : value <= 3 ? <IconMinus className="w-3 h-3" /> : <IconTrendingUp className="w-3 h-3" />;
      default:
        return <IconMinus className="w-3 h-3" />;
    }
  };

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium ${getColor()}`}>
      {getIcon()}
      <span>{value.toFixed(2)}</span>
    </div>
  );
};

// Componente para qualidade do anúncio
const QualityScore = ({ score }: { score: number }) => {
  const getColor = () => {
    if (score >= 4) return "text-green-600 bg-green-50";
    if (score >= 3) return "text-yellow-600 bg-yellow-50";
    return "text-red-600 bg-red-50";
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex">
        {Array.from({ length: 5 }, (_, i) => (
          <IconStar key={i} className={`w-4 h-4 ${i < score ? "text-yellow-400 fill-current" : "text-gray-300"}`} />
        ))}
      </div>
      <span className={`text-xs font-medium px-2 py-1 rounded ${getColor()}`}>{score}/5</span>
    </div>
  );
};

export default function TableDemoPage() {
  const formatCurrency = useFormatCurrency();
  const [data] = useState<DemoAd[]>(generateFakeData());
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const [selectedAd, setSelectedAd] = useState<DemoAd | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const columnHelper = createColumnHelper<DemoAd>();

  const columns = useMemo<ColumnDef<DemoAd>[]>(
    () => [
      // Coluna com status colorido e ícones
      columnHelper.accessor("status", {
        header: "Status",
        cell: (info) => {
          const status = info.getValue();
          const statusConfig = {
            ACTIVE: { color: "bg-green-100 text-green-800 border-border", icon: "🟢", label: "Ativo" },
            PAUSED: { color: "bg-yellow-100 text-yellow-800 border-border", icon: "⏸️", label: "Pausado" },
            ARCHIVED: { color: "bg-gray-100 text-gray-800 border-border", icon: "📁", label: "Arquivado" },
          };
          const config = statusConfig[status];

          return (
            <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-sm font-medium ${config.color}`}>
              <span>{config.icon}</span>
              <span>{config.label}</span>
            </div>
          );
        },
      }),

      // Coluna com nome do anúncio e campanha
      columnHelper.accessor("name", {
        header: "Anúncio",
        cell: (info) => {
          const ad = info.row.original;
          return (
            <div className="space-y-1">
              <div className="font-semibold text-sm text-gray-900 truncate max-w-[200px]">{info.getValue()}</div>
              <div className="text-xs text-gray-500">{ad.campaign}</div>
            </div>
          );
        },
      }),

      // Coluna com mini gráfico de performance
      columnHelper.accessor("performance_trend", {
        header: "Tendência",
        cell: (info) => (
          <div className="flex items-center gap-2">
            <TrendChart data={info.getValue()} />
            <div className="text-xs text-gray-500">{info.getValue().length} dias</div>
          </div>
        ),
      }),

      // Coluna com métricas formatadas e coloridas
      columnHelper.accessor("impressions", {
        header: "Impressões",
        cell: (info) => (
          <div className="text-right">
            <div className="font-mono text-sm font-semibold">{info.getValue().toLocaleString("pt-BR")}</div>
            <div className="text-xs text-gray-500">Reach: {info.row.original.reach.toLocaleString("pt-BR")}</div>
          </div>
        ),
      }),

      // Coluna CTR com indicador de performance
      columnHelper.accessor("ctr", {
        header: "CTR",
        cell: (info) => (
          <div className="text-right">
            <PerformanceIndicator value={info.getValue()} type="ctr" />
            <div className="text-xs text-gray-500 mt-1">{info.row.original.clicks.toLocaleString("pt-BR")} cliques</div>
          </div>
        ),
      }),

      // Coluna CPM com indicador de performance
      columnHelper.accessor("cpm", {
        header: "CPM",
        cell: (info) => (
          <div className="text-right">
            <PerformanceIndicator value={info.getValue()} type="cpm" />
            <div className="text-xs text-gray-500 mt-1">${info.getValue().toFixed(2)}</div>
          </div>
        ),
      }),

      // Coluna CPC com indicador de performance
      columnHelper.accessor("cpc", {
        header: "CPC",
        cell: (info) => (
          <div className="text-right">
            <PerformanceIndicator value={info.getValue()} type="cpc" />
            <div className="text-xs text-gray-500 mt-1">${info.getValue().toFixed(2)}</div>
          </div>
        ),
      }),

      // Coluna de gastos com formatação especial
      columnHelper.accessor("spend", {
        header: "Gastos",
        cell: (info) => {
          const value = info.getValue();
          const isHighSpend = value > 2000;
          const isLowSpend = value < 500;

          return (
            <div className={`text-right ${isHighSpend ? "text-red-600" : isLowSpend ? "text-green-600" : "text-gray-900"}`}>
              <div className="font-mono text-lg font-bold">${value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
              <div className="text-xs text-gray-500">{isHighSpend ? "Alto gasto" : isLowSpend ? "Baixo gasto" : "Médio gasto"}</div>
            </div>
          );
        },
      }),

      // Coluna de qualidade com estrelas
      columnHelper.accessor("quality_score", {
        header: "Qualidade",
        cell: (info) => <QualityScore score={info.getValue()} />,
      }),

      // Coluna de vídeo com métricas específicas
      columnHelper.accessor("video_views", {
        header: "Vídeo",
        cell: (info) => {
          const ad = info.row.original;
          return (
            <div className="space-y-1">
              <div className="flex items-center gap-1">
                <IconPlayerPlay className="w-3 h-3 text-blue-500" />
                <span className="font-mono text-sm">{ad.video_views.toLocaleString("pt-BR")}</span>
              </div>
              <div className="text-xs text-gray-500">{ad.video_view_rate.toFixed(1)}% taxa</div>
              <div className="text-xs text-gray-500">${ad.cost_per_video_view.toFixed(2)}/view</div>
            </div>
          );
        },
      }),

      // Coluna de estratégia de lance
      columnHelper.accessor("bid_strategy", {
        header: "Estratégia",
        cell: (info) => {
          const strategy = info.getValue();
          const strategyConfig = {
            LOWEST_COST: { color: "bg-blue-100 text-blue-800", label: "Menor Custo" },
            TARGET_COST: { color: "bg-purple-100 text-purple-800", label: "Custo Alvo" },
            BID_CAP: { color: "bg-orange-100 text-orange-800", label: "Limite de Lance" },
          };
          const config = strategyConfig[strategy];

          return (
            <div className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${config.color}`}>
              <IconTarget className="w-3 h-3" />
              {config.label}
            </div>
          );
        },
      }),

      // Coluna de ações
      columnHelper.display({
        id: "actions",
        header: "Ações",
        cell: ({ row }) => {
          const ad = row.original;
          return (
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                <IconEye className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                <IconPlayerPlay className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                <IconDownload className="w-4 h-4" />
              </Button>
            </div>
          );
        },
      }),
    ] as ColumnDef<DemoAd>[],
    [columnHelper]
  );

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      columnFilters,
      pagination,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });


  return (
    <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold flex items-center gap-3">
              <IconChartBar className="w-10 h-10 text-brand" />
              Demonstração TanStack Table
            </h1>
            <p className="text-muted-foreground">Exemplos avançados de customização e funcionalidades</p>
          </div>
        </div>

        {/* Cards de resumo */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <IconBolt className="w-5 h-5 text-blue-500" />
                <div>
                  <div className="text-2xl font-bold">{data.filter((ad) => ad.status === "ACTIVE").length}</div>
                  <div className="text-sm text-muted-foreground">Anúncios Ativos</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <IconCurrencyDollar className="w-5 h-5 text-green-500" />
                <div>
                  <div className="text-2xl font-bold">{formatCurrency(data.reduce((sum, ad) => sum + ad.spend, 0))}</div>
                  <div className="text-sm text-muted-foreground">Gasto Total</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <IconTarget className="w-5 h-5 text-purple-500" />
                <div>
                  <div className="text-2xl font-bold">{(data.reduce((sum, ad) => sum + ad.ctr, 0) / data.length).toFixed(2)}%</div>
                  <div className="text-sm text-muted-foreground">CTR Médio</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-2">
                <IconTrendingUp className="w-5 h-5 text-orange-500" />
                <div>
                  <div className="text-2xl font-bold">{data.reduce((sum, ad) => sum + ad.impressions, 0).toLocaleString("pt-BR")}</div>
                  <div className="text-sm text-muted-foreground">Impressões</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabela principal */}
        <Card>
          <CardHeader>
            <CardTitle>Anúncios - Demonstração Avançada</CardTitle>
            <CardDescription>Tabela com mini gráficos, coloração condicional, estilização avançada e funcionalidades interativas</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="w-full">
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <tr key={headerGroup.id} className="bg-gray-50">
                        {headerGroup.headers.map((header) => (
                          <th key={header.id} className="border border-border p-3 text-left font-medium text-gray-700">
                            {header.isPlaceholder ? null : (
                              <div className={`flex items-center gap-2 ${header.column.getCanSort() ? "cursor-pointer select-none hover:text-blue-600" : ""}`} onClick={header.column.getToggleSortingHandler()}>
                                {flexRender(header.column.columnDef.header, header.getContext())}
                                {header.column.getCanSort() && <IconArrowsSort className="w-4 h-4" />}
                              </div>
                            )}
                          </th>
                        ))}
                      </tr>
                    ))}
                  </thead>
                  <tbody>
                    {table.getRowModel().rows.map((row) => (
                      <tr
                        key={row.id}
                        className="hover:bg-gray-50 border-b border-border cursor-pointer transition-colors"
                        onClick={(e) => {
                          // Previne a abertura do modal se clicar em botões dentro da linha
                          const target = e.target as HTMLElement;
                          if (target.closest("button") || target.closest("a")) {
                            return;
                          }
                          setSelectedAd(row.original);
                          setIsModalOpen(true);
                        }}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td key={cell.id} className="border border-border p-3">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Paginação */}
              <div className="flex items-center justify-between mt-4">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                    <IconChevronLeft className="w-4 h-4" />
                    Anterior
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                    Próximo
                    <IconChevronRight className="w-4 h-4" />
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-500">
                    Página {table.getState().pagination.pageIndex + 1} de {table.getPageCount()}
                  </span>
                  <select value={table.getState().pagination.pageSize} onChange={(e) => table.setPageSize(Number(e.target.value))} className="border border-border bg-input rounded px-2 py-1 text-sm">
                    {[10, 20, 30, 40, 50].map((pageSize) => (
                      <option key={pageSize} value={pageSize}>
                        {pageSize} por página
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Explicação das funcionalidades */}
        <Card>
          <CardHeader>
            <CardTitle>Funcionalidades Demonstradas</CardTitle>
            <CardDescription>Esta tabela demonstra o poder e flexibilidade do TanStack Table</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold mb-3 text-green-600">✅ Mini Gráficos</h4>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li>• Coluna "Tendência" com gráfico de barras</li>
                  <li>• Cores dinâmicas baseadas em performance</li>
                  <li>• Componentes React customizados</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold mb-3 text-blue-600">🎨 Coloração Condicional</h4>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li>• Status com cores e ícones</li>
                  <li>• Indicadores de performance (CTR, CPM, CPC)</li>
                  <li>• Sistema de cores baseado em thresholds</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold mb-3 text-purple-600">🎯 Estilização Avançada</h4>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li>• Fontes e tamanhos personalizados</li>
                  <li>• Backgrounds condicionais</li>
                  <li>• Layouts complexos em células</li>
                </ul>
              </div>

              <div>
                <h4 className="font-semibold mb-3 text-orange-600">⚡ Funcionalidades</h4>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li>• Ordenação por colunas</li>
                  <li>• Paginação configurável</li>
                  <li>• Filtros e busca</li>
                  <li>• Ações interativas</li>
                  <li>• Clique na linha abre modal com detalhes</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Modal de Detalhes do Anúncio */}
        <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} size="full" className="max-w-5xl" padding="md">
          <div className="space-y-1.5 mb-6">
            <h2 className="text-2xl font-semibold leading-none tracking-tight">Detalhes do Anúncio</h2>
            <p className="text-sm text-muted-foreground">Informações completas e métricas detalhadas</p>
          </div>
          {selectedAd && (
              <div className="space-y-6">
                {/* Header com nome e status */}
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-3xl font-bold">{selectedAd.name}</h3>
                    <p className="text-muted-foreground mt-1">{selectedAd.campaign}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      ID: {selectedAd.id} • Criado em: {new Date(selectedAd.created_at).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full border border-border text-sm font-medium ${selectedAd.status === "ACTIVE" ? "bg-green-100 text-green-800" : selectedAd.status === "PAUSED" ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-800"}`}>
                    <span>{selectedAd.status === "ACTIVE" ? "🟢" : selectedAd.status === "PAUSED" ? "⏸️" : "📁"}</span>
                    <span>{selectedAd.status === "ACTIVE" ? "Ativo" : selectedAd.status === "PAUSED" ? "Pausado" : "Arquivado"}</span>
                  </div>
                </div>

                {/* Métricas principais em grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-muted-foreground mb-1">Impressões</div>
                      <div className="text-2xl font-bold">{selectedAd.impressions.toLocaleString("pt-BR")}</div>
                      <div className="text-xs text-muted-foreground mt-1">Reach: {selectedAd.reach.toLocaleString("pt-BR")}</div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-muted-foreground mb-1">Clicks</div>
                      <div className="text-2xl font-bold text-blue-600">{selectedAd.clicks.toLocaleString("pt-BR")}</div>
                      <div className="text-xs text-muted-foreground mt-1">Frequência: {selectedAd.frequency.toFixed(2)}x</div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-muted-foreground mb-1">Gastos</div>
                      <div className="text-2xl font-bold text-green-600">${selectedAd.spend.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        CPM: ${selectedAd.cpm.toFixed(2)} • CPC: ${selectedAd.cpc.toFixed(2)}
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4">
                      <div className="text-sm text-muted-foreground mb-1">CTR</div>
                      <div className="text-2xl font-bold">
                        <PerformanceIndicator value={selectedAd.ctr} type="ctr" />
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">Taxa de clique</div>
                    </CardContent>
                  </Card>
                </div>

                {/* Métricas de performance */}
                <Card>
                  <CardHeader>
                    <CardTitle>Métricas de Performance</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                      <div>
                        <div className="text-sm text-muted-foreground">CPM</div>
                        <div className="text-xl font-semibold mt-1">
                          <PerformanceIndicator value={selectedAd.cpm} type="cpm" />
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">CPC</div>
                        <div className="text-xl font-semibold mt-1">
                          <PerformanceIndicator value={selectedAd.cpc} type="cpc" />
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Qualidade</div>
                        <div className="mt-1">
                          <QualityScore score={selectedAd.quality_score} />
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Métricas de vídeo */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <IconPlayerPlay className="w-5 h-5" />
                      Métricas de Vídeo
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                      <div>
                        <div className="text-sm text-muted-foreground">Visualizações</div>
                        <div className="text-xl font-semibold mt-1">{selectedAd.video_views.toLocaleString("pt-BR")}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Taxa de Visualização</div>
                        <div className="text-xl font-semibold mt-1">{selectedAd.video_view_rate.toFixed(2)}%</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Custo por Visualização</div>
                        <div className="text-xl font-semibold mt-1">${selectedAd.cost_per_video_view.toFixed(2)}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Configurações e estratégia */}
                <Card>
                  <CardHeader>
                    <CardTitle>Configurações</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm text-muted-foreground mb-2">Estratégia de Lance</div>
                        <div className={`inline-flex items-center gap-1 px-3 py-1 rounded text-sm font-medium ${selectedAd.bid_strategy === "LOWEST_COST" ? "bg-blue-100 text-blue-800" : selectedAd.bid_strategy === "TARGET_COST" ? "bg-purple-100 text-purple-800" : "bg-orange-100 text-orange-800"}`}>
                          <IconTarget className="w-4 h-4" />
                          {selectedAd.bid_strategy === "LOWEST_COST" ? "Menor Custo" : selectedAd.bid_strategy === "TARGET_COST" ? "Custo Alvo" : "Limite de Lance"}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground mb-2">Objetivo de Otimização</div>
                        <div className="text-sm font-medium">{selectedAd.optimization_goal}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground mb-2">Tamanho da Audiência</div>
                        <div className="text-sm font-medium">{selectedAd.audience_size.toLocaleString("pt-BR")}</div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground mb-2">Última Atualização</div>
                        <div className="text-sm font-medium">{new Date(selectedAd.last_updated).toLocaleString("pt-BR")}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Tendência de performance */}
                <Card>
                  <CardHeader>
                    <CardTitle>Tendência de Performance (7 dias)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4">
                      <TrendChart data={selectedAd.performance_trend} />
                      <div className="text-sm text-muted-foreground">Média: {Math.round(selectedAd.performance_trend.reduce((a, b) => a + b, 0) / selectedAd.performance_trend.length)}</div>
                    </div>
                  </CardContent>
                </Card>
              </div>
          )}
        </Modal>
    </div>
  );
}
