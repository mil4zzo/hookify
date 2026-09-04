"use client";

import React from "react";
import type { ColumnDef, ColumnHelper, Row, Table as TableInstance } from "@tanstack/react-table";
import type { RankingsItem } from "@/lib/api/schemas";
import type { ManagerColumnType } from "@/components/common/ManagerColumnFilter";
import type { ManagerCellMode } from "@/components/manager/managerCellMode";
import type { GroupedMetricSeriesByKey, ManagerAverages } from "@/lib/metrics";
import type { CustomColumnDef } from "@/lib/metrics/customColumns";
import type { SettingsTab } from "@/lib/store/settingsModal";
import { IconFilter } from "@tabler/icons-react";
import { buildMetricColumns, SortIcon } from "@/components/manager/managerTableMetricColumns";
import { AdNameCell } from "@/components/manager/AdNameCell";
import { StatusCell } from "@/components/manager/StatusCell";
import { BudgetCell, getRowBudgetMinor } from "@/components/manager/BudgetCell";
import { ProvenanceCell } from "@/components/manager/ProvenanceCell";
import { TagsCell } from "@/components/manager/TagsCell";
import { Checkbox } from "@/components/ui/checkbox";
import { MANAGER_RULES_COLUMN_ID, type ManagerRuleFilterValue } from "@/lib/manager/managerRules";
import { compareText, rowMatchesRules, type RuleEvaluationContext } from "@/lib/rules/evaluate";
import { isEmptyRuleTree } from "@/lib/rules/types";
import { getRowAccountNames, getRowPackNames, type ProvenanceIndex } from "@/lib/manager/provenance";
import { metaCreatedLocalDate } from "@/lib/utils/dateFilters";

export type ViewMode = "detailed" | "minimal";

// O estado da tabela agrega múltiplos filtros da mesma coluna num array — restritivo se qualquer um for.


// Filtros auxiliares (colunas ocultas) que atuam sobre dados exibidos na célula de nome
// (subtítulo de conjunto/campanha, contagem de ativos) — o funil aparece no header do nome.
/** Campos cujo filtro aparece no funil da coluna de NOME (não têm coluna própria). */
const NAME_FUNNEL_FIELDS = ["ad_name", "adset_name", "campaign_name", "ad_id"];

// Mesmo visual do ColumnFilter readonly usado nas colunas de métrica — um só vocabulário de "coluna filtrada".
const ActiveFilterIcon = ({ onReveal, field }: { onReveal: (fieldId: string) => void; field: string }) => (
  <button
    type="button"
    className="flex h-6 w-6 items-center justify-center rounded text-primary hover:bg-primary-10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    title="Ver onde esta coluna está sendo filtrada"
    aria-label="Ver o filtro desta coluna"
    onClick={(e) => {
      // O header também ordena: sem parar a propagação, revelar o filtro
      // reordenaria a tabela no mesmo clique.
      e.stopPropagation();
      onReveal(field);
    }}
  >
    <IconFilter className="h-3.5 w-3.5 fill-current" />
  </button>
);

export type CreateManagerTableColumnsParams = {
  columnHelper: ColumnHelper<RankingsItem>;
  activeColumns: Set<ManagerColumnType>;
  groupByAdNameEffective: boolean;
  byKey: GroupedMetricSeriesByKey;
  /** Acionado ao clicar no chevron de uma linha — abre o modal de drill. */
  onOpenDrill?: (original: RankingsItem) => void;
  /** Packs do contexto — habilita escrita (status/budget) em pack COMPARTILHADO. */
  selectedPackIds?: string[];

  currentTab: "individual" | "por-anuncio" | "por-conjunto" | "por-campanha";
  getRowKey: (row: { original?: RankingsItem } | RankingsItem) => string;

  endDate?: string;
  cellMode: ManagerCellMode;
  averagesRef: React.MutableRefObject<ManagerAverages>;
  formatAverageRef: React.MutableRefObject<(metricId: string) => string>;
  filteredAveragesRef: React.MutableRefObject<ManagerAverages | null>;
  formatFilteredAverageRef: React.MutableRefObject<(metricId: string) => string>;
  /** Agregado das linhas SELECIONADAS — o grupo de comparação ad-hoc. `null` sem seleção. */
  selectionAveragesRef: React.MutableRefObject<ManagerAverages | null>;
  formatSelectionAverageRef: React.MutableRefObject<(metricId: string) => string>;

  formatCurrencyRef: React.MutableRefObject<(n: number) => string>;
  formatPct: (v: number) => string;

  viewMode: ViewMode;
  /** Quando true, colore o número de cada métrica pela distância da média (escala de 5 tons). */
  colorMetricValue: boolean;
  /** 140: colunas vinculadas da planilha nos packs selecionados (anexadas após as fixas). */
  customColumns?: ReadonlyArray<CustomColumnDef>;
  /** Índice id→nome de packs/contas. Alimenta os accessors das colunas Pack/Conta — e portanto
   *  ordenação, filtro de texto e CSV. (As células resolvem de novo via hook: ver ProvenanceCell.) */
  provenanceIndex: ProvenanceIndex;
  hasSheetIntegration: boolean;
  mqlLeadscoreMin: number | null;
  actionTypeRef: React.MutableRefObject<string>;
  /** Âncora do último checkbox clicado sem shift — habilita seleção em intervalo (shift+click). */
  selectionAnchorRef: React.MutableRefObject<string | null>;

  openSettings: (tab?: SettingsTab) => void;
  /** Campos citados por condição restritiva — acende o funil no header. */
  filteredFieldIdsRef: React.MutableRefObject<Set<string>>;
  /** Clique no funil: abre o popover de Filtros destacando as condições do campo. */
  onRevealField: (fieldId: string) => void;
  globalFilterRef: React.MutableRefObject<string>;
  /** Contexto de avaliação da regra (tipo de conversão, corte de MQL). */
  ruleContext: RuleEvaluationContext;
};







