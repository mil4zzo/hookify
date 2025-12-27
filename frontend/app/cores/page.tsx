"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { env } from "@/lib/config/env";
import { IconPalette } from "@tabler/icons-react";

interface ColorInfo {
  name: string;
  value: string;
  category: string;
  isTransparent: boolean;
  opacity?: number;
  computedValue?: string;
  baseName: string; // Nome base da cor (ex: "primary" para "primary-5", "primary-10", etc.)
  variation?: string; // Variação específica (ex: "5", "10", "hover", "foreground")
}

function getComputedColorValue(varName: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

function parseOpacity(value: string): { isTransparent: boolean; opacity?: number } {
  if (!value) return { isTransparent: false, opacity: 100 };

  // Verifica se contém color-mix com porcentagem (ex: color-mix(in oklab, var(--primary) 50%, transparent))
  const colorMixMatch = value.match(/color-mix\([^)]+(\d+(?:\.\d+)?)%[^)]*transparent/);
  if (colorMixMatch) {
    const opacity = parseFloat(colorMixMatch[1]);
    return { isTransparent: true, opacity: Math.round(opacity) };
  }

  // Verifica se contém / para opacidade (ex: rgb(255, 0, 0) / 0.5 ou rgba(var(--text-rgb) / 0.5))
  const opacityMatch = value.match(/\/\s*([\d.]+)/);
  if (opacityMatch) {
    const opacityValue = parseFloat(opacityMatch[1]);
    // Se o valor está entre 0 e 1, multiplica por 100
    const opacity = opacityValue <= 1 ? opacityValue * 100 : opacityValue;
    return { isTransparent: true, opacity: Math.round(opacity) };
  }

  // Verifica se contém % no final (ex: rgba(255, 0, 0, 50%))
  const percentMatch = value.match(/(\d+(?:\.\d+)?)%\s*\)/);
  if (percentMatch) {
    const opacity = parseFloat(percentMatch[1]);
    return { isTransparent: true, opacity: Math.round(opacity) };
  }

  // Verifica se é oklch com opacidade (ex: oklch(0.5 0.2 100 / 0.5))
  const oklchOpacityMatch = value.match(/oklch\([^)]+\/\s*([\d.]+)\)/);
  if (oklchOpacityMatch) {
    const opacityValue = parseFloat(oklchOpacityMatch[1]);
    const opacity = opacityValue <= 1 ? opacityValue * 100 : opacityValue;
    return { isTransparent: true, opacity: Math.round(opacity) };
  }

  // Verifica se contém "transparent" explicitamente
  if (value.toLowerCase().includes("transparent")) {
    return { isTransparent: true, opacity: 0 };
  }

  // Se não é transparente, é 100% sólida
  return { isTransparent: false, opacity: 100 };
}

function getComputedRGBValue(cssValue: string): string {
  if (typeof window === "undefined" || !cssValue) return "";

  // Cria um elemento temporário para calcular o valor RGB
  const tempDiv = document.createElement("div");
  tempDiv.style.color = cssValue;
  tempDiv.style.position = "absolute";
  tempDiv.style.visibility = "hidden";
  document.body.appendChild(tempDiv);

  const computedColor = getComputedStyle(tempDiv).color;
  document.body.removeChild(tempDiv);

  return computedColor;
}

function extractBaseName(name: string): { baseName: string; variation?: string } {
  // Remove sufixos comuns de variação
  const parts = name.split("-");
  
  // Se termina com "foreground", "hover", ou números
  if (parts.length > 1) {
    const lastPart = parts[parts.length - 1];
    
    // Se é um número ou "hover", "foreground"
    if (/^\d+$/.test(lastPart) || lastPart === "hover" || lastPart === "foreground") {
      const baseName = parts.slice(0, -1).join("-");
      return { baseName, variation: lastPart };
    }
  }
  
  // Caso contrário, o nome é a base
  return { baseName: name };
}

