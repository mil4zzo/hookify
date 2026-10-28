"use client";

import React, { useMemo, useState } from "react";
import { IconAlertTriangle, IconArrowRight, IconArrowsMinimize, IconLoader2, IconRefresh } from "@tabler/icons-react";

import { AppDialog } from "@/components/common/AppDialog";
import { InlineNotice, StatePanel } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BatchBudgetItem, RankingsItem } from "@/lib/api/schemas";
import { bulkBudgetCountText, useBulkBudgetRunner } from "@/lib/hooks/useBulkBudgetRunner";
import {
  analyzeBulkBudgetSelection,
  BULK_BUDGET_MAX,
  budgetMinorToValue,
  budgetValueToMinor,
  parseSignedDecimal,
  previewBulkBudget,
  type BulkBudgetAdjustment,
  type BulkBudgetEntityType,
  type BulkBudgetMode,
  type BulkBudgetPreviewRow,
} from "@/lib/manager/budget";
import { isBulkBudgetJobBusy, useBulkBudgetJobStore, type BulkBudgetJob, type BulkBudgetRequestBody, type BulkBudgetRowInfo } from "@/lib/store/bulkBudgetJob";
import { getCurrencySymbol, useFormatCurrency } from "@/lib/utils/currency";
import { cn } from "@/lib/utils/cn";

/** Concordância: campanha é feminino, conjunto é masculino ("puladas" × "pulados"). */
const NOUN: Record<BulkBudgetEntityType, { one: string; many: string; o: "a" | "o"; elsewhere: string }> = {
  campaign: { one: "campanha", many: "campanhas", o: "a", elsewhere: "o orçamento nos conjuntos (ABO)" },
  adset: { one: "conjunto", many: "conjuntos", o: "o", elsewhere: "o orçamento na campanha (CBO)" },
};

const MODES: BulkBudgetMode[] = ["percent", "delta", "fixed"];

/**
 * O que separa os modos é "a partir do valor de cada um" (os dois primeiros) × "todos iguais"
 * (o terceiro) — os nomes dizem isso, e a linha de exemplo embaixo das abas tira a dúvida.
 */
function modeLabel(mode: BulkBudgetMode, entityType: BulkBudgetEntityType, currencySymbol: string) {
  if (mode === "percent") return "Variar em %";
  if (mode === "delta") return `Variar em ${currencySymbol}`;
  return `Mesmo valor para tod${NOUN[entityType].o}s`;
}