const CREATED_DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });


/** Considera ativo apenas ACTIVE; demais (PAUSED, ADSET_PAUSED, etc.) são inativos. */
function isActiveStatus(status?: string | null): boolean {
  if (!status) return false;
  return String(status).toUpperCase() === "ACTIVE";
}

/** Ordenação por orçamento: budget próprio (daily ?? lifetime); linhas sem budget (CBO/ABO no outro nível ou não sincronizado) por último no desc. */
function budgetSortingFn(rowA: { original: RankingsItem }, rowB: { original: RankingsItem }): number {
  const a = getRowBudgetMinor(rowA.original) ?? -1;
  const b = getRowBudgetMinor(rowB.original) ?? -1;
  return a === b ? 0 : a < b ? -1 : 1;
}

/** Ordenação por status: ativos primeiro (asc) ou inativos primeiro (desc). */
function statusSortingFn(rowA: { getValue: (id: string) => unknown; original: RankingsItem }, rowB: { getValue: (id: string) => unknown; original: RankingsItem }): number {
  const activeA = isActiveStatus(rowA.original?.effective_status);
  const activeB = isActiveStatus(rowB.original?.effective_status);
  if (activeA === activeB) return 0;
  // Valor menor = vir primeiro quando asc → ativos primeiro
  return activeA && !activeB ? -1 : 1;
}

/**
 * Regra de clique da seleção, compartilhada pelo checkbox e pela célula em volta dele —
 * os dois precisam se comportar igual, inclusive no shift+click.
 *
 * Shift+click aplica a TODAS as linhas do intervalo (na ordem visível atual, pós-filtro/sort)
 * o mesmo estado que esta linha passaria a ter: marca ou desmarca o intervalo inteiro.
 *
 * Devolve "range" quando já resolveu o intervalo (o chamador deve suprimir o toggle da própria
 * linha) ou "toggle" quando é clique normal — aí a linha ancora aqui e alterna sozinha.
 */
function applySelectionClick(
  event: { shiftKey: boolean },
  row: Row<RankingsItem>,
  table: TableInstance<RankingsItem>,
  selectionAnchorRef: React.MutableRefObject<string | null>,
): "range" | "toggle" {
  const anchorId = selectionAnchorRef.current;
  if (event.shiftKey && anchorId && anchorId !== row.id) {
    const visibleRows = table.getRowModel().rows;
    const anchorPos = visibleRows.findIndex((r) => r.id === anchorId);
    const clickedPos = visibleRows.findIndex((r) => r.id === row.id);
    if (anchorPos !== -1 && clickedPos !== -1) {
      const [start, end] = anchorPos < clickedPos ? [anchorPos, clickedPos] : [clickedPos, anchorPos];
      const value = !row.getIsSelected();
      table.setRowSelection((prev) => {
        const next = { ...prev };
        for (let i = start; i <= end; i++) {
          const r = visibleRows[i];
          if (!r.getCanSelect()) continue;
          if (value) next[r.id] = true;
          else delete next[r.id];
        }
        return next;
      });
      return "range";
    }
  }
  // Clique normal (ou shift sem âncora válida): ancora nesta linha.
  selectionAnchorRef.current = row.id;
  return "toggle";
}