export default function CoresPage() {
  const [colors, setColors] = useState<ColorInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Lista completa de todas as cores do design system
    const colorDefinitions: Omit<ColorInfo, "computedValue" | "isTransparent" | "opacity" | "baseName" | "variation">[] = [
      // === BASE ===
      { name: "background", value: "var(--background)", category: "Base" },
      { name: "background-50", value: "color-mix(in oklab, var(--background) 50%, transparent)", category: "Base" },
      { name: "background-60", value: "color-mix(in oklab, var(--background) 60%, transparent)", category: "Base" },
      { name: "background-70", value: "color-mix(in oklab, var(--background) 70%, transparent)", category: "Base" },
      { name: "background-80", value: "color-mix(in oklab, var(--background) 80%, transparent)", category: "Base" },
      { name: "background-90", value: "color-mix(in oklab, var(--background) 90%, transparent)", category: "Base" },
      { name: "foreground", value: "var(--foreground)", category: "Base" },

      // === COMPONENTES ===
      { name: "card", value: "var(--card)", category: "Componentes" },
      { name: "card-hover", value: "color-mix(in oklab, var(--card) 85%, var(--accent) 15%)", category: "Componentes" },
      { name: "card-foreground", value: "var(--card-foreground)", category: "Componentes" },
      { name: "popover", value: "var(--popover)", category: "Componentes" },
      { name: "popover-hover", value: "color-mix(in oklab, var(--popover) 85%, var(--accent) 15%)", category: "Componentes" },
      { name: "popover-foreground", value: "var(--popover-foreground)", category: "Componentes" },

      // === PRIMÁRIAS ===
      { name: "primary", value: "var(--primary)", category: "Primária" },
      { name: "primary-5", value: "color-mix(in oklab, var(--primary) 5%, transparent)", category: "Primária" },
      { name: "primary-10", value: "color-mix(in oklab, var(--primary) 10%, transparent)", category: "Primária" },
      { name: "primary-20", value: "color-mix(in oklab, var(--primary) 20%, transparent)", category: "Primária" },
      { name: "primary-30", value: "color-mix(in oklab, var(--primary) 30%, transparent)", category: "Primária" },
      { name: "primary-50", value: "color-mix(in oklab, var(--primary) 50%, transparent)", category: "Primária" },
      { name: "primary-60", value: "color-mix(in oklab, var(--primary) 60%, transparent)", category: "Primária" },
      { name: "primary-70", value: "color-mix(in oklab, var(--primary) 70%, transparent)", category: "Primária" },
      { name: "primary-80", value: "color-mix(in oklab, var(--primary) 80%, transparent)", category: "Primária" },
      { name: "primary-90", value: "color-mix(in oklab, var(--primary) 90%, transparent)", category: "Primária" },
      { name: "primary-hover", value: "color-mix(in oklab, var(--primary) 90%, oklch(1 0 0) 10%)", category: "Primária" },
      { name: "primary-foreground", value: "var(--primary-foreground)", category: "Primária" },

      // === SECUNDÁRIAS ===
      { name: "secondary", value: "var(--secondary)", category: "Secundária" },
      { name: "secondary-10", value: "color-mix(in oklab, var(--secondary) 10%, transparent)", category: "Secundária" },
      { name: "secondary-20", value: "color-mix(in oklab, var(--secondary) 20%, transparent)", category: "Secundária" },
      { name: "secondary-30", value: "color-mix(in oklab, var(--secondary) 30%, transparent)", category: "Secundária" },
      { name: "secondary-50", value: "color-mix(in oklab, var(--secondary) 50%, transparent)", category: "Secundária" },
      { name: "secondary-80", value: "color-mix(in oklab, var(--secondary) 80%, transparent)", category: "Secundária" },
      { name: "secondary-90", value: "color-mix(in oklab, var(--secondary) 90%, transparent)", category: "Secundária" },
      { name: "secondary-hover", value: "color-mix(in oklab, var(--secondary) 85%, var(--accent) 15%)", category: "Secundária" },
      { name: "secondary-foreground", value: "var(--secondary-foreground)", category: "Secundária" },

      // === ESTADOS ===
      { name: "muted", value: "var(--muted)", category: "Estados" },
      { name: "muted-10", value: "color-mix(in oklab, var(--muted) 10%, transparent)", category: "Estados" },
      { name: "muted-20", value: "color-mix(in oklab, var(--muted) 20%, transparent)", category: "Estados" },
      { name: "muted-30", value: "color-mix(in oklab, var(--muted) 30%, transparent)", category: "Estados" },
      { name: "muted-40", value: "color-mix(in oklab, var(--muted) 40%, transparent)", category: "Estados" },
      { name: "muted-50", value: "color-mix(in oklab, var(--muted) 50%, transparent)", category: "Estados" },
      { name: "muted-60", value: "color-mix(in oklab, var(--muted) 60%, transparent)", category: "Estados" },
      { name: "muted-70", value: "color-mix(in oklab, var(--muted) 70%, transparent)", category: "Estados" },
      { name: "muted-80", value: "color-mix(in oklab, var(--muted) 80%, transparent)", category: "Estados" },
      { name: "muted-90", value: "color-mix(in oklab, var(--muted) 90%, transparent)", category: "Estados" },
      { name: "muted-hover", value: "color-mix(in oklab, var(--muted) 85%, var(--accent) 15%)", category: "Estados" },
      { name: "muted-foreground", value: "var(--muted-foreground)", category: "Estados" },

      { name: "accent", value: "var(--accent)", category: "Estados" },
      { name: "accent-10", value: "color-mix(in oklab, var(--accent) 10%, transparent)", category: "Estados" },
      { name: "accent-20", value: "color-mix(in oklab, var(--accent) 20%, transparent)", category: "Estados" },
      { name: "accent-30", value: "color-mix(in oklab, var(--accent) 30%, transparent)", category: "Estados" },
      { name: "accent-50", value: "color-mix(in oklab, var(--accent) 50%, transparent)", category: "Estados" },
      { name: "accent-80", value: "color-mix(in oklab, var(--accent) 80%, transparent)", category: "Estados" },
      { name: "accent-90", value: "color-mix(in oklab, var(--accent) 90%, transparent)", category: "Estados" },
      { name: "accent-hover", value: "color-mix(in oklab, var(--card) 80%, var(--accent) 20%)", category: "Estados" },
      { name: "accent-foreground", value: "var(--accent-foreground)", category: "Estados" },

      // === FEEDBACK ===
      { name: "destructive", value: "var(--destructive)", category: "Feedback" },
      { name: "destructive-5", value: "color-mix(in oklab, var(--destructive) 5%, transparent)", category: "Feedback" },
      { name: "destructive-10", value: "color-mix(in oklab, var(--destructive) 10%, transparent)", category: "Feedback" },
      { name: "destructive-20", value: "color-mix(in oklab, var(--destructive) 20%, transparent)", category: "Feedback" },
      { name: "destructive-40", value: "color-mix(in oklab, var(--destructive) 40%, transparent)", category: "Feedback" },
      { name: "destructive-50", value: "color-mix(in oklab, var(--destructive) 50%, transparent)", category: "Feedback" },
      { name: "destructive-80", value: "color-mix(in oklab, var(--destructive) 80%, transparent)", category: "Feedback" },
      { name: "destructive-90", value: "color-mix(in oklab, var(--destructive) 90%, transparent)", category: "Feedback" },
      { name: "destructive-hover", value: "color-mix(in oklab, var(--destructive) 90%, oklch(1 0 0) 10%)", category: "Feedback" },
      { name: "destructive-foreground", value: "var(--destructive-foreground)", category: "Feedback" },

      { name: "success", value: "var(--success)", category: "Feedback" },
      { name: "success-20", value: "color-mix(in oklab, var(--success) 20%, transparent)", category: "Feedback" },
      { name: "success-40", value: "color-mix(in oklab, var(--success) 40%, transparent)", category: "Feedback" },
      { name: "success-50", value: "color-mix(in oklab, var(--success) 50%, transparent)", category: "Feedback" },
      { name: "success-80", value: "color-mix(in oklab, var(--success) 80%, transparent)", category: "Feedback" },
      { name: "success-90", value: "color-mix(in oklab, var(--success) 90%, transparent)", category: "Feedback" },
      { name: "success-foreground", value: "var(--success-foreground)", category: "Feedback" },

      { name: "warning", value: "var(--warning)", category: "Feedback" },
      { name: "warning-20", value: "color-mix(in oklab, var(--warning) 20%, transparent)", category: "Feedback" },
      { name: "warning-40", value: "color-mix(in oklab, var(--warning) 40%, transparent)", category: "Feedback" },
      { name: "warning-50", value: "color-mix(in oklab, var(--warning) 50%, transparent)", category: "Feedback" },
      { name: "warning-70", value: "color-mix(in oklab, var(--warning) 70%, transparent)", category: "Feedback" },
      { name: "warning-80", value: "color-mix(in oklab, var(--warning) 80%, transparent)", category: "Feedback" },
      { name: "warning-90", value: "color-mix(in oklab, var(--warning) 90%, transparent)", category: "Feedback" },
      { name: "warning-foreground", value: "var(--warning-foreground)", category: "Feedback" },

      { name: "info", value: "var(--info)", category: "Feedback" },
      { name: "info-20", value: "color-mix(in oklab, var(--info) 20%, transparent)", category: "Feedback" },
      { name: "info-40", value: "color-mix(in oklab, var(--info) 40%, transparent)", category: "Feedback" },
      { name: "info-50", value: "color-mix(in oklab, var(--info) 50%, transparent)", category: "Feedback" },
      { name: "info-80", value: "color-mix(in oklab, var(--info) 80%, transparent)", category: "Feedback" },
      { name: "info-90", value: "color-mix(in oklab, var(--info) 90%, transparent)", category: "Feedback" },
      { name: "info-foreground", value: "var(--info-foreground)", category: "Feedback" },

      { name: "danger", value: "var(--danger)", category: "Feedback" },
      { name: "danger-10", value: "color-mix(in oklab, var(--danger) 10%, transparent)", category: "Feedback" },
      { name: "danger-20", value: "color-mix(in oklab, var(--danger) 20%, transparent)", category: "Feedback" },
      { name: "danger-40", value: "color-mix(in oklab, var(--danger) 40%, transparent)", category: "Feedback" },
      { name: "danger-50", value: "color-mix(in oklab, var(--danger) 50%, transparent)", category: "Feedback" },
      { name: "danger-70", value: "color-mix(in oklab, var(--danger) 70%, transparent)", category: "Feedback" },
      { name: "danger-80", value: "color-mix(in oklab, var(--danger) 80%, transparent)", category: "Feedback" },
      { name: "danger-90", value: "color-mix(in oklab, var(--danger) 90%, transparent)", category: "Feedback" },
      { name: "danger-foreground", value: "var(--danger-foreground)", category: "Feedback" },

      // === FORMULÁRIOS ===
      { name: "input", value: "var(--input)", category: "Formulários" },
      { name: "input-10", value: "color-mix(in oklab, var(--input) 10%, transparent)", category: "Formulários" },
      { name: "input-20", value: "color-mix(in oklab, var(--input) 20%, transparent)", category: "Formulários" },
      { name: "input-30", value: "color-mix(in oklab, var(--input) 30%, transparent)", category: "Formulários" },
      { name: "input-50", value: "color-mix(in oklab, var(--input) 50%, transparent)", category: "Formulários" },
      { name: "input-80", value: "color-mix(in oklab, var(--input) 80%, transparent)", category: "Formulários" },
      { name: "input-foreground", value: "var(--input-foreground)", category: "Formulários" },
      { name: "border", value: "var(--border)", category: "Formulários" },
      { name: "ring", value: "var(--ring)", category: "Formulários" },

      // === COMPONENTES ESPECÍFICOS ===
      { name: "sidebar", value: "var(--sidebar)", category: "Sidebar" },
      { name: "sidebar-foreground", value: "rgba(var(--sidebar-foreground-rgb) / 1)", category: "Sidebar" },
      { name: "sidebar-primary", value: "var(--sidebar-primary)", category: "Sidebar" },
      { name: "sidebar-primary-foreground", value: "var(--sidebar-primary-foreground)", category: "Sidebar" },

      // === SUPERFÍCIES ===
      { name: "surface", value: "var(--surface)", category: "Superfícies" },
      { name: "surface-2", value: "var(--surface-2)", category: "Superfícies" },
      { name: "surface3", value: "#33373C", category: "Superfícies" },

      // === TEXTO ===
      { name: "text", value: "rgb(var(--text-rgb) / 1)", category: "Texto" },

      // === GRÁFICOS ===
      { name: "chart-1", value: "var(--chart-1)", category: "Gráficos" },
      { name: "chart-2", value: "var(--chart-2)", category: "Gráficos" },
      { name: "chart-3", value: "var(--chart-3)", category: "Gráficos" },
      { name: "chart-4", value: "var(--chart-4)", category: "Gráficos" },
      { name: "chart-5", value: "var(--chart-5)", category: "Gráficos" },

      // === BRAND ===
      { name: "brand", value: "var(--primary)", category: "Brand" },
      { name: "brand-20", value: "color-mix(in oklab, var(--primary) 20%, transparent)", category: "Brand" },
      { name: "brand-50", value: "color-mix(in oklab, var(--primary) 50%, transparent)", category: "Brand" },
      { name: "brand-60", value: "color-mix(in oklab, var(--primary) 60%, transparent)", category: "Brand" },
      { name: "brand-70", value: "color-mix(in oklab, var(--primary) 70%, transparent)", category: "Brand" },
      { name: "brand-100", value: "color-mix(in oklab, var(--primary) 60%, transparent)", category: "Brand" },
      { name: "brand-200", value: "color-mix(in oklab, var(--primary) 70%, transparent)", category: "Brand" },
      { name: "brand-300", value: "color-mix(in oklab, var(--primary) 80%, transparent)", category: "Brand" },
      { name: "brand-400", value: "color-mix(in oklab, var(--primary) 90%, transparent)", category: "Brand" },
      { name: "brand-500", value: "var(--primary)", category: "Brand" },
      { name: "brand-600", value: "#256D2A", category: "Brand" },
      { name: "brand-700", value: "#1F5A23", category: "Brand" },
    ];

    // Processa cada cor
    const processedColors: ColorInfo[] = colorDefinitions.map((def) => {
      // Calcula o valor computado
      let computedValue = "";
      try {
        // Para valores que usam var(), precisamos calcular
        if (def.value.startsWith("var(")) {
          const varName = def.value.match(/var\(([^)]+)\)/)?.[1];
          if (varName) {
            computedValue = getComputedColorValue(varName.trim());
          }
        } else if (def.value.startsWith("rgb(") || def.value.startsWith("rgba(")) {
          computedValue = getComputedRGBValue(def.value);
        } else if (def.value.startsWith("#")) {
          computedValue = def.value;
        } else if (def.value.includes("color-mix")) {
          // Para color-mix, cria um elemento temporário para calcular o valor final
          const tempDiv = document.createElement("div");
          tempDiv.style.backgroundColor = def.value;
          tempDiv.style.position = "absolute";
          tempDiv.style.visibility = "hidden";
          document.body.appendChild(tempDiv);
          computedValue = getComputedStyle(tempDiv).backgroundColor;
          document.body.removeChild(tempDiv);
        } else {
          // Para outros valores, tenta calcular
          computedValue = getComputedRGBValue(def.value);
        }
      } catch (e) {
        computedValue = def.value;
      }

      // Analisa opacidade (sempre retorna porcentagem, mesmo para sólidas)
      const opacityInfo = parseOpacity(def.value);
      
      // Extrai nome base e variação
      const { baseName, variation } = extractBaseName(def.name);
      
      return {
        ...def,
        computedValue: computedValue || def.value,
        ...opacityInfo,
        baseName,
        variation: variation || "default",
      };
    });

    setColors(processedColors);
    setIsLoading(false);
  }, []);

  // Agrupa cores por categoria e depois por baseName
  const colorsByCategoryAndBase = colors.reduce((acc, color) => {
    if (!acc[color.category]) {
      acc[color.category] = {};
    }
    if (!acc[color.category][color.baseName]) {
      acc[color.category][color.baseName] = [];
    }
    acc[color.category][color.baseName].push(color);
    return acc;
  }, {} as Record<string, Record<string, ColorInfo[]>>);

  // Verifica se está em modo development
  if (!env.IS_DEV) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Acesso Restrito</CardTitle>
            <CardDescription>Esta página está disponível apenas no modo Development.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="text-center">Carregando cores...</div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <IconPalette className="h-8 w-8 text-primary" />
          <h1 className="text-4xl font-bold">Cores do Design System</h1>
        </div>
        <p className="text-muted-foreground">Visualização completa de todas as cores disponíveis no sistema</p>
      </div>

      {Object.entries(colorsByCategoryAndBase).map(([category, colorsByBase]) => (
        <Card key={category}>
          <CardHeader>
            <CardTitle>{category}</CardTitle>
            <CardDescription>
              {Object.keys(colorsByBase).length} {Object.keys(colorsByBase).length === 1 ? "cor base" : "cores base"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {Object.entries(colorsByBase).map(([baseName, variations]) => {
                // Ordena variações: default primeiro, depois numéricas, depois outras
                const sortedVariations = [...variations].sort((a, b) => {
                  if (a.variation === "default") return -1;
                  if (b.variation === "default") return 1;
                  if (/^\d+$/.test(a.variation || "")) {
                    if (/^\d+$/.test(b.variation || "")) {
                      return parseInt(a.variation || "0") - parseInt(b.variation || "0");
                    }
                    return -1;
                  }
                  if (/^\d+$/.test(b.variation || "")) return 1;
                  return (a.variation || "").localeCompare(b.variation || "");
                });

                return (
                  <div key={baseName} className="space-y-2">
                    <div className="text-sm font-semibold text-muted-foreground mb-2">{baseName}</div>
                    <div className="flex gap-2 flex-wrap">
                      {sortedVariations.map((color) => {
                        const bgStyle = color.computedValue
                          ? { backgroundColor: color.computedValue }
                          : { backgroundColor: "#e5e7eb" };

                        return (
                          <div
                            key={color.name}
                            className="group relative border rounded-md overflow-hidden bg-card cursor-pointer"
                            title={color.value}
                          >
                            <div className="w-12 h-12 relative">
                              {/* Padrão de fundo para visualizar transparência */}
                              <div
                                className="absolute inset-0"
                                style={{
                                  backgroundImage: "linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)",
                                  backgroundSize: "6px 6px",
                                  backgroundPosition: "0 0, 0 3px, 3px -3px, -3px 0px",
                                }}
                              />
                              {/* Cor aplicada sobre o padrão */}
                              <div className="w-12 h-12 flex items-center justify-center relative z-10" style={bgStyle}>
                                {!color.computedValue && (
                                  <span className="text-[8px] text-muted-foreground">N/A</span>
                                )}
                              </div>
                            </div>
                            <div className="px-1.5 py-1 text-center">
                              <div className="text-[10px] font-medium text-foreground mb-0.5">
                                {color.variation === "default" ? "base" : color.variation}
                              </div>
                              <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
                                {color.opacity ?? 100}%
                              </Badge>
                            </div>
                            {/* Tooltip com valor CSS no hover */}
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-popover border border-border rounded text-xs text-popover-foreground opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-20 shadow-lg">
                              <code className="text-[10px]">{color.value}</code>
                              {color.computedValue && color.computedValue !== color.value && (
                                <div className="mt-1 text-[10px] text-muted-foreground">
                                  <code>{color.computedValue}</code>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
