"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Toggle } from "@/components/ui/toggle";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Modal } from "@/components/common/Modal";
import { SparklineBars } from "@/components/common/SparklineBars";
import { DateRangeFilter } from "@/components/common/DateRangeFilter";
import { LoadingState, ErrorState, EmptyState } from "@/components/common/States";
import { ManagerTable } from "@/components/manager/ManagerTable";

interface ColorVariable {
  name: string;
  value: string;
  category: string;
}

function getComputedColorValue(varName: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

export default function ComponentsShowcase() {
  const [dateRange, setDateRange] = useState<{ start?: string; end?: string }>({ start: "2024-01-01", end: "2024-12-31" });
  const [progressValue, setProgressValue] = useState(45);
  const [toggleState, setToggleState] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [colorVariables, setColorVariables] = useState<ColorVariable[]>([]);

  // Dados de exemplo para SparklineBars
  const sampleSeries = [10, 25, 18, 30, 22, 35, 28, 40, 32, 45];

  useEffect(() => {
    // Lista todas as variáveis de cor CSS definidas no app
    const colorVars: ColorVariable[] = [
      // Cores semânticas principais
      { name: "--background", value: "", category: "Base" },
      { name: "--foreground", value: "", category: "Base" },
      { name: "--card", value: "", category: "Componentes" },
      { name: "--card-foreground", value: "", category: "Componentes" },
      { name: "--popover", value: "", category: "Componentes" },
      { name: "--popover-foreground", value: "", category: "Componentes" },
      { name: "--primary", value: "", category: "Primária" },
      { name: "--primary-foreground", value: "", category: "Primária" },
      { name: "--secondary", value: "", category: "Secundária" },
      { name: "--secondary-foreground", value: "", category: "Secundária" },
      { name: "--muted", value: "", category: "Estados" },
      { name: "--muted-foreground", value: "", category: "Estados" },
      { name: "--accent", value: "", category: "Destaque" },
      { name: "--accent-foreground", value: "", category: "Destaque" },
      { name: "--destructive", value: "", category: "Estados" },
      { name: "--border", value: "", category: "Bordas" },
      { name: "--input", value: "", category: "Formulários" },
      { name: "--ring", value: "", category: "Foco" },

      // Sidebar
      { name: "--sidebar", value: "", category: "Sidebar" },
      { name: "--sidebar-foreground", value: "", category: "Sidebar" },
      { name: "--sidebar-primary", value: "", category: "Sidebar" },
      { name: "--sidebar-primary-foreground", value: "", category: "Sidebar" },

      // Cores customizadas
      { name: "--text", value: "", category: "Customizadas" },
      { name: "--surface", value: "", category: "Customizadas" },
      { name: "--surface-2", value: "", category: "Customizadas" },

      // Chart colors (se existirem)
      { name: "--chart-1", value: "", category: "Gráficos" },
      { name: "--chart-2", value: "", category: "Gráficos" },
      { name: "--chart-3", value: "", category: "Gráficos" },
      { name: "--chart-4", value: "", category: "Gráficos" },
      { name: "--chart-5", value: "", category: "Gráficos" },
    ];

    // Pega os valores reais das variáveis CSS
    const colorsWithValues = colorVars.map((color) => ({
      ...color,
      value: getComputedColorValue(color.name) || "N/A",
    }));

    setColorVariables(colorsWithValues);
  }, []);

  // Agrupa cores por categoria
  const colorsByCategory = colorVariables.reduce((acc, color) => {
    if (!acc[color.category]) {
      acc[color.category] = [];
    }
    acc[color.category].push(color);
    return acc;
  }, {} as Record<string, ColorVariable[]>);

  // Cores hardcoded do Tailwind config
  const hardcodedColors = [
    { name: "brand", value: "#1447e6", category: "Brand" },
    { name: "brand-600", value: "#256D2A", category: "Brand" },
    { name: "brand-700", value: "#1F5A23", category: "Brand" },
    { name: "danger", value: "#EF4444", category: "Sistema" },
    { name: "warning", value: "#F59E0B", category: "Sistema" },
    { name: "info", value: "#3B82F6", category: "Sistema" },
    { name: "surface3", value: "#33373C", category: "Customizadas" },
  ];

  // Função auxiliar para determinar se o texto deve ser claro ou escuro
  const getTextColor = (bgColor: string): string => {
    if (!bgColor || bgColor === "N/A" || (bgColor.startsWith("rgb(") && bgColor.includes("/"))) {
      return "text-foreground";
    }
    // Simplificação: se for uma cor escura conhecida, usa texto claro
    const darkColors = ["#0a0a0a", "#000000", "#131517", "#2D2D2D", "#262626", "#404040"];
    if (darkColors.some((dc) => bgColor.toLowerCase().includes(dc.toLowerCase()))) {
      return "text-white";
    }
    return "text-foreground";
  };

  // Função para formatar o valor da cor para exibição
  const formatColorValue = (value: string): string => {
    if (!value || value === "N/A") return "N/A";
    // Remove espaços extras e limpa o valor
    return value.replace(/\s+/g, " ").trim();
  };

  return (
    <div className="p-8 space-y-8">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Component Showcase</h1>
        <p className="text-muted-foreground">Todos os componentes do app em um só lugar</p>
      </div>

      {/* Paleta de Cores */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold mb-4">Paleta de Cores</h2>
        <Card>
          <CardHeader>
            <CardTitle>Variáveis CSS de Cor</CardTitle>
            <CardDescription>Todas as cores disponíveis no sistema de design</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Variáveis CSS agrupadas por categoria */}
              {Object.entries(colorsByCategory).map(([category, colors]) => (
                <div key={category} className="space-y-2">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{category}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                    {colors.map((color) => {
                      const bgStyle = color.value && color.value !== "N/A" ? { backgroundColor: color.value } : { backgroundColor: "#e5e7eb" };

                      return (
                        <div key={color.name} className="border rounded-md overflow-hidden bg-card">
                          <div className="h-12 w-full flex items-center justify-center" style={bgStyle}>
                            {color.value === "N/A" && <span className="text-[10px] text-muted-foreground">N/A</span>}
                          </div>
                          <div className="p-2 space-y-0.5">
                            <div className="text-[10px] font-medium leading-tight">{color.name.replace("--", "")}</div>
                            <code className="text-[9px] text-muted-foreground break-all line-clamp-1">{formatColorValue(color.value)}</code>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Cores Hardcoded */}
              <div className="space-y-2 pt-2 border-t">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Hardcoded</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                  {hardcodedColors.map((color) => (
                    <div key={color.name} className="border rounded-md overflow-hidden bg-card">
                      <div className="h-12 w-full flex items-center justify-center" style={{ backgroundColor: color.value }} />
                      <div className="p-2 space-y-0.5">
                        <div className="text-[10px] font-medium leading-tight">{color.name}</div>
                        <code className="text-[9px] text-muted-foreground">{color.value}</code>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* UI Components Básicos */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold mb-4">UI Components</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Buttons */}
          <Card>
            <CardHeader>
              <CardTitle>Buttons</CardTitle>
              <CardDescription>Variações do componente Button</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button variant="default">Default</Button>
              <Button variant="destructive">Destructive</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="link">Link</Button>
              <div className="flex gap-2">
                <Button size="sm">Small</Button>
                <Button size="default">Default</Button>
                <Button size="lg">Large</Button>
              </div>
            </CardContent>
          </Card>

          {/* Input */}
          <Card>
            <CardHeader>
              <CardTitle>Input</CardTitle>
              <CardDescription>Campo de entrada de texto</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input type="text" placeholder="Digite algo..." />
              <Input type="email" placeholder="email@exemplo.com" />
              <Input type="password" placeholder="Senha" />
              <Input type="number" placeholder="Número" className="[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]" />
              <Input disabled placeholder="Desabilitado" />
            </CardContent>
          </Card>

          {/* Select */}
          <Card>
            <CardHeader>
              <CardTitle>Select</CardTitle>
              <CardDescription>Dropdown de seleção</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma opção" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="opcao1">Opção 1</SelectItem>
                  <SelectItem value="opcao2">Opção 2</SelectItem>
                  <SelectItem value="opcao3">Opção 3</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Badge */}
          <Card>
            <CardHeader>
              <CardTitle>Badge</CardTitle>
              <CardDescription>Etiquetas e tags</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge variant="default">Default</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="destructive">Destructive</Badge>
                <Badge variant="outline">Outline</Badge>
              </div>
            </CardContent>
          </Card>

          {/* Progress */}
          <Card>
            <CardHeader>
              <CardTitle>Progress</CardTitle>
              <CardDescription>Barra de progresso</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Progress value={progressValue} />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setProgressValue(Math.max(0, progressValue - 10))}>
                  -10
                </Button>
                <Button size="sm" onClick={() => setProgressValue(Math.min(100, progressValue + 10))}>
                  +10
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">{progressValue}%</p>
            </CardContent>
          </Card>

          {/* Skeleton */}
          <Card>
            <CardHeader>
              <CardTitle>Skeleton</CardTitle>
              <CardDescription>Placeholders de carregamento</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-3/4" />
              <Skeleton className="h-12 w-1/2" />
              <div className="flex gap-2">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Toggle */}
          <Card>
            <CardHeader>
              <CardTitle>Toggle</CardTitle>
              <CardDescription>Interruptor on/off</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Toggle pressed={toggleState} onPressedChange={setToggleState}>
                {toggleState ? "Ativado" : "Desativado"}
              </Toggle>
              <Toggle variant="outline" size="sm">
                Small
              </Toggle>
              <Toggle variant="outline" size="lg">
                Large
              </Toggle>
            </CardContent>
          </Card>

          {/* Dialog */}
          <Card>
            <CardHeader>
              <CardTitle>Modal</CardTitle>
              <CardDescription>Modal e diálogos</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => setIsModalOpen(true)}>Abrir Modal</Button>
              <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} size="lg" padding="md">
                <div className="space-y-1.5 mb-6">
                  <h2 className="text-lg font-semibold leading-none tracking-tight">Este é um Modal</h2>
                  <p className="text-sm text-muted-foreground">Um exemplo de diálogo usando o componente Modal.</p>
                </div>
                <div className="py-4">
                  <p>Conteúdo do modal aqui...</p>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <Button variant="outline" onClick={() => setIsModalOpen(false)}>
                    Cancelar
                  </Button>
                  <Button onClick={() => setIsModalOpen(false)}>Confirmar</Button>
                </div>
              </Modal>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Cards */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold mb-4">Cards</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Card Básico</CardTitle>
              <CardDescription>Um card simples com header e conteúdo</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Este é o conteúdo do card.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Card com Footer</CardTitle>
              <CardDescription>Card completo com todas as partes</CardDescription>
            </CardHeader>
            <CardContent>
              <p>Conteúdo principal aqui.</p>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="outline">Cancelar</Button>
              <Button>Confirmar</Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Card Estatístico</CardTitle>
              <CardDescription>Exemplo de card com métricas</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Total</span>
                  <span className="text-2xl font-bold">1,234</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Crescimento</span>
                  <Badge variant="default">+12%</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Table */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold mb-4">Table</h2>
        <Card>
          <CardHeader>
            <CardTitle>Tabela de Exemplo</CardTitle>
            <CardDescription>Todos os componentes de tabela</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Item 1</TableCell>
                  <TableCell>
                    <Badge variant="default">Ativo</Badge>
                  </TableCell>
                  <TableCell>2024-01-15</TableCell>
                  <TableCell className="text-right">R$ 1.234,56</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Item 2</TableCell>
                  <TableCell>
                    <Badge variant="secondary">Pendente</Badge>
                  </TableCell>
                  <TableCell>2024-01-16</TableCell>
                  <TableCell className="text-right">R$ 2.345,67</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Item 3</TableCell>
                  <TableCell>
                    <Badge variant="destructive">Inativo</Badge>
                  </TableCell>
                  <TableCell>2024-01-17</TableCell>
                  <TableCell className="text-right">R$ 3.456,78</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      {/* Common Components */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold mb-4">Common Components</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* DateRangeFilter */}
          <Card>
            <CardHeader>
              <CardTitle>DateRangeFilter</CardTitle>
              <CardDescription>Filtro de intervalo de datas</CardDescription>
            </CardHeader>
            <CardContent>
              <DateRangeFilter value={dateRange} onChange={setDateRange} />
            </CardContent>
          </Card>

          {/* SparklineBars */}
          <Card>
            <CardHeader>
              <CardTitle>SparklineBars</CardTitle>
              <CardDescription>Gráfico de barras compacto</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-muted-foreground mb-2">Modo: Series</p>
                <SparklineBars series={sampleSeries} className="w-full h-12" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-2">Modo: Per-Bar</p>
                <SparklineBars series={sampleSeries} className="w-full h-12" colorMode="per-bar" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-2">Com dados nulos</p>
                <SparklineBars series={[10, null, 18, 30, null, 35, 28]} className="w-full h-12" />
              </div>
            </CardContent>
          </Card>

          {/* States */}
          <Card>
            <CardHeader>
              <CardTitle>States</CardTitle>
              <CardDescription>Estados de carregamento e vazios</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <LoadingState label="Carregando dados..." />
              <ErrorState message="Erro ao carregar dados" />
              <EmptyState message="Nenhum dado encontrado" />
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Complex Components */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold mb-4">Complex Components</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* AdInfoCard - Exemplo simplificado */}
          <Card>
            <CardHeader>
              <CardTitle>AdInfoCard (Exemplo)</CardTitle>
              <CardDescription>Card de informações de anúncio</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Visualizações</span>
                  <span className="font-semibold">1.2M</span>
                </div>
                <Progress value={75} />
                <div className="flex gap-2">
                  <Badge variant="default">Ativo</Badge>
                  <Badge variant="secondary">Premium</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ManagerTable */}
      <section className="space-y-4">
        <h2 className="text-2xl font-semibold mb-4">ManagerTable</h2>
        <Card>
          <CardHeader>
            <CardTitle>Tabela de Manager</CardTitle>
            <CardDescription>Componente completo de manager com sparklines e métricas</CardDescription>
          </CardHeader>
          <CardContent>
            <ManagerTable
              ads={[
                {
                  ad_name: "Anúncio Premium - Produto A",
                  ad_id: "123456789",
                  thumbnail: "https://via.placeholder.com/150",
                  impressions: 15000,
                  clicks: 480,
                  inline_link_clicks: 420,
                  spend: 1500.0,
                  lpv: 112,
                  plays: 5000,
                  hook: 0.45,
                  ctr: 0.032,
                  connect_rate: 0.28,
                  cpm: (1500.0 / 15000) * 1000,
                  conversions: { purchase: 120 },
                  ad_count: 3,
                  series: {
                    axis: ["2024-01-15", "2024-01-16", "2024-01-17", "2024-01-18", "2024-01-19"],
                    hook: [0.42, 0.44, 0.43, 0.45, 0.45],
                    spend: [1400, 1450, 1480, 1500, 1500],
                    ctr: [0.03, 0.031, 0.031, 0.032, 0.032],
                    connect_rate: [0.26, 0.27, 0.27, 0.28, 0.28],
                    lpv: [100, 105, 108, 110, 112],
                    impressions: [2900, 3000, 3050, 3100, 3100],
                    cpm: [96.55, 96.67, 97.05, 96.77, 96.77],
                    website_ctr: [0.0145, 0.0147, 0.0148, 0.0148, 0.0148],
                    conversions: [{ purchase: 10 }, { purchase: 11 }, { purchase: 12 }, { purchase: 12 }, { purchase: 12 }],
                  },
                },
                {
                  ad_name: "Anúncio Estrela - Produto B",
                  ad_id: "987654321",
                  thumbnail: "https://via.placeholder.com/150",
                  impressions: 22000,
                  clicks: 902,
                  inline_link_clicks: 770,
                  spend: 2300.0,
                  lpv: 165,
                  plays: 8000,
                  hook: 0.52,
                  ctr: 0.041,
                  connect_rate: 0.35,
                  cpm: (2300.0 / 22000) * 1000,
                  conversions: { purchase: 146 },
                  ad_count: 5,
                  series: {
                    axis: ["2024-01-15", "2024-01-16", "2024-01-17", "2024-01-18", "2024-01-19"],
                    hook: [0.48, 0.5, 0.51, 0.51, 0.52],
                    spend: [2100, 2200, 2250, 2280, 2300],
                    ctr: [0.038, 0.039, 0.04, 0.04, 0.041],
                    connect_rate: [0.32, 0.33, 0.34, 0.34, 0.35],
                    lpv: [150, 155, 160, 162, 165],
                    impressions: [4200, 4400, 4500, 4560, 4600],
                    cpm: [100.0, 100.0, 100.0, 100.0, 100.0],
                    website_ctr: [0.0175, 0.0177, 0.0178, 0.0178, 0.0178],
                    conversions: [{ purchase: 15 }, { purchase: 16 }, { purchase: 16 }, { purchase: 17 }, { purchase: 17 }],
                  },
                },
                {
                  ad_name: "Anúncio Básico - Produto C",
                  ad_id: "456789123",
                  thumbnail: "https://via.placeholder.com/150",
                  impressions: 13000,
                  clicks: 325,
                  inline_link_clicks: 260,
                  spend: 980.0,
                  lpv: 65,
                  plays: 2500,
                  hook: 0.38,
                  ctr: 0.025,
                  connect_rate: 0.2,
                  cpm: (980.0 / 13000) * 1000,
                  conversions: { purchase: 25 },
                  ad_count: 2,
                  series: {
                    axis: ["2024-01-15", "2024-01-16", "2024-01-17", "2024-01-18", "2024-01-19"],
                    hook: [0.36, 0.37, 0.37, 0.38, 0.38],
                    spend: [920, 950, 965, 975, 980],
                    ctr: [0.024, 0.024, 0.025, 0.025, 0.025],
                    connect_rate: [0.18, 0.19, 0.19, 0.2, 0.2],
                    lpv: [60, 62, 63, 64, 65],
                    impressions: [2500, 2600, 2650, 2680, 2700],
                    cpm: [73.85, 73.08, 72.83, 72.76, 72.59],
                    website_ctr: [0.0104, 0.0104, 0.0106, 0.0106, 0.0106],
                    conversions: [{ purchase: 5 }, { purchase: 5 }, { purchase: 5 }, { purchase: 5 }, { purchase: 5 }],
                  },
                },
                {
                  ad_name: "Anúncio VIP - Produto D",
                  ad_id: "789123456",
                  thumbnail: "https://via.placeholder.com/150",
                  impressions: 32000,
                  clicks: 1536,
                  inline_link_clicks: 1344,
                  spend: 3200.0,
                  lpv: 220,
                  plays: 12000,
                  hook: 0.58,
                  ctr: 0.048,
                  connect_rate: 0.42,
                  cpm: (3200.0 / 32000) * 1000,
                  conversions: { purchase: 284 },
                  ad_count: 7,
                  series: {
                    axis: ["2024-01-15", "2024-01-16", "2024-01-17", "2024-01-18", "2024-01-19"],
                    hook: [0.54, 0.56, 0.57, 0.57, 0.58],
                    spend: [2900, 3050, 3120, 3160, 3200],
                    ctr: [0.045, 0.046, 0.047, 0.047, 0.048],
                    connect_rate: [0.38, 0.4, 0.41, 0.41, 0.42],
                    lpv: [200, 210, 215, 218, 220],
                    impressions: [5800, 6100, 6240, 6320, 6400],
                    cpm: [100.0, 100.0, 100.0, 100.0, 100.0],
                    website_ctr: [0.0216, 0.0218, 0.0219, 0.0219, 0.0220],
                    conversions: [{ purchase: 25 }, { purchase: 26 }, { purchase: 27 }, { purchase: 27 }, { purchase: 28 }],
                  },
                },
                {
                  ad_name: "Anúncio Padrão - Produto E",
                  ad_id: "321654987",
                  thumbnail: "https://via.placeholder.com/150",
                  impressions: 11000,
                  clicks: 198,
                  inline_link_clicks: 165,
                  spend: 750.0,
                  lpv: 54,
                  plays: 1500,
                  hook: 0.32,
                  ctr: 0.018,
                  connect_rate: 0.15,
                  cpm: (750.0 / 11000) * 1000,
                  conversions: { purchase: 33 },
                  ad_count: 1,
                  series: {
                    axis: ["2024-01-15", "2024-01-16", "2024-01-17", "2024-01-18", "2024-01-19"],
                    hook: [0.3, 0.31, 0.31, 0.32, 0.32],
                    spend: [700, 720, 735, 745, 750],
                    ctr: [0.017, 0.017, 0.018, 0.018, 0.018],
                    connect_rate: [0.14, 0.145, 0.148, 0.15, 0.15],
                    lpv: [50, 51, 52, 53, 54],
                    impressions: [2200, 2260, 2310, 2340, 2360],
                    cpm: [68.18, 68.14, 68.18, 68.16, 68.22],
                    website_ctr: [0.0077, 0.0077, 0.0078, 0.0078, 0.0078],
                    conversions: [{ purchase: 3 }, { purchase: 3 }, { purchase: 3 }, { purchase: 3 }, { purchase: 3 }],
                  },
                },
              ]}
              groupByAdName={true}
              endDate="2024-01-20"
              dateStart="2024-01-15"
              dateStop="2024-01-20"
            />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
