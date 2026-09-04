"use client";

/**
 * Aba "Pesquisa" do detalhe (migration 140): o que os leads deste anúncio/criativo
 * responderam nas colunas vinculadas da planilha.
 *
 * Por coluna: número e leadscore mostram n, média, mínimo, máximo e mediana (leadscore
 * também o corte, MQLs, % MQL e CPMQL, com as MESMAS funções do leadscore V1); categoria
 * mostra a distribuição em barras. Tudo sai do histograma que a RPC devolve — nenhuma
 * média pronta do servidor.
 */
import { useMemo } from "react";
import { StatePanel } from "@/components/common/States";
import { useFormatCurrency } from "@/lib/utils/currency";
import type { SheetColumnMapping } from "@/lib/api/schemas";
import { computeLeadscoreFacets, histogramEntries, histogramStats, type CustomHistograms } from "@/lib/utils/customHistogram";

interface SurveyPanelProps {
  /** `{ [mappingId]: { [valor]: quantidade } }` da entidade no período. */
  histograms: CustomHistograms | null | undefined;
  /** Vínculos dos packs selecionados (dá nome, tipo e corte a cada histograma). */
  mappings: ReadonlyArray<SheetColumnMapping>;
  /** Gasto no período — para o CPMQL das colunas leadscore. */
  spend?: number | null;
  isLoading?: boolean;
  /** Nome do que está sendo detalhado, para o estado vazio. */
  subjectLabel?: string;
}

const fmtNumber = (value: number | null | undefined, digits = 1): string =>
  value == null || !Number.isFinite(value) ? "—" : value.toLocaleString("pt-BR", { maximumFractionDigits: digits });

const fmtPct = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? "—" : `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function NumericCard({ mapping, hist, spend }: { mapping: SheetColumnMapping; hist: Record<string, number> | undefined; spend: number }) {
  const formatCurrency = useFormatCurrency();
  const stats = useMemo(() => histogramStats(hist), [hist]);
  const isLeadscore = mapping.kind === "leadscore";
  const facets = useMemo(
    () => (isLeadscore ? computeLeadscoreFacets(hist, spend, mapping.config?.mql_min ?? null) : null),
    [isLeadscore, hist, spend, mapping.config?.mql_min],
  );
  const entries = useMemo(() => histogramEntries(hist, true), [hist]);
  const maxQty = entries.reduce((acc, [, qty]) => Math.max(acc, qty), 0);

  return (
    <section className="rounded-md border border-border bg-muted-30 p-4 space-y-3">
      <header className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">{mapping.label}</h4>
        <span className="text-2xs text-muted-foreground">{isLeadscore ? "leadscore" : "número"} · {fmtNumber(stats?.n ?? 0, 0)} leads</span>
      </header>
      {!stats ? (
        <p className="text-sm text-muted-foreground">Sem valores neste período.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Média" value={fmtNumber(stats.avg)} />
            <Stat label="Mediana" value={fmtNumber(stats.median)} />
            <Stat label="Mínimo" value={fmtNumber(stats.min)} />
            <Stat label="Máximo" value={fmtNumber(stats.max)} />
          </div>
          {isLeadscore && facets && (
            <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
              <Stat label="Corte de MQL" value={mapping.config?.mql_min == null ? "não definido" : fmtNumber(mapping.config.mql_min)} />
              <Stat label="MQLs" value={facets.mqls == null ? "—" : fmtNumber(facets.mqls, 0)} />
              <Stat label="% MQL" value={fmtPct(facets.mql_rate)} />
              <Stat label="CPMQL" value={facets.cpmql == null ? "—" : facets.cpmql > 0 ? formatCurrency(facets.cpmql) : "—"} />
            </div>
          )}
          {/* Distribuição compacta: uma barra por valor, altura proporcional */}
          {entries.length > 1 && entries.length <= 60 && (
            <div className="flex h-12 items-end gap-px" aria-label={`Distribuição de ${mapping.label}`}>
              {entries.map(([value, qty]) => (
                <div
                  key={value}
                  className="flex-1 rounded-t-sm bg-primary-40"
                  style={{ height: `${maxQty > 0 ? Math.max(8, (qty / maxQty) * 100) : 0}%` }}
                  title={`${value}: ${qty}`}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function CategoryCard({ mapping, hist }: { mapping: SheetColumnMapping; hist: Record<string, number> | undefined }) {
  const entries = useMemo(() => histogramEntries(hist, false), [hist]);
  const total = entries.reduce((acc, [, qty]) => acc + qty, 0);
  return (
    <section className="rounded-md border border-border bg-muted-30 p-4 space-y-3">
      <header className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">{mapping.label}</h4>
        <span className="text-2xs text-muted-foreground">categoria · {total.toLocaleString("pt-BR")} respostas</span>
      </header>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sem respostas neste período.</p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map(([value, qty]) => {
            const share = total > 0 ? qty / total : 0;
            return (
              <li key={value} className="space-y-0.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium">{value}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {qty.toLocaleString("pt-BR")} · {fmtPct(share)}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary-60" style={{ width: `${Math.max(2, share * 100)}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function SurveyPanel({ histograms, mappings, spend, isLoading = false, subjectLabel = "este anúncio" }: SurveyPanelProps) {
  if (isLoading) {
    return <StatePanel kind="loading" message="Carregando respostas da pesquisa..." framed={false} density="compact" />;
  }
  if (mappings.length === 0) {
    return (
      <StatePanel
        kind="empty"
        message="Nenhuma coluna da planilha vinculada aos packs selecionados. Vincule colunas na integração da planilha."
        framed={false}
        density="compact"
      />
    );
  }
  const hasAny = mappings.some((m) => {
    const hist = histograms?.[m.id];
    return hist && Object.keys(hist).length > 0;
  });
  if (!hasAny) {
    return (
      <StatePanel
        kind="empty"
        message={`Nenhum lead de ${subjectLabel} com resposta nas colunas vinculadas neste período.`}
        framed={false}
        density="compact"
      />
    );
  }
  const spendValue = Number(spend ?? 0);
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {mappings.map((mapping) =>
        mapping.kind === "category" ? (
          <CategoryCard key={mapping.id} mapping={mapping} hist={histograms?.[mapping.id]} />
        ) : (
          <NumericCard key={mapping.id} mapping={mapping} hist={histograms?.[mapping.id]} spend={Number.isFinite(spendValue) ? spendValue : 0} />
        ),
      )}
    </div>
  );
}