/** "pulada"/"pulados" etc. — particípio concordando com a entidade e o número. */
function agree(stem: string, count: number, entityType: BulkBudgetEntityType) {
  return `${stem}${NOUN[entityType].o}${count === 1 ? "" : "s"}`;
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatPercent(change: number) {
  const pct = change * 100;
  const rounded = Math.abs(pct) >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${String(rounded).replace(".", ",")}%`;
}

/** Motivo de cada linha não alterada, já em português. Os do backend chegam com `message`. */
function reasonText(item: BatchBudgetItem, entityType: BulkBudgetEntityType): string {
  switch (item.reason) {
    case "no_own_budget":
      return `Tem ${NOUN[entityType].elsewhere}.`;
    case "not_synced":
      return "Orçamento ainda não sincronizado — atualize o pack.";
    case "non_positive":
      return "O valor ficaria zero ou negativo.";
    case "type_mismatch":
      return "O tipo de orçamento mudou na Meta (diário ↔ total) depois que a tela carregou.";
    default:
      return item.message || "A Meta recusou a alteração.";
  }
}

const skippedItem = (id: string, reason: string): BatchBudgetItem => ({ id, outcome: "skipped", reason, verified: true });

/**
 * Ajuste de orçamento de vários conjuntos/campanhas de uma vez: percentual (cada um sobre
 * o próprio valor), somar um valor a cada um, ou o mesmo valor para todos.
 *
 * Três telas: formulário → aplicando → resultado final. O resultado aparece SEMPRE, mesmo
 * quando tudo dá certo: mexer em orçamento de várias campanhas é sensível e a pessoa precisa
 * ver como ficou cada uma. Enquanto o lote trabalha o diálogo não fecha, MINIMIZA: vira o card
 * do canto (`BulkBudgetMiniCard`), que acompanha e reabre. Por isso ele mora no AppLayout, não
 * no Manager — sair do Manager no meio não perde nada (ver `useBulkBudgetRunner`).
 *
 * Tudo que vai ser PULADO é dito antes de executar: orçamento no outro nível (ABO/CBO),
 * ainda sem orçamento sincronizado, resultado zero/negativo. Os modos em dinheiro nem ficam
 * disponíveis quando a seleção mistura diário com total ou moedas.
 */
export function BulkBudgetDialog() {
  const { job, draft, dialogOpen, closeDialog, minimize, acknowledge } = useBulkBudgetJobStore();
  const runner = useBulkBudgetRunner();

  // Lote em andamento, ou terminado e ainda não visto, tem prioridade sobre um formulário novo.
  const showJob = !!job && (job.status === "running" || !job.seen);
  const entityType = showJob ? job!.entityType : draft?.entityType ?? "campaign";
  const title = showJob
    ? `Orçamento de ${bulkBudgetCountText(new Set([...Object.keys(job!.items), ...job!.sentIds]).size, entityType)}`
    : `Orçamento de ${bulkBudgetCountText(draft?.rows.length ?? 0, entityType)}`;

  // Esc e clique fora também minimizam enquanto o lote trabalha: fechar perderia o fio.
  const busy = showJob && isBulkBudgetJobBusy(job);
  const handleClose = busy ? minimize : closeDialog;

  const handleConclude = () => {
    acknowledge();
    // Se a pessoa abriu o formulário com outra seleção enquanto este resultado esperava, ele aparece agora.
    if (!useBulkBudgetJobStore.getState().draft) closeDialog();
  };

  return (
    <AppDialog isOpen={dialogOpen && (showJob || !!draft)} onClose={handleClose} size="lg" title={title} showCloseButton={!busy}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {busy ? (
            <Button variant="ghost" size="sm" onClick={minimize}>
              <IconArrowsMinimize className="h-3.5 w-3.5" />
              Minimizar
            </Button>
          ) : null}
        </div>
        {showJob ? (
          <JobView job={job!} onRetry={runner.retry} onConclude={handleConclude} />
        ) : draft ? (
          <FormView
            key={draft.openedAt}
            rows={draft.rows}
            entityType={draft.entityType}
            onCancel={handleClose}
            onApply={(init) => {
              runner.start({ ...init, packIds: draft.packIds });
              draft.onStarted?.();
            }}
          />
        ) : null}
      </div>
    </AppDialog>
  );
}

// ── Formulário ──────────────────────────────────────────────────────────────

function FormView({
  rows,
  entityType,
  onCancel,
  onApply,
}: {
  rows: RankingsItem[];
  entityType: BulkBudgetEntityType;
  onCancel: () => void;
  onApply: (init: Pick<BulkBudgetJob, "entityType" | "request" | "rowInfo" | "sentIds" | "items">) => void;
}) {
  const formatCurrency = useFormatCurrency();
  const [mode, setMode] = useState<BulkBudgetMode>("percent");
  const [draft, setDraft] = useState("");
  // Segunda etapa antes de enviar: o pedido não tem volta depois que sai (ver ConfirmStep).
  const [confirming, setConfirming] = useState(false);

  const selection = useMemo(() => analyzeBulkBudgetSelection(rows, entityType), [rows, entityType]);
  const moneyBlocked = selection.moneyBlockedReason !== null;
  const parsed = parseSignedDecimal(draft);

  const adjustment = useMemo<BulkBudgetAdjustment | null>(() => {
    if (parsed === null) return null;
    if (mode === "percent") return parsed !== 0 && parsed > -100 ? { mode, percent: parsed } : null;
    if (!selection.kind) return null;
    if (mode === "fixed" && parsed <= 0) return null;
    if (mode === "delta" && parsed === 0) return null;
    const minor = budgetValueToMinor(Math.abs(parsed), selection.currency);
    return { mode, amountMinor: parsed < 0 ? -minor : minor, kind: selection.kind };
  }, [parsed, mode, selection.kind, selection.currency]);

  const preview = useMemo(() => (adjustment ? previewBulkBudget(selection.eligible, adjustment) : []), [adjustment, selection.eligible]);
  const toChange = preview.filter((r) => r.status === "change");
  const invalid = preview.filter((r) => r.status === "invalid");
  const big = toChange.filter((r) => r.big);
  const tooMany = toChange.length > BULK_BUDGET_MAX;
  const canReview = toChange.length > 0 && !tooMany;

  const formatMinor = (minor: number | null | undefined, currency: string | null) =>
    minor == null ? "—" : formatCurrency(budgetMinorToValue(minor, currency), currency || undefined);
  const currencySymbol = getCurrencySymbol(selection.currency || undefined);

  // Exemplo com um orçamento real da seleção: com o valor digitado, ou um ilustrativo antes disso.
  const sample = selection.eligible[0];
  const sampleAdjustment: BulkBudgetAdjustment | null =
    adjustment ??
    (mode === "percent"
      ? { mode, percent: 10 }
      : selection.kind
        ? { mode, amountMinor: budgetValueToMinor(50, selection.currency), kind: selection.kind }
        : null);
  const exampleText = (() => {
    const noun = NOUN[entityType];
    if (mode === "fixed") return `Tod${noun.o}s passam a ter o mesmo orçamento, não importa quanto cada ${noun.one} tem hoje.`;
    const head = `Cada ${noun.one} muda a partir do próprio orçamento`;
    if (!sample || !sampleAdjustment) return `${head}.`;
    const [result] = previewBulkBudget([sample], sampleAdjustment);
    const step =
      sampleAdjustment.mode === "percent"
        ? `${sampleAdjustment.percent > 0 ? "+" : ""}${String(sampleAdjustment.percent).replace(".", ",")}%`
        : `${sampleAdjustment.amountMinor < 0 ? "−" : "+"} ${formatMinor(Math.abs(sampleAdjustment.amountMinor), sample.currency)}`;
    return `${head}. Ex.: ${formatMinor(sample.currentMinor, sample.currency)} ${step} → ${result.status === "invalid" ? "inválido" : formatMinor(result.newMinor, sample.currency)}.`;
  })();

  const handleModeChange = (next: string) => {
    const nextMode = next as BulkBudgetMode;
    if (nextMode === mode || (nextMode !== "percent" && moneyBlocked)) return;
    setMode(nextMode);
    setDraft("");
  };

  const handleApply = () => {
    if (!adjustment || toChange.length === 0) return;
    const request: BulkBudgetRequestBody =
      adjustment.mode === "percent"
        ? { mode: "percent", percent: adjustment.percent }
        : { mode: adjustment.mode, amount: adjustment.amountMinor, budget_type: adjustment.kind };
    const rowInfo: Record<string, BulkBudgetRowInfo> = {};
    for (const r of selection.eligible) rowInfo[r.id] = { name: r.name, currency: r.currency };
    for (const r of [...selection.elsewhere, ...selection.unknown]) rowInfo[r.id] = { name: r.name, currency: null };
    // O resultado final mostra a seleção INTEIRA: o que a tela já sabia que não ia mudar entra
    // desde já, com o mesmo motivo que o aviso deu antes de aplicar.
    const items: Record<string, BatchBudgetItem> = {};
    for (const r of selection.elsewhere) items[r.id] = skippedItem(r.id, "no_own_budget");
    for (const r of selection.unknown) items[r.id] = skippedItem(r.id, "not_synced");
    for (const r of invalid) items[r.id] = skippedItem(r.id, "non_positive");
    for (const r of preview.filter((p) => p.status === "unchanged")) {
      items[r.id] = { id: r.id, outcome: "unchanged", verified: true, before_daily: r.kind === "daily" ? r.currentMinor : null, before_lifetime: r.kind === "lifetime" ? r.currentMinor : null };
    }
    onApply({ entityType, request, rowInfo, sentIds: toChange.map((r) => r.id), items });
  };

  if (selection.eligible.length === 0) {
    return (
      <StatePanel
        kind="empty"
        title={`Nenhum${NOUN[entityType].o === "a" ? "a" : ""} ${NOUN[entityType].one} com orçamento próprio`}
        message={
          selection.elsewhere.length > 0
            ? `${NOUN[entityType].o === "a" ? "As" : "Os"} ${NOUN[entityType].many} ${agree("selecionad", 2, entityType)} têm ${NOUN[entityType].elsewhere}. Edite pelo outro nível.`
            : "O orçamento ainda não foi sincronizado. Atualize o pack e tente de novo."
        }
      />
    );
  }

  if (confirming) {
    return (
      <>
        <InlineNotice tone="warning" title="Confira antes de confirmar">
          <p className="text-xs">
            Depois de começar não dá para interromper: o pedido vai direto para a Meta e termina mesmo se você fechar a janela. O que for
            aplicado não volta sozinho — para desfazer, é preciso um novo ajuste.
          </p>
        </InlineNotice>
        <PreviewList rows={[...toChange, ...preview.filter((r) => r.status !== "change")]} formatMinor={formatMinor} />
        {preview.length > toChange.length ? (
          <p className="text-xs text-muted-foreground">
            As linhas apagadas não mudam: já estão nesse valor ou ficariam zeradas.
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Voltar
          </Button>
          <Button size="sm" onClick={handleApply}>
            Confirmar e aplicar em {bulkBudgetCountText(toChange.length, entityType)}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Tabs value={mode} onValueChange={handleModeChange}>
          {/* Trilho no nível 0: controle segmentado dentro de modal desce um nível. */}
          <TabsList className="w-full bg-background">
            {MODES.map((option) => (
              <TabsTrigger
                key={option}
                value={option}
                className="flex-1 disabled:pointer-events-none disabled:opacity-50"
                disabled={option !== "percent" && moneyBlocked}
              >
                {modeLabel(option, entityType, currencySymbol)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <p className="text-xs text-muted-foreground">{exampleText}</p>
        {moneyBlocked && (
          <p className="text-xs text-muted-foreground">
            {selection.moneyBlockedReason === "mixed-kind"
              ? "Os modos em dinheiro estão indisponíveis porque a seleção mistura orçamento diário e total: 50 por dia e 50 no total são coisas diferentes. O percentual vale para os dois."
              : "Os modos em dinheiro estão indisponíveis porque a seleção mistura moedas diferentes. O percentual vale para todas."}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="bulk-budget-value" className="text-xs font-medium text-muted-foreground">
          {mode === "percent"
            ? "Variação sobre o orçamento atual de cada um"
            : mode === "delta"
              ? `Valor a somar ao orçamento ${selection.kind === "daily" ? "diário" : "total"} de cada um`
              : `Novo orçamento ${selection.kind === "daily" ? "diário" : "total"} para todos`}
        </label>
        <div className="flex items-center gap-2">
          {mode !== "percent" ? <span className="text-sm text-muted-foreground">{currencySymbol}</span> : null}
          <Input
            id="bulk-budget-value"
            inputMode="decimal"
            autoFocus
            value={draft}
            placeholder={mode === "percent" ? "Ex.: 15 ou -20" : mode === "delta" ? "Ex.: 50 ou -30" : "Ex.: 150"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canReview) setConfirming(true);
            }}
          />
          {mode === "percent" ? <span className="text-sm text-muted-foreground">%</span> : null}
        </div>
        {mode !== "fixed" && <p className="text-xs text-muted-foreground">Use valor negativo para reduzir.</p>}
      </div>

      <Notices entityType={entityType} elsewhere={selection.elsewhere.length} unknown={selection.unknown.length} invalid={invalid.length} big={big.length} />

      {tooMany && (
        <InlineNotice tone="warning">
          <p className="text-xs">
            Dá para ajustar até {BULK_BUDGET_MAX} de uma vez e {toChange.length} mudariam. Selecione menos e aplique em partes.
          </p>
        </InlineNotice>
      )}

      {preview.length > 0 && <PreviewList rows={preview} formatMinor={formatMinor} />}

      <div className="flex items-center justify-end gap-3">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button size="sm" onClick={() => setConfirming(true)} disabled={!canReview}>
          Revisar e aplicar
        </Button>
      </div>
    </>
  );
}

function Notices({ entityType, elsewhere, unknown, invalid, big }: { entityType: BulkBudgetEntityType; elsewhere: number; unknown: number; invalid: number; big: number }) {
  const will = (n: number) => (n === 1 ? "será" : "serão");
  const skipped: string[] = [];
  if (elsewhere > 0) skipped.push(`${bulkBudgetCountText(elsewhere, entityType)} ${elsewhere === 1 ? "tem" : "têm"} ${NOUN[entityType].elsewhere} e ${will(elsewhere)} ${agree("pulad", elsewhere, entityType)}.`);
  if (unknown > 0) skipped.push(`${bulkBudgetCountText(unknown, entityType)} ainda sem orçamento sincronizado ${will(unknown)} ${agree("pulad", unknown, entityType)}.`);
  if (invalid > 0) skipped.push(`${bulkBudgetCountText(invalid, entityType)} ${invalid === 1 ? "ficaria" : "ficariam"} com orçamento zero ou negativo e não ${will(invalid)} ${agree("alterad", invalid, entityType)}.`);

  if (skipped.length === 0 && big === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {skipped.length > 0 && (
        <InlineNotice tone="info">
          {skipped.map((line) => (
            <p key={line} className="text-xs">
              {line}
            </p>
          ))}
        </InlineNotice>
      )}
      {big > 0 && (
        <InlineNotice tone="warning">
          <p className="text-xs">
            {bulkBudgetCountText(big, entityType)} {big === 1 ? "vai" : "vão"} mudar mais de 25%. Mudanças grandes podem devolver a entrega à fase de aprendizado do Meta.
          </p>
        </InlineNotice>
      )}
    </div>
  );
}

/** Nome | atual | novo | variação. Mesma grade no cabeçalho e nas linhas para as colunas alinharem. */
const PREVIEW_GRID = "grid grid-cols-[minmax(0,1fr)_6.5rem_8.5rem_3.5rem] items-center gap-3 px-3";

function PreviewList({ rows, formatMinor }: { rows: BulkBudgetPreviewRow[]; formatMinor: (minor: number | null | undefined, currency: string | null) => string }) {
  return (
    // Região de LEITURA dentro do modal: desce ao nível 0.
    <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-background">
      <div className={cn(PREVIEW_GRID, "sticky top-0 z-sticky border-b border-border bg-background py-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground")}>
        <span>Nome</span>
        <span className="text-right">Atual</span>
        <span className="text-right">Novo</span>
        <span className="text-right">Variação</span>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li key={row.id} className={cn(PREVIEW_GRID, "py-2", row.status !== "change" && "opacity-50")}>
            <span className="truncate text-sm" title={row.name}>
              {row.name}
            </span>
            <span className="text-right text-xs tabular-nums text-muted-foreground">{formatMinor(row.currentMinor, row.currency)}</span>
            <span className="text-right text-xs tabular-nums">
              <span className="text-sm text-foreground">{row.status === "invalid" ? "inválido" : formatMinor(row.newMinor, row.currency)}</span>
              <span className="text-muted-foreground"> {row.kind === "daily" ? "/dia" : "total"}</span>
            </span>
            {row.status === "change" ? (
              <span className={cn("inline-flex items-center justify-end gap-0.5 text-xs tabular-nums text-muted-foreground", row.big && "text-warning")}>
                {row.big ? <IconAlertTriangle className="h-3 w-3" /> : null}
                {formatPercent(row.change)}
              </span>
            ) : (
              <span className="text-right text-xs text-muted-foreground">{row.status === "unchanged" ? "igual" : ""}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Execução e resultado ────────────────────────────────────────────────────

const OUTCOME_ORDER: BatchBudgetItem["outcome"][] = ["failed", "updated", "skipped", "unchanged"];

/**
 * "unconfirmed" = sem resposta do write E sem releitura: pode ter sido aplicado. Repetir um
 * percentual/soma partiria do valor já alterado e aplicaria duas vezes — só o valor fixo é
 * seguro de repetir. A linha mantém a mensagem pedindo para conferir.
 */
function canRetryItem(item: BatchBudgetItem, job: BulkBudgetJob) {
  if (item.reason === "not_found") return false;
  if (item.reason === "unconfirmed") return job.request.mode === "fixed";
  return true;
}

function JobView({ job, onRetry, onConclude }: { job: BulkBudgetJob; onRetry: (ids: string[]) => void; onConclude: () => void }) {
  const formatCurrency = useFormatCurrency();
  const { entityType } = job;
  const formatMinor = (minor: number | null | undefined, currency: string | null) =>
    minor == null ? "—" : formatCurrency(budgetMinorToValue(minor, currency), currency || undefined);

  if (job.status === "running") {
    return (
      <StatePanel
        kind="loading"
        title={`Aplicando em ${bulkBudgetCountText(job.sentIds.length, entityType)}…`}
        message="Leva alguns segundos. Pode minimizar e seguir usando o app: o andamento fica no canto da tela e o resultado abre por lá."
      />
    );
  }

  const items = Object.values(job.items);
  const failed = items.filter((it) => it.outcome === "failed");
  const updated = items.filter((it) => it.outcome === "updated").length;
  const isRetrying = job.retrying.length > 0;
  // Repetir às cegas só é seguro quando o pedido é idempotente (valor fixo) ou quando a
  // resposta chegou dizendo que nada mudou. Percentual/soma sobre algo que talvez já tenha
  // sido aplicado aplicaria duas vezes.
  const canRetryWhole = job.status === "error" && (!job.error?.maybeApplied || job.request.mode === "fixed");

  return (
    <>
      {job.status === "error" ? (
        <InlineNotice tone="destructive" title="Não foi possível confirmar o resultado">
          <p className="text-xs">{job.error?.message}</p>
        </InlineNotice>
      ) : (
        <InlineNotice tone={failed.length > 0 ? "warning" : "success"}>
          <p className="text-xs">
            {updated > 0 ? `${capitalize(bulkBudgetCountText(updated, entityType))} ${agree("atualizad", updated, entityType)}. ` : "Nada foi alterado. "}
            {failed.length > 0
              ? `${failed.length} não ${failed.length === 1 ? "mudou" : "mudaram"} — o motivo está em cada linha. ${updated > 0 ? "As que deram certo continuam aplicadas." : ""}`
              : ""}
          </p>
        </InlineNotice>
      )}

      <div className="max-h-80 overflow-y-auto rounded-md border border-border bg-background">
        {OUTCOME_ORDER.map((outcome) => {
          const group = items.filter((it) => it.outcome === outcome);
          if (group.length === 0) return null;
          const retriable = group.filter((it) => canRetryItem(it, job));
          return (
            <section key={outcome} className="border-b border-border last:border-b-0">
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                  {outcome === "failed"
                    ? `Com erro (${group.length})`
                    : outcome === "updated"
                      ? `${capitalize(agree("atualizad", 2, entityType))} (${group.length})`
                      : outcome === "skipped"
                        ? `${capitalize(agree("pulad", 2, entityType))} (${group.length})`
                        : `Já estavam nesse valor (${group.length})`}
                </span>
                {outcome === "failed" && retriable.length > 1 ? (
                  <Button variant="outline" size="sm" disabled={isRetrying} onClick={() => onRetry(retriable.map((it) => it.id))}>
                    {isRetrying && job.retrying.length > 1 ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" /> : <IconRefresh className="h-3.5 w-3.5" />}
                    Tentar todas de novo
                  </Button>
                ) : null}
              </div>
              <ul className="divide-y divide-border border-t border-border">
                {group.map((item) => (
                  <ResultRow
                    key={item.id}
                    item={item}
                    info={job.rowInfo[item.id]}
                    entityType={entityType}
                    formatMinor={formatMinor}
                    retryState={!canRetryItem(item, job) ? "hidden" : isRetrying ? (job.retrying.includes(item.id) && job.retrying.length === 1 ? "spinning" : "disabled") : "ready"}
                    onRetry={() => onRetry([item.id])}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-3">
        {canRetryWhole ? (
          <Button variant="outline" size="sm" disabled={isRetrying} onClick={() => onRetry(job.sentIds)}>
            {isRetrying ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" /> : <IconRefresh className="h-3.5 w-3.5" />}
            Tentar de novo
          </Button>
        ) : null}
        <Button size="sm" onClick={onConclude} disabled={isRetrying}>
          Concluir
        </Button>
      </div>
    </>
  );
}

function ResultRow({
  item,
  info,
  entityType,
  formatMinor,
  retryState,
  onRetry,
}: {
  item: BatchBudgetItem;
  info?: BulkBudgetRowInfo;
  entityType: BulkBudgetEntityType;
  formatMinor: (minor: number | null | undefined, currency: string | null) => string;
  retryState: "hidden" | "ready" | "disabled" | "spinning";
  onRetry: () => void;
}) {
  const currency = info?.currency ?? null;
  const isDaily = item.before_daily != null || item.daily_budget != null;
  const before = isDaily ? item.before_daily : item.before_lifetime;
  const after = isDaily ? item.daily_budget : item.lifetime_budget;
  const unit = isDaily ? "/dia" : "total";

  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm" title={info?.name ?? item.id}>
          {info?.name ?? item.id}
        </div>
        {item.outcome === "updated" ? (
          <div className="flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
            {formatMinor(before, currency)}
            <IconArrowRight className="h-3 w-3" />
            {item.verified ? (
              <>
                <span className="text-foreground">{formatMinor(after, currency)}</span>
                <span>{unit}</span>
                {before && after ? <span>({formatPercent((after - before) / before)})</span> : null}
              </>
            ) : (
              <span>enviado — o valor confirmado aparece em instantes</span>
            )}
          </div>
        ) : item.outcome === "unchanged" ? (
          <div className="text-xs tabular-nums text-muted-foreground">
            {formatMinor(before, currency)} {unit}
          </div>
        ) : (
          <div className={cn("text-xs", item.outcome === "failed" ? "text-destructive" : "text-muted-foreground")}>{reasonText(item, entityType)}</div>
        )}
      </div>
      {item.outcome === "failed" && retryState !== "hidden" ? (
        <Button variant="outline" size="sm" disabled={retryState !== "ready"} onClick={onRetry}>
          {retryState === "spinning" ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" /> : <IconRefresh className="h-3.5 w-3.5" />}
          Tentar de novo
        </Button>
      ) : null}
    </li>
  );
}