export function createManagerTableColumns(params: CreateManagerTableColumnsParams): ColumnDef<RankingsItem, any>[] {
  const { columnHelper, currentTab, onOpenDrill, groupByAdNameEffective, viewMode, selectionAnchorRef, activeColumns, provenanceIndex, selectedPackIds, filteredFieldIdsRef, onRevealField } = params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cols: ColumnDef<RankingsItem, any>[] = [];

  // Coluna de seleção em lote — todas as abas. Nas abas com id de entidade (individual/por-conjunto/
  // por-campanha) a seleção alimenta pausar/ativar; na aba Criativos (por-anuncio, chave = ad_name)
  // ela alimenta o compartilhamento (link público em stories). A mecânica de shift/âncora abaixo é
  // agnóstica à aba: usa row.id (definido por getRowId conforme a aba) e a ordem visível atual.
  if (currentTab === "individual" || currentTab === "por-conjunto" || currentTab === "por-campanha" || currentTab === "por-anuncio") {
    cols.push({
      id: "select",
      header: ({ table }) => {
        const allSelected = table.getIsAllPageRowsSelected();
        const someSelected = table.getIsSomePageRowsSelected();
        return (
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
            aria-label="Selecionar todos"
            onClick={(e) => e.stopPropagation()}
          />
        );
      },
      cell: ({ row, table }) => (
        <div
          // HITBOX = A CÉLULA INTEIRA. O alvo real era o ícone de 16px; errar por poucos pixels
          // caía no <tr> e abria o modal do anúncio — o erro mais caro possível, porque
          // interrompe a seleção que estava sendo montada e ainda cobre a tela.
          // O `absolute inset-0` (o <td> da coluna é `relative p-0`, ver TableContent) preenche
          // a célula toda, padding incluído — que é justamente a faixa morta de antes.
          className="absolute inset-0 flex cursor-pointer items-center justify-center"
          onMouseDown={(e) => {
            // Evita que shift+click destaque texto da página (seleção de texto do navegador).
            if (e.shiftKey) e.preventDefault();
          }}
          onClick={(e) => {
            // Linha não-selecionável (arquivada/deletada): deixa o clique seguir para o <tr> e
            // abrir o modal, como sempre foi. Bloquear aqui criaria uma zona morta.
            if (!row.getCanSelect()) return;
            e.stopPropagation();
            // Clique no próprio checkbox: ele tem handler próprio (que também já para a
            // propagação). O guard existe para a célula continuar correta sozinha, sem
            // depender de o checkbox lembrar de parar a bolha.
            if (e.target !== e.currentTarget) return;
            if (applySelectionClick(e, row, table, selectionAnchorRef) === "toggle") {
              row.toggleSelected(!row.getIsSelected());
            }
          }}
        >
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
            onMouseDown={(e) => {
              if (e.shiftKey) e.preventDefault();
            }}
            onClick={(e) => {
              e.stopPropagation();
              // Suprime o toggle nativo do Radix (Root usa composeEventHandlers → checa
              // defaultPrevented), senão onCheckedChange re-alternaria a própria linha clicada
              // por cima do intervalo já aplicado.
              if (applySelectionClick(e, row, table, selectionAnchorRef) === "range") e.preventDefault();
            }}
            aria-label="Selecionar linha"
            disabled={!row.getCanSelect()}
          />
        </div>
      ),
      enableSorting: false,
      enableColumnFilters: false,
      enableResizing: false,
      size: 44,
      minSize: 44,
    } as ColumnDef<RankingsItem, any>);
  }

  // Status column (visível exceto na aba "por-anuncio")
  if (currentTab !== "por-anuncio") {
    cols.push(
      columnHelper.accessor("effective_status", {
        id: "status",
        header: ({ column }) => (
          <div className="flex items-center gap-1">
            <SortIcon column={column} invertDirection />
            <span>Status</span>
            {filteredFieldIdsRef.current.has("status") && <ActiveFilterIcon onReveal={onRevealField} field="status" />}
          </div>
        ),
        size: 80,
        minSize: 80,
        enableResizing: false,
        enableSorting: true,
        sortDescFirst: false, // primeiro clique = ativos primeiro, exibimos como seta baixo (invertDirection)
        sortingFn: statusSortingFn,
        cell: (info) => {
          const original = info.row.original as RankingsItem;
          return <StatusCell original={original} currentTab={currentTab} packIds={selectedPackIds} />;
        },
      }),
    );
  }

  // AD name (sempre visível)
  const nameColumnLabel = currentTab === "por-conjunto" ? "Conjunto" : currentTab === "por-campanha" ? "Campanha" : "Anúncio";
  cols.push(
    columnHelper.accessor("ad_name", {
      sortDescFirst: false, // primeiro clique = A-Z, exibimos como seta baixo (invertDirection)
      header: ({ column, table }) => {
        // O funil da coluna de nome acende também para os nomes de conjunto e
        // campanha: são condições sobre a identidade da linha, e não têm coluna
        // própria onde aparecer.
        const isFiltered = NAME_FUNNEL_FIELDS.some((field) => filteredFieldIdsRef.current.has(field));
        return (
          <div className="flex items-center gap-1">
            <SortIcon column={column} invertDirection />
            <span>{nameColumnLabel}</span>
            {isFiltered && <ActiveFilterIcon onReveal={onRevealField} field={NAME_FUNNEL_FIELDS.find((f) => filteredFieldIdsRef.current.has(f)) ?? "ad_name"} />}
          </div>
        );
      },
      size: 300,
      minSize: 160,
      enableResizing: true,
      sortingFn: "auto",
      cell: (info) => {
        const original = info.row.original as RankingsItem;
        const name = String(info.getValue() || "—");
        return <AdNameCell original={original} value={name} groupByAdNameEffective={groupByAdNameEffective} currentTab={currentTab} minimal={viewMode === "minimal"} onOpenDrill={onOpenDrill} />;
      },
    }),
  );

  // Tags do criativo (migration 116). O accessor devolve os nomes concatenados —
  // é o que alimenta ordenação e CSV; o filtro, porém, casa por ID (o nome muda
  // quando a tag é renomeada, o id não).
  if (activeColumns.has("tags")) {
    cols.push(
      columnHelper.accessor((row) => ((row as RankingsItem).tags ?? []).map((t) => t.name).join(", "), {
        id: "tags",
        sortDescFirst: false,
        header: ({ column }) => (
          <div className="flex items-center gap-1">
            <SortIcon column={column} invertDirection />
            <span>Tags</span>
            {filteredFieldIdsRef.current.has("tags") && <ActiveFilterIcon onReveal={onRevealField} field="tags" />}
          </div>
        ),
        size: 180,
        minSize: 100,
        enableResizing: true,
        enableSorting: true,
        sortingFn: "auto",
        // O valor cru vai inteiro: rowMatchesTagFilter conhece o operador e ainda
        // normaliza o shape antigo que possa ter sobrado no sessionStorage.
        cell: (info) => {
          const original = info.row.original as RankingsItem;
          // group_key é o próprio ad_name na aba Criativos; na aba Por anúncio o
          // nome do criativo vem em ad_name. Sem nome não há o que marcar.
          const adName = String(original.ad_name ?? original.group_key ?? "");
          if (!adName) return null;
          return <TagsCell adName={adName} tags={original.tags ?? []} />;
        },
      }),
    );
  }

  // Procedência (Pack / Conta) — dimensões opcionais, ligadas pelo seletor de colunas.
  // O accessor devolve os nomes já resolvidos: é o que alimenta ordenação, filtro de texto e CSV.
  const provenanceDimensions = [
    // `fieldId` é o campo que a REGRA cita (array de ids da linha); `id` é a coluna,
    // que mostra os nomes resolvidos. São diferentes de propósito: a regra pergunta
    // "está em algum destes packs?", a coluna exibe "Black Friday, Sempre On".
    { id: "pack" as const, fieldId: "pack_ids", label: "Pack", resolve: (row: RankingsItem) => getRowPackNames(row, provenanceIndex) },
    { id: "account" as const, fieldId: "account_ids", label: "Conta", resolve: (row: RankingsItem) => getRowAccountNames(row, provenanceIndex) },
  ];

  for (const dimension of provenanceDimensions) {
    if (!activeColumns.has(dimension.id)) continue;

    cols.push(
      columnHelper.accessor((row) => dimension.resolve(row as RankingsItem).join(", "), {
        id: dimension.id,
        sortDescFirst: false, // primeiro clique = A-Z (igual à coluna de nome)
        header: ({ column }) => (
          <div className="flex items-center gap-1">
            <SortIcon column={column} invertDirection />
            <span>{dimension.label}</span>
            {filteredFieldIdsRef.current.has(dimension.fieldId) && <ActiveFilterIcon onReveal={onRevealField} field={dimension.fieldId} />}
          </div>
        ),
        size: 150,
        minSize: 90,
        enableResizing: true,
        enableSorting: true,
        sortingFn: "auto",
        cell: (info) => <ProvenanceCell original={info.row.original as RankingsItem} dimension={dimension.id} />,
      }),
    );
  }

  // Criado em — data de CRIAÇÃO do anúncio no Meta (migration 115). Não é início de veiculação
  // (o Meta não expõe esse campo) nem a data em que o pack foi sincronizado.
  // O accessor devolve YYYY-MM-DD no fuso local: é o que ordena, filtra e vai para o CSV;
  // a formatação br fica só na célula.
  if (activeColumns.has("created_date")) {
    cols.push(
      columnHelper.accessor((row) => metaCreatedLocalDate((row as RankingsItem).meta_created_time), {
        id: "created_date",
        sortDescFirst: true, // primeiro clique = mais recentes primeiro
        header: ({ column }) => (
          <div className="flex items-center gap-1">
            <SortIcon column={column} />
            <span>Criado em</span>
            {filteredFieldIdsRef.current.has("meta_created_time") && <ActiveFilterIcon onReveal={onRevealField} field="meta_created_time" />}
          </div>
        ),
        size: 120,
        minSize: 100,
        enableResizing: true,
        enableSorting: true,
        // Linhas sem data vão para o fim em qualquer direção — "não sei" nunca disputa o topo.
        sortingFn: (rowA, rowB, columnId) => {
          const a = (rowA.getValue(columnId) as string | null) ?? "";
          const b = (rowB.getValue(columnId) as string | null) ?? "";
          if (!a && !b) return 0;
          if (!a) return 1;
          if (!b) return -1;
          return a < b ? -1 : a > b ? 1 : 0;
        },
        sortUndefined: "last",
        cell: (info) => {
          const isoDate = info.getValue() as string | null;
          if (!isoDate) {
            return (
              <span className="text-muted-foreground" title="Anúncio ainda não ressincronizado desde que passamos a guardar a data de criação">
                —
              </span>
            );
          }
          const [year, month, day] = isoDate.split("-").map(Number);
          return <span className="tabular-nums">{CREATED_DATE_FORMATTER.format(new Date(year, month - 1, day))}</span>;
        },
      }),
    );
  }

  // Orçamento — só nas abas cuja linha é uma entidade que pode ter budget próprio
  if (currentTab === "por-conjunto" || currentTab === "por-campanha") {
    const budgetTab = currentTab;
    cols.push(
      columnHelper.accessor("budget_daily", {
        id: "budget",
        header: ({ column }) => (
          <div className="flex items-center justify-center gap-1 w-full">
            <SortIcon column={column} />
            <span>Orçamento</span>
          </div>
        ),
        size: 130,
        minSize: 110,
        enableResizing: true,
        enableSorting: true,
        enableColumnFilter: false,
        sortingFn: budgetSortingFn,
        cell: (info) => <BudgetCell original={info.row.original as RankingsItem} currentTab={budgetTab} packIds={selectedPackIds} />,
      }),
    );
  }

  // A ÚNICA coluna que filtra. Não desenha nada: existe para o TanStack ter onde
  // pendurar a avaliação da regra e continuar entregando `getFilteredRowModel()`
  // (do qual dependem a média filtrada do header, a seleção em massa e o
  // virtualizador). As antigas colunas ocultas de nome de conjunto/campanha e de
  // "ads ativos" saíram: viraram campos da regra.
  cols.push(
    columnHelper.display({
      id: MANAGER_RULES_COLUMN_ID,
      header: () => null,
      enableSorting: false,
      enableResizing: false,
      enableHiding: true,
      size: 0,
      minSize: 0,
      maxSize: 0,
      filterFn: (row, _columnId, filterValue: ManagerRuleFilterValue | undefined) => {
        if (!filterValue) return true;
        const original = row.original as RankingsItem;

        // Busca por nome: atalho da barra, avaliado com o mesmo comparador da
        // regra para não haver duas noções de "contém" na mesma tela.
        if (filterValue.search && !compareText(String(original.ad_name ?? ""), filterValue.search, "contains")) {
          return false;
        }

        if (isEmptyRuleTree(filterValue.rules)) return true;
        return rowMatchesRules(original, filterValue.rules, params.ruleContext);
      },
      cell: () => null,
    }),
  );

  cols.push(...buildMetricColumns(params));

  return cols;
}
