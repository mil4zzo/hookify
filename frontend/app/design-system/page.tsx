"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { StandardCard } from "@/components/common/StandardCard";
import { WidgetPanel, WorkspaceState } from "@/components/common/layout";
import { AppDialog } from "@/components/common/AppDialog";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import { StatePanel, InlineNotice, StateSkeleton } from "@/components/common/States";
import ThemeToggle from "@/components/layout/ThemeToggle";
import { PageContainer } from "@/components/common/PageContainer";
import { env } from "@/lib/config/env";
import { colorTokenDefinitions, colorCategoriesOrder, type ColorTokenDef } from "@/lib/design-system/colorTokens";
import { IconPalette, IconCopy, IconInfoCircle, IconAlertTriangle } from "@tabler/icons-react";
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

/** Token a copiar para a área de transferência: classe Tailwind ou variável CSS. */
function tokenSnippet(color: ColorTokenDef): string {
  return color.cssOnly ? `var(--${color.name})` : `bg-${color.name}`;
}

/** Bloco de seção de topo da página. */
function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** Lista de referência textual (token → valor). */
function RefList({ items }: { items: Array<{ token: string; value: string }> }) {
  return (
    <dl className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
      {items.map((it) => (
        <div key={it.token} className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted-20 px-2 py-1">
          <code className="text-xs text-foreground">{it.token}</code>
          <span className="text-xs text-muted-foreground">{it.value}</span>
        </div>
      ))}
    </dl>
  );
}

