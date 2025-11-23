"use client";

import { useState } from "react";
import { OpportunityRow } from "@/lib/utils/opportunity";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { IconX } from "@tabler/icons-react";

interface InsightsModalProps {
  /** Dados da oportunidade */
  row: OpportunityRow;
  /** Se o modal está aberto */
  isOpen: boolean;
  /** Callback para fechar o modal */
  onClose: () => void;
  /** Função para formatar valores monetários */
  formatCurrency: (value: number) => string;
  /** Média de CPR */
  avgCpr: number;
  /** Componente do card a ser renderizado no modal (à esquerda) */
  cardComponent: React.ReactNode;
  /** Tipo de ação/conversão para calcular número de conversões */
  actionType?: string;
}

function formatPct(v: number): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function formatPct2(v: number): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

export function InsightsModal({ row, isOpen, onClose, formatCurrency, avgCpr, cardComponent, actionType }: InsightsModalProps) {
  const impactRelative = row.impact_relative || 0;
  const [activeTab, setActiveTab] = useState<"insights" | "metrics">("insights");

  // Calcular número de conversões a partir de CPR e Spend
  const conversions = row.cpr_actual > 0 && Number.isFinite(row.cpr_actual) ? row.spend / row.cpr_actual : 0;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative flex items-start gap-10">
        {/* Botão fechar */}
        <Button variant="outline" size="icon" className="absolute -top-12 right-0 h-10 w-10 rounded-full shadow-lg bg-background/90 backdrop-blur-sm hover:bg-background" onClick={onClose} aria-label="Fechar">
          <IconX className="h-5 w-5" />
        </Button>

        {/* Card no overlay */}
        {cardComponent}

        {/* Container de informações */}
        <div className="w-[700px] bg-transparent flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            {/* Título */}
            <h1 className="text-2xl font-bold text-foreground">{row.ad_name || row.ad_id || "—"}</h1>

            {/* Impacto */}
            <div className="flex flex-col gap-1">
              <p className="text-sm text-foreground">
                Impacto de <span className="font-semibold">{formatPct(impactRelative)}</span> na campanha
              </p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 border-b border-border text-sm">
            <button className={`px-3 py-2 ${activeTab === "insights" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`} onClick={() => setActiveTab("insights")}>
              Insights
            </button>
            <button className={`px-3 py-2 ${activeTab === "metrics" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`} onClick={() => setActiveTab("metrics")}>
              Métricas
            </button>
          </div>

          {/* Conteúdo das tabs */}
          {activeTab === "insights" && (
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-foreground">Insights acionáveis:</h2>

              <Accordion type="single" collapsible className="w-full">
                {/* Hook */}
                <AccordionItem value="hook">
                  <AccordionTrigger>Hook</AccordionTrigger>
                  <AccordionContent>
                    {/* Conteúdo do Hook será adicionado aqui */}
                    <p className="text-sm text-muted-foreground">Conteúdo do Hook será exibido aqui</p>
                  </AccordionContent>
                </AccordionItem>

                {/* Hold Rate */}
                <AccordionItem value="holdRate">
                  <AccordionTrigger>Hold Rate</AccordionTrigger>
                  <AccordionContent>
                    {/* Conteúdo do Hold Rate será adicionado aqui */}
                    <p className="text-sm text-muted-foreground">Conteúdo do Hold Rate será exibido aqui</p>
                  </AccordionContent>
                </AccordionItem>

                {/* CTR */}
                <AccordionItem value="ctr">
                  <AccordionTrigger>CTR</AccordionTrigger>
                  <AccordionContent>
                    {/* Conteúdo do CTR será adicionado aqui */}
                    <p className="text-sm text-muted-foreground">Conteúdo do CTR será exibido aqui</p>
                  </AccordionContent>
                </AccordionItem>

                {/* Page */}
                <AccordionItem value="page">
                  <AccordionTrigger>Page</AccordionTrigger>
                  <AccordionContent>
                    {/* Conteúdo do Page será adicionado aqui */}
                    <p className="text-sm text-muted-foreground">Conteúdo do Page será exibido aqui</p>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          )}

          {activeTab === "metrics" && (
            <div className="flex flex-col gap-6">
              {/* Linha 1: Resultados */}
              <div className="flex flex-col gap-3">
                <h3 className="text-base font-semibold text-foreground">Resultados</h3>
                <div className="grid grid-cols-4 gap-4">
                  {/* CPR */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">CPR</span>
                    <div className="flex flex-col items-baseline">
                      <span className="text-lg font-semibold text-foreground">{formatCurrency(row.cpr_actual)}</span>
                      <span className="text-[11px] text-muted-foreground">({Math.round(conversions)} conversões)</span>
                    </div>
                  </div>

                  {/* CPMQL */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">CPMQL</span>
                    <div className="flex flex-col items-baseline">
                      <span className="text-lg font-semibold text-foreground">{row.cpmql && row.cpmql > 0 ? formatCurrency(row.cpmql) : "—"}</span>
                      <span className="text-[11px] text-muted-foreground">({row.mql_count ?? 0} MQLs)</span>
                    </div>
                  </div>

                  {/* Spend */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Spend</span>
                    <span className="text-lg font-semibold text-foreground">{formatCurrency(row.spend)}</span>
                  </div>

                  {/* CPM */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">CPM</span>
                    <span className="text-lg font-semibold text-foreground">{formatCurrency(row.cpm)}</span>
                  </div>
                </div>
              </div>

              {/* Linha 2: Funil */}
              <div className="flex flex-col gap-3">
                <h3 className="text-base font-semibold text-foreground">Funil</h3>
                <div className="grid grid-cols-4 gap-4">
                  {/* CTR */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">CTR %</span>
                    <span className="text-lg font-semibold text-foreground">{formatPct2(row.ctr)}</span>
                  </div>

                  {/* Link CTR */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Link CTR %</span>
                    <span className="text-lg font-semibold text-foreground">{formatPct2(row.website_ctr)}</span>
                  </div>

                  {/* Connect Rate */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Connect Rate %</span>
                    <span className="text-lg font-semibold text-foreground">{formatPct(row.connect_rate)}</span>
                  </div>

                  {/* Conversão Página */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Conversão Página %</span>
                    <span className="text-lg font-semibold text-foreground">{formatPct(row.page_conv)}</span>
                  </div>
                </div>
              </div>

              {/* Linha 3: Performance */}
              <div className="flex flex-col gap-3">
                <h3 className="text-base font-semibold text-foreground">Performance</h3>
                <div className="grid grid-cols-4 gap-4">
                  {/* Hook Rate */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Hook Rate %</span>
                    <span className="text-lg font-semibold text-foreground">{formatPct(row.hook)}</span>
                  </div>

                  {/* Hold Rate */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Hold Rate %</span>
                    <span className="text-lg font-semibold text-foreground">{formatPct(row.hold_rate)}</span>
                  </div>

                  {/* 50% View Rate */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">50% View Rate %</span>
                    <span className="text-lg font-semibold text-foreground">{formatPct((row.video_watched_p50 || 0) / 100)}</span>
                  </div>

                  {/* ThruPlays Rate */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">ThruPlays Rate %</span>
                    <span className="text-lg font-semibold text-foreground">{formatPct(row.thruplays_rate || 0)}</span>
                  </div>
                </div>
              </div>

              {/* Linha 4: Extras */}
              <div className="flex flex-col gap-3">
                <h3 className="text-base font-semibold text-foreground">Extras</h3>
                <div className="grid grid-cols-4 gap-4">
                  {/* Leadscore médio */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Leadscore médio</span>
                    <span className="text-lg font-semibold text-foreground">{row.leadscore_avg ? row.leadscore_avg.toFixed(1) : "—"}</span>
                  </div>

                  {/* Frequência */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Frequência</span>
                    <span className="text-lg font-semibold text-foreground">{row.frequency ? row.frequency.toFixed(2) : "—"}</span>
                  </div>

                  {/* Impressões */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Impressões</span>
                    <span className="text-lg font-semibold text-foreground">{row.impressions ? row.impressions.toLocaleString() : "—"}</span>
                  </div>

                  {/* Alcance */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Alcance</span>
                    <span className="text-lg font-semibold text-foreground">{row.reach ? row.reach.toLocaleString() : "—"}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
