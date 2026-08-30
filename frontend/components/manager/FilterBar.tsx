"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconAlertTriangle, IconChevronDown, IconFilter } from "@tabler/icons-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { RuleBuilder, type RuleDimensionOption } from "@/components/rules/RuleBuilder";
import { EMPTY_RULE_TREE, type RuleTree } from "@/lib/rules/types";
import type { RuleContext, RuleManagerTab } from "@/lib/rules/fields";

/**
 * A barra de controles da tabela do Manager.
 *
 * O QUE ELA DEIXOU DE SER
 *   Até a unificação, este arquivo tinha ~640 linhas: montava à mão uma linha de
 *   [coluna | operador | valor] por tipo de campo (texto, número, status, data,
 *   tags), com o estado no formato do TanStack. Tudo isso virou o `RuleBuilder`,
 *   o MESMO componente que os Boards e o Critério de validação usam — o que
 *   trouxe de graça o E/OU, os subgrupos e o "contém regex".
 *
 * O QUE SOBROU AQUI
 *   Só a casca: busca (leadingSlot), contagem, aviso de truncagem e o botão
 *   "Filtros (N)" com o popover. O conteúdo do popover é o construtor de regra.
 */
interface FilterBarProps {
  rules: RuleTree;
  setRules: React.Dispatch<React.SetStateAction<RuleTree>>;
  /** Nº de condições restritivas — o N do botão. Vem pronto para não recontar aqui. */
  conditionCount: number;
  ruleContext: RuleContext;
  tab?: RuleManagerTab;
  hasSheetIntegration?: boolean;
  /** Opções de Pack/Conta presentes no recorte atual. */
  dimensionOptions?: Partial<Record<string, RuleDimensionOption[]>>;
  /**
   * Abertura controlada de fora: o funil de uma coluna do Manager abre este popover
   * já destacando as condições daquele campo. Sem isso o funil seria só uma luz.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  highlightFieldId?: string | null;
  filteredCount?: number;
  totalCount?: number;
  itemLabel?: string;
  /** Renderizado no início da linha de controles (ex.: input de busca). */
  leadingSlot?: React.ReactNode;
  /** Renderizado no fim da linha de controles (ex.: menu de compartilhar). */
  trailingSlot?: React.ReactNode;
  /**
   * Total REAL de grupos no servidor (`pagination.total` da RPC). A RPC agrega o
   * conjunto inteiro e só depois corta pelo limite, então esse número é exato
   * mesmo com as linhas truncadas.
   *
   * Sem ele o rodapé afirmava "de 1000" onde existiam 12.787 — e filtro e seleção
   * em massa operavam sobre a fatia de maior gasto sem avisar ninguém.
   */
  serverTotal?: number | null;
}

function arePropsEqual(prev: FilterBarProps, next: FilterBarProps): boolean {
  return (
    prev.rules === next.rules &&
    prev.setRules === next.setRules &&
    prev.conditionCount === next.conditionCount &&
    prev.ruleContext === next.ruleContext &&
    prev.tab === next.tab &&
    prev.hasSheetIntegration === next.hasSheetIntegration &&
    prev.dimensionOptions === next.dimensionOptions &&
    prev.open === next.open &&
    prev.onOpenChange === next.onOpenChange &&
    prev.highlightFieldId === next.highlightFieldId &&
    prev.filteredCount === next.filteredCount &&
    prev.totalCount === next.totalCount &&
    prev.itemLabel === next.itemLabel &&
    prev.serverTotal === next.serverTotal &&
    prev.leadingSlot === next.leadingSlot &&
    prev.trailingSlot === next.trailingSlot
  );
}

export const FilterBar = React.memo(function FilterBar({
  rules,
  setRules,
  conditionCount,
  ruleContext,
  tab,
  hasSheetIntegration = false,
  dimensionOptions,
  open,
  onOpenChange,
  highlightFieldId,
  filteredCount,
  totalCount,
  itemLabel,
  leadingSlot,
  trailingSlot,
  serverTotal,
}: FilterBarProps) {
  // Controlado quando o pai manda (clique no funil); interno no uso normal.
  const [internalOpen, setInternalOpen] = useState(false);
  const isPopoverOpen = open ?? internalOpen;
  const setIsPopoverOpen = onOpenChange ?? setInternalOpen;

  // Truncagem: o servidor tem mais grupos do que a tabela carregou. Filtro e
  // seleção em massa só enxergam o que veio — por isso o aviso é explícito.
  const isTruncated = serverTotal != null && totalCount !== undefined && serverTotal > totalCount;

  // InlineNotice e um banner de bloco (role="alert", px-3 py-2, text-sm); aqui o aviso
  // divide uma linha unica de toolbar com a contagem e o botao de filtros, onde um
  // banner quebraria o layout. Mesma paleta de warning, forma de chip.
  // design-system-exception: inline-notice-pattern - aviso inline na toolbar, nao banner de bloco
  const truncatedChipClass =
    "inline-flex items-center gap-1 whitespace-nowrap rounded border border-warning-30 bg-warning-10 px-1.5 py-0.5 text-2xs text-warning";

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{leadingSlot}</div>
      <div className="flex flex-shrink-0 flex-wrap items-center gap-3">
        {filteredCount !== undefined && totalCount !== undefined && itemLabel && (
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Exibindo {filteredCount} de {totalCount} {itemLabel}
          </span>
        )}
        {isTruncated && (
          <span
            className={truncatedChipClass}
            title={`O período tem ${serverTotal} ${itemLabel ?? "itens"}, mas só ${totalCount} foram carregados (os de maior investimento). Filtros e seleção em massa atuam apenas sobre esses.`}
          >
            <IconAlertTriangle className="h-3 w-3" />
            {serverTotal} no total
          </span>
        )}
        <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline">
              <IconFilter className="h-4 w-4" />
              <span>Filtros</span>
              {conditionCount > 0 && <span className="ml-1 rounded-full bg-primary text-primary-foreground text-xs px-2 py-0.5">{conditionCount}</span>}
              <IconChevronDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[560px] max-w-[95vw] p-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Filtros</h3>
                {conditionCount > 0 && (
                  <button type="button" onClick={() => setRules(EMPTY_RULE_TREE)} className="text-xs text-primary hover:underline">
                    Limpar todos
                  </button>
                )}
              </div>

              <div className="max-h-[60vh] overflow-y-auto pr-1">
                <RuleBuilder
                  value={rules}
                  onChange={setRules}
                  context={ruleContext}
                  tab={tab}
                  hasSheetIntegration={hasSheetIntegration}
                  dimensionOptions={dimensionOptions}
                  highlightFieldId={highlightFieldId}
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>
        {trailingSlot}
      </div>
    </div>
  );
}, arePropsEqual);