export default function DesignSystemPage() {
  const [colors, setColors] = useState<ColorWithComputed[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [switchOn, setSwitchOn] = useState(false);
  const [baseSwitch, setBaseSwitch] = useState(true);
  const [checkbox, setCheckbox] = useState(true);
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

  const copyToken = (color: ColorTokenDef) => {
    const snippet = tokenSnippet(color);
    void navigator.clipboard.writeText(snippet);
    setCopied(snippet);
  };

  if (!env.IS_DEV) {
    return (
      <PageContainer variant="standard" title="Design System" description="Cores, tokens e componentes de referência (dev)." icon={<IconPalette className="h-6 w-6 text-attention" />}>
        <div className="flex items-center justify-center py-16">
          <StandardCard className="max-w-md space-y-1">
            <h2 className="font-semibold text-foreground">Acesso restrito</h2>
            <p className="text-sm text-muted-foreground">Esta página está disponível apenas em development.</p>
          </StandardCard>
        </div>
      </PageContainer>
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
    <PageContainer
      variant="standard"
      title="Design System"
      description="Cores, tokens e componentes de referência (dev)."
      icon={<IconPalette className="h-6 w-6 text-attention" />}
      actions={<ThemeToggle />}
    >
      <div className="space-y-stack">
        <InlineNotice tone="info" title="Referência interna (dev)">
          Tokens vivem em <code className="rounded bg-muted px-1 py-0.5">lib/design-system/themeDefinitions.ts</code> (gerados em <code className="rounded bg-muted px-1 py-0.5">app/theme-generated.css</code>) e mapeados em{" "}
          <code className="rounded bg-muted px-1 py-0.5">tailwind.config.ts</code>. Guia completo em <code className="rounded bg-muted px-1 py-0.5">frontend/docs/DESIGN_SYSTEM.md</code>.
        </InlineNotice>

        {/* ===================== PALETA DE CORES ===================== */}
        <Section title="Paleta de cores" description="Clique no ícone para copiar a classe Tailwind (ou a variável CSS, quando o token só existe como var).">
          {loading ? (
            <StateSkeleton variant="widget" rows={6} />
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {colorCategoriesOrder.map((category) => {
                const items = byCategory[category];
                if (!items?.length) return null;
                return (
                  <WidgetPanel key={category} title={category} description={`${items.length} tokens`} density="compact">
                    <div className="flex flex-wrap gap-3">
                      {items.map((color) => {
                        const bgStyle = color.computedValue ? { backgroundColor: color.computedValue } : {};
                        const snippet = tokenSnippet(color);
                        return (
                          <div key={color.name} className="group relative flex w-24 flex-col overflow-hidden rounded-md border border-border bg-card">
                            <div className="relative h-14 w-full">
                              <div
                                className="absolute inset-0"
                                style={{
                                  backgroundImage:
                                    "linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)",
                                  backgroundSize: "6px 6px",
                                  backgroundPosition: "0 0, 0 3px, 3px -3px, -3px 0px",
                                }}
                              />
                              <div className="absolute inset-0 z-10" style={bgStyle} />
                            </div>
                            <div className="flex items-center justify-between gap-1 p-1.5">
                              <span className="truncate text-[10px] font-medium text-foreground">{color.name}</span>
                              <button type="button" onClick={() => copyToken(color)} className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground" title={`Copiar ${snippet}`} aria-label={`Copiar ${snippet}`}>
                                <IconCopy className="h-3 w-3" />
                              </button>
                            </div>
                            {color.computedValue && (
                              <div className="px-1.5 pb-1.5">
                                <code className="block truncate text-[9px] text-muted-foreground" title={color.computedValue}>
                                  {color.computedValue}
                                </code>
                              </div>
                            )}
                            {copied === snippet && <span className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 rounded border border-border bg-popover px-1.5 py-0.5 text-[9px] text-popover-foreground shadow">Copiado</span>}
                          </div>
                        );
                      })}
                    </div>
                  </WidgetPanel>
                );
              })}
            </div>
          )}
        </Section>

        {/* ===================== TOKENS UTILITÁRIOS ===================== */}
        <Section title="Tokens utilitários" description="Raio, elevação, densidade, espaçamento e camadas. Use os nomes em vez de valores soltos.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <WidgetPanel title="Radius" description="rounded-sm · md · lg" density="compact">
              <div className="flex flex-wrap gap-4">
                {(["sm", "md", "lg"] as const).map((r) => (
                  <div key={r} className="flex flex-col items-center gap-1">
                    <div className={cn("h-16 w-16 border border-border bg-muted", r === "sm" && "rounded-sm", r === "md" && "rounded-md", r === "lg" && "rounded-lg")} />
                    <span className="text-xs text-muted-foreground">{r}</span>
                  </div>
                ))}
              </div>
            </WidgetPanel>

            <WidgetPanel title="Elevação" description="shadow-elevation-*" density="compact">
              <div className="flex flex-wrap gap-4">
                {(["flat", "raised", "overlay"] as const).map((e) => (
                  <div key={e} className="flex flex-col items-center gap-1">
                    <div className={cn("h-16 w-16 rounded-md border border-border bg-card", e === "flat" && "shadow-elevation-flat", e === "raised" && "shadow-elevation-raised", e === "overlay" && "shadow-elevation-overlay")} />
                    <span className="text-xs text-muted-foreground">{e}</span>
                  </div>
                ))}
              </div>
            </WidgetPanel>

            <WidgetPanel title="Overlay" description="bg-overlay para modais" density="compact">
              <div className="flex h-16 items-center justify-center rounded-md bg-overlay text-sm text-primary-foreground">Exemplo overlay</div>
            </WidgetPanel>

            <WidgetPanel title="Altura de controle" description="h-control-*" density="compact">
              <div className="space-y-2">
                {([["compact", "h-control-compact", "2rem"], ["default", "h-control-default", "2.5rem"], ["large", "h-control-large", "3rem"]] as const).map(([label, cls, val]) => (
                  <div key={label} className="flex items-center gap-2">
                    <div className={cn("w-28 rounded-md bg-primary-20", cls)} />
                    <span className="text-xs text-muted-foreground">{label} · {val}</span>
                  </div>
                ))}
              </div>
            </WidgetPanel>

            <WidgetPanel title="Altura de linha" description="h-row-*" density="compact">
              <div className="space-y-2">
                {([["compact", "h-row-compact", "2.5rem"], ["default", "h-row-default", "3.5rem"], ["detailed", "h-row-detailed", "7.5rem"]] as const).map(([label, cls, val]) => (
                  <div key={label} className="flex items-center gap-2">
                    <div className={cn("w-28 rounded-md border border-border bg-muted", cls)} />
                    <span className="text-xs text-muted-foreground">{label} · {val}</span>
                  </div>
                ))}
              </div>
            </WidgetPanel>

            <WidgetPanel title="Padding de widget" description="p-widget-*" density="compact">
              <div className="flex flex-wrap gap-3">
                {(["compact", "default", "spacious"] as const).map((d) => (
                  <div key={d} className="flex flex-col items-center gap-1">
                    <div className={cn("rounded-md border border-dashed border-primary-40 bg-primary-10", d === "compact" && "p-widget-compact", d === "default" && "p-widget-default", d === "spacious" && "p-widget-spacious")}>
                      <div className="h-8 w-8 rounded bg-primary-40" />
                    </div>
                    <span className="text-xs text-muted-foreground">{d}</span>
                  </div>
                ))}
              </div>
            </WidgetPanel>

            <WidgetPanel title="Espaçamento" description="gap-* / space-y-*" density="compact">
              <RefList
                items={[
                  { token: "stack-compact", value: "0.75rem" },
                  { token: "stack", value: "1.5rem" },
                  { token: "stack-spacious", value: "2rem" },
                  { token: "grid-compact", value: "0.75rem" },
                  { token: "grid", value: "1rem" },
                  { token: "grid-spacious", value: "1.5rem" },
                  { token: "workspace", value: "1.5rem" },
                ]}
              />
            </WidgetPanel>

            <WidgetPanel title="Z-index" description="camadas nomeadas" density="compact">
              <RefList
                items={[
                  { token: "z-sticky", value: "40" },
                  { token: "z-overlay", value: "50" },
                  { token: "z-modal", value: "60" },
                  { token: "z-dropdown", value: "70" },
                  { token: "z-toast", value: "80" },
                ]}
              />
            </WidgetPanel>
          </div>
        </Section>

        {/* ===================== PRIMITIVOS DO APP ===================== */}
        <Section title="Primitivos do app" description="Preferidos em telas autenticadas — usar antes dos componentes base crus.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <WidgetPanel title="StandardCard" description="variant · density · elevation" density="compact">
              <div className="grid grid-cols-2 gap-3">
                <StandardCard variant="default" elevation="raised" density="compact" className="text-xs text-muted-foreground">default · raised</StandardCard>
                <StandardCard variant="muted" density="compact" className="text-xs text-muted-foreground">muted</StandardCard>
              </div>
            </WidgetPanel>

            <WidgetPanel title="WidgetPanel" description="card com título + ações" density="compact">
              <WidgetPanel title="Resumo" description="Subtítulo" density="compact" actions={<Button size="sm" variant="outline">Ação</Button>}>
                <p className="text-sm text-muted-foreground">Corpo do widget.</p>
              </WidgetPanel>
            </WidgetPanel>

            <WidgetPanel title="AppDialog" description="dialog acessível (substitui Modal)" density="compact">
              <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
                Abrir dialog
              </Button>
              <AppDialog isOpen={dialogOpen} onClose={() => setDialogOpen(false)} size="sm" padding="md" title="Exemplo">
                <h3 className="text-base font-semibold text-foreground">Título do dialog</h3>
                <p className="mt-1 text-sm text-muted-foreground">Conteúdo de exemplo via AppDialog.</p>
                <div className="mt-4 flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setDialogOpen(false)}>
                    Fechar
                  </Button>
                </div>
              </AppDialog>
            </WidgetPanel>

            <WidgetPanel title="ToggleSwitch" description="switch com label (substitui Switch cru)" density="compact">
              <ToggleSwitch id="ds-toggle" checked={switchOn} onCheckedChange={setSwitchOn} label="Agrupar por packs" variant="minimal" />
            </WidgetPanel>

            <WidgetPanel title="StatePanel" description="estados de painel" density="compact">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <StatePanel kind="empty" title="Sem resultados" message="Ajuste os filtros." framed={false} align="left" />
                <StatePanel kind="error" title="Erro" message="Não foi possível carregar." framed={false} align="left" />
                <StatePanel kind="loading" message="Carregando…" framed={false} align="left" />
                <StatePanel kind="info" title="Dica" message="Texto informativo." framed={false} align="left" />
              </div>
            </WidgetPanel>

            <WidgetPanel title="InlineNotice" description="aviso inline em fluxo" density="compact">
              <div className="space-y-2">
                <InlineNotice tone="info">Mensagem informativa.</InlineNotice>
                <InlineNotice tone="warning">Revise antes de continuar.</InlineNotice>
                <InlineNotice tone="success">Tudo certo.</InlineNotice>
                <InlineNotice tone="destructive">Algo deu errado.</InlineNotice>
              </div>
            </WidgetPanel>

            <WidgetPanel title="WorkspaceState" description="empty / error de corpo" density="compact">
              <div className="space-y-3">
                <WorkspaceState kind="empty" title="Nada por aqui" message="Sem dados para o filtro atual." framed={false} />
                <WorkspaceState kind="error" framed={false} />
              </div>
            </WidgetPanel>

            <WidgetPanel title="StateSkeleton" description="loading estrutural" density="compact">
              <div className="space-y-3">
                <StateSkeleton variant="widget" rows={2} />
                <StateSkeleton variant="table" rows={2} />
              </div>
            </WidgetPanel>
          </div>
        </Section>

        {/* ===================== COMPONENTES BASE ===================== */}
        <Section title="Componentes base (shadcn)" description="Primitivas de UI usadas dentro dos primitivos do app.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <WidgetPanel title="Button" density="compact">
              <div className="flex flex-wrap gap-2">
                <Button variant="default" size="sm">Default</Button>
                <Button variant="destructive" size="sm">Destructive</Button>
                <Button variant="outline" size="sm">Outline</Button>
                <Button variant="secondary" size="sm">Secondary</Button>
                <Button variant="ghost" size="sm">Ghost</Button>
                <Button variant="success" size="sm">Success</Button>
              </div>
            </WidgetPanel>

            <WidgetPanel title="Badge" density="compact">
              <div className="flex flex-wrap gap-2">
                <Badge variant="default">Default</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="destructive">Destructive</Badge>
                <Badge variant="success">Success</Badge>
                <Badge variant="outline">Outline</Badge>
              </div>
            </WidgetPanel>

            <WidgetPanel title="Input" density="compact">
              <div className="space-y-2">
                <Input placeholder="Placeholder" className="h-9" />
                <Input disabled placeholder="Desabilitado" className="h-9" />
              </div>
            </WidgetPanel>

            <WidgetPanel title="Select" density="compact">
              <Select>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="a">Opção A</SelectItem>
                  <SelectItem value="b">Opção B</SelectItem>
                </SelectContent>
              </Select>
            </WidgetPanel>

            <WidgetPanel title="Switch & Checkbox" density="compact">
              <div className="flex items-center gap-6">
                <Switch checked={baseSwitch} onCheckedChange={setBaseSwitch} aria-label="Switch base" />
                <label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox checked={checkbox} onCheckedChange={(v) => setCheckbox(v === true)} />
                  Checkbox
                </label>
              </div>
            </WidgetPanel>

            <WidgetPanel title="Toggle" density="compact">
              <Toggle size="sm">Toggle</Toggle>
            </WidgetPanel>

            <WidgetPanel title="Progress" density="compact">
              <div className="space-y-2">
                <Progress value={progress} />
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setProgress((p) => Math.max(0, p - 10))}>-10</Button>
                  <Button size="sm" variant="outline" onClick={() => setProgress((p) => Math.min(100, p + 10))}>+10</Button>
                </div>
              </div>
            </WidgetPanel>

            <WidgetPanel title="Tabs" density="compact">
              <Tabs defaultValue="a">
                <TabsList>
                  <TabsTrigger value="a">Aba A</TabsTrigger>
                  <TabsTrigger value="b">Aba B</TabsTrigger>
                </TabsList>
                <TabsContent value="a" className="pt-2 text-sm text-muted-foreground">Conteúdo A</TabsContent>
                <TabsContent value="b" className="pt-2 text-sm text-muted-foreground">Conteúdo B</TabsContent>
              </Tabs>
            </WidgetPanel>

            <WidgetPanel title="Tooltip" density="compact">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button size="sm" variant="outline">Passe o mouse</Button>
                  </TooltipTrigger>
                  <TooltipContent>Dica contextual</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </WidgetPanel>

            <WidgetPanel title="Alert" density="compact">
              <div className="space-y-2">
                <Alert>
                  <IconInfoCircle className="h-4 w-4" />
                  <AlertTitle>Informação</AlertTitle>
                  <AlertDescription>Mensagem de alerta padrão.</AlertDescription>
                </Alert>
                <Alert variant="destructive">
                  <IconAlertTriangle className="h-4 w-4" />
                  <AlertTitle>Erro</AlertTitle>
                  <AlertDescription>Algo precisa de atenção.</AlertDescription>
                </Alert>
              </div>
            </WidgetPanel>

            <WidgetPanel title="Skeleton" density="compact">
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-3/4" />
                <Skeleton className="h-8 w-1/2" />
              </div>
            </WidgetPanel>
          </div>
        </Section>

        <p className="text-sm text-muted-foreground">
          Documentação: <code className="rounded bg-muted px-1 py-0.5">frontend/docs/DESIGN_SYSTEM.md</code>
        </p>
      </div>
    </PageContainer>
  );
}
