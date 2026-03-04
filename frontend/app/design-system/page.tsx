"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Modal } from "@/components/common/Modal";
import { LoadingState, ErrorState, EmptyState } from "@/components/common/States";
import ThemeToggle from "@/components/layout/ThemeToggle";
import { env } from "@/lib/config/env";
import { colorTokenDefinitions, colorCategoriesOrder, type ColorTokenDef } from "@/lib/design-system/colorTokens";
import { IconPalette, IconCopy } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";

interface ColorWithComputed extends ColorTokenDef {
  computedValue: string;
}

function getComputedColorValue(value: string): string {
  if (typeof window === "undefined") return "";
  if (value.startsWith("var(")) {
    const varName = value.match(/var\(([^)]+)\)/)?.[1]?.trim();
    if (varName) return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  }
  const temp = document.createElement("div");
  temp.style.backgroundColor = value;
  temp.style.position = "absolute";
  temp.style.visibility = "hidden";
  document.body.appendChild(temp);
  const computed = getComputedStyle(temp).backgroundColor;
  document.body.removeChild(temp);
  return computed;
}

export default function DesignSystemPage() {
  const [colors, setColors] = useState<ColorWithComputed[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [progress, setProgress] = useState(45);

  const computeColors = useCallback(() => {
    setColors(
      colorTokenDefinitions.map((def) => ({
        ...def,
        computedValue: getComputedColorValue(def.value),
      })),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    computeColors();
  }, [computeColors]);

  useEffect(() => {
    const t = setTimeout(() => setCopied(null), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  const copyToken = (name: string, prefix: string) => {
    const token = prefix ? `${prefix}-${name}` : name;
    void navigator.clipboard.writeText(token);
    setCopied(token);
  };

  if (!env.IS_DEV) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Acesso restrito</CardTitle>
            <CardDescription>Esta página está disponível apenas em development.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const byCategory = colorCategoriesOrder.reduce(
    (acc, cat) => {
      acc[cat] = colors.filter((c) => c.category === cat);
      return acc;
    },
    {} as Record<string, ColorWithComputed[]>,
  );

  return (
    <div className="min-h-screen bg-background p-6 pb-12">
      <div className="mx-auto max-w-6xl space-y-10">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <IconPalette className="h-8 w-8 text-primary" />
              <h1 className="text-3xl font-bold tracking-tight">Design System</h1>
            </div>
            <p className="text-muted-foreground">Cores, tokens e componentes de referência (dev).</p>
          </div>
          <ThemeToggle />
        </div>

        {/* Cores */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Paleta de cores</h2>
          {loading ? (
            <div className="text-sm text-muted-foreground">Carregando…</div>
          ) : (
            <div className="space-y-6">
              {colorCategoriesOrder.map((category) => {
                const items = byCategory[category];
                if (!items?.length) return null;
                return (
                  <Card key={category}>
                    <CardHeader className="py-3">
                      <CardTitle className="text-base">{category}</CardTitle>
                      <CardDescription className="text-xs">{items.length} tokens</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex flex-wrap gap-3">
                        {items.map((color) => {
                          const bgStyle = color.computedValue ? { backgroundColor: color.computedValue } : {};
                          return (
                            <div key={color.name} className={cn("group relative rounded-md border border-border overflow-hidden bg-card", "w-24 flex flex-col")}>
                              <div className="relative h-14 w-full">
                                <div
                                  className="absolute inset-0"
                                  style={{
                                    backgroundImage: "linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)",
                                    backgroundSize: "6px 6px",
                                    backgroundPosition: "0 0, 0 3px, 3px -3px, -3px 0px",
                                  }}
                                />
                                <div className="absolute inset-0 z-10" style={bgStyle} />
                              </div>
                              <div className="p-1.5 flex items-center justify-between gap-1">
                                <span className="text-[10px] font-medium text-foreground truncate">{color.name}</span>
                                <button type="button" onClick={() => copyToken(color.name, "bg")} className="shrink-0 p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground" title="Copiar bg-{nome}">
                                  <IconCopy className="h-3 w-3" />
                                </button>
                              </div>
                              {color.computedValue && (
                                <div className="px-1.5 pb-1.5">
                                  <code className="text-[9px] text-muted-foreground block truncate" title={color.computedValue}>
                                    {color.computedValue}
                                  </code>
                                </div>
                              )}
                              {copied === `bg-${color.name}` && <span className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[9px] bg-popover text-popover-foreground px-1.5 py-0.5 rounded shadow border border-border z-20">Copiado</span>}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {/* Tokens utilitários */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Tokens utilitários</h2>
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-base">Radius</CardTitle>
              <CardDescription className="text-xs">rounded-sm, rounded-md, rounded-lg</CardDescription>
            </CardHeader>
            <CardContent className="pt-0 flex flex-wrap gap-4">
              <div className="flex flex-col items-center gap-1">
                <div className="w-16 h-16 rounded-sm bg-muted border border-border" />
                <span className="text-xs text-muted-foreground">sm</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <div className="w-16 h-16 rounded-md bg-muted border border-border" />
                <span className="text-xs text-muted-foreground">md</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                <div className="w-16 h-16 rounded-lg bg-muted border border-border" />
                <span className="text-xs text-muted-foreground">lg</span>
              </div>
            </CardContent>
          </Card>
          <Card className="mt-4">
            <CardHeader className="py-3">
              <CardTitle className="text-base">Overlay</CardTitle>
              <CardDescription className="text-xs">bg-overlay para modais</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="h-12 rounded-md bg-overlay flex items-center justify-center text-primary-foreground text-sm">Exemplo overlay</div>
            </CardContent>
          </Card>
        </section>

        {/* Componentes */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Componentes</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Button</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 flex flex-wrap gap-2">
                <Button variant="default" size="sm">
                  Default
                </Button>
                <Button variant="destructive" size="sm">
                  Destructive
                </Button>
                <Button variant="outline" size="sm">
                  Outline
                </Button>
                <Button variant="secondary" size="sm">
                  Secondary
                </Button>
                <Button variant="ghost" size="sm">
                  Ghost
                </Button>
                <Button variant="success" size="sm">
                  Success
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Badge</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 flex flex-wrap gap-2">
                <Badge variant="default">Default</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="destructive">Destructive</Badge>
                <Badge variant="outline">Outline</Badge>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Input</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <Input placeholder="Placeholder" className="h-9" />
                <Input disabled placeholder="Desabilitado" className="h-9" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Select</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <Select>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="a">Opção A</SelectItem>
                    <SelectItem value="b">Opção B</SelectItem>
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Toggle</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <Toggle size="sm">Toggle</Toggle>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Modal</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <Button size="sm" variant="outline" onClick={() => setModalOpen(true)}>
                  Abrir modal
                </Button>
                <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} size="sm" padding="md">
                  <p className="text-sm text-muted-foreground">Exemplo de modal.</p>
                  <div className="flex justify-end gap-2 mt-4">
                    <Button size="sm" variant="outline" onClick={() => setModalOpen(false)}>
                      Fechar
                    </Button>
                  </div>
                </Modal>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Progress</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <Progress value={progress} />
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setProgress((p) => Math.max(0, p - 10))}>
                    -10
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setProgress((p) => Math.min(100, p + 10))}>
                    +10
                  </Button>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Skeleton</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-3/4" />
                <Skeleton className="h-8 w-1/2" />
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Estados</CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <LoadingState label="Carregando…" />
                <ErrorState message="Erro ao carregar" />
                <EmptyState message="Nenhum item" />
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Doc link */}
        <p className="text-sm text-muted-foreground">
          Documentação: <code className="rounded bg-muted px-1 py-0.5">frontend/docs/DESIGN_SYSTEM.md</code>
        </p>
      </div>
    </div>
  );
}
