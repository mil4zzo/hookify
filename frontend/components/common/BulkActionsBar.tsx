"use client";

import React from "react";
import { IconChevronDown, IconDots, IconLoader2, IconX } from "@tabler/icons-react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils/cn";

export interface BulkActionConfirm {
  /** Recebem a contagem e o substantivo já flexionado, para a copy concordar. */
  title: (count: number, noun: string) => string;
  message: (count: number, noun: string) => string;
  confirmText: string;
  variant?: "default" | "destructive" | "success";
  /** Ícone do botão de confirmação do dialog (maior que o da barra). */
  icon?: React.ReactNode;
}

/**
 * Cor da fatia. Em repouso ela aparece só na TINTA; o preenchimento sólido é do hover.
 * - `accent` (azul): a ação mais FREQUENTE da tela — uma só por barra. Não é a mais
 *   importante nem a mais simbólica: é a que a pessoa mais vai querer clicar (atualizar
 *   no /packs, pausar/ativar no /manager). Se duas disputam, nenhuma é a principal.
 * - `danger` (vermelho) e `success` (verde): semântica, não hierarquia — param e religam.
 */
export type BulkActionTone = "accent" | "danger" | "success";

export interface BulkAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  /** Ação de liga/desliga: quando true, a fatia aparece afundada (já acionada). */
  active?: boolean;
  tone?: BulkActionTone;
  /** Gatilho — abre lista/diálogo para escolher. Ganha o chevron, que promete a escolha. */
  opensList?: boolean;
  /**
   * Ação OCASIONAL: sai da barra e vira item do menu "Mais". O critério não é
   * "menos importante", é menos frequente — o que se faz uma vez por pack, o que
   * custa dinheiro, o que envolve outra pessoa. O irreversível NÃO entra aqui:
   * esconder "Deletar" atrás de um clique a mais não protege, só faz procurar.
   */
  secondary?: boolean;
  /** Troca o ícone por spinner enquanto `isLoading`. Só para ações que disparam a carga. */
  showsLoading?: boolean;
  /** Ausente = executa direto (ação não destrutiva). Presente = passa pelo ConfirmDialog. */
  confirm?: BulkActionConfirm;
  onSelect: () => void;
}

export interface BulkActionsBarProps {
  selectedCount: number;
  /** Universo do "selecionar todos" (pós-filtro). Presente, o contador vira "3 de 9". */
  totalCount?: number;
  isLoading: boolean;
  /** True quando todas as linhas selecionáveis (pós-filtro) já estão selecionadas. */
  allSelected: boolean;
  /** Substantivo da entidade para a copy do dialog (ex.: anúncio/anúncios). */
  entityNoun: { singular: string; plural: string };
  actions: BulkAction[];
  /** Selecionar todos (true) / desmarcar todos (false) — sobre as linhas visíveis pós-filtro. */
  onToggleAll: (checked: boolean) => void;
  onClear: () => void;
  /** Ajuste de posição (ex.: bottom offset) por superfície. */
  className?: string;
}

const TONE_CLASS: Record<BulkActionTone, string> = {
  accent: "bulk-tone-accent",
  danger: "bulk-tone-danger",
  success: "bulk-tone-success",
};

/** A fatia: altura inteira da barra, sem raio e sem margem — quem separa é o `divide-x`. */
const SEGMENT = "focus-inset inline-flex h-control-large shrink-0 items-center gap-2 whitespace-nowrap px-4 text-sm font-medium outline-none transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4";
/** Fatia sem cor própria: véu da tinta no hover. */
const SEGMENT_NEUTRAL = "hover:bg-background-10";
/** Controle de seleção (não é ação sobre os itens): recua até o ponteiro chegar. */
const SEGMENT_QUIET = "text-background-60 hover:text-background";

/**
 * Barra flutuante de ações em massa. Aparece centrada na base da área de conteúdo quando
 * há itens selecionados — perto de onde o usuário está clicando, sem disputar espaço com
 * o toolbar (busca/filtros). O pai precisa ser `relative`.
 *
 * A leitura é em três zonas, da esquerda para a direita: **o que está selecionado**
 * (contador + selecionar todos), **o que fazer** (as ações, na ordem que o caller
 * declara — por frequência) e **a saída** (✕). "Selecionar todos" não é ação sobre os
 * itens: fala sobre a seleção, o mesmo assunto do contador ao lado.
 *
 * Ações destrutivas ou de alto impacto declaram `confirm` e passam por um dialog: diferente
 * do toggle individual, um clique aqui atinge N itens de uma vez — pausa acidental de dezenas
 * de anúncios já aconteceu. O dialog vive aqui dentro para que toda superfície que renderize
 * a barra ganhe a proteção sem duplicar estado.
 */
export function BulkActionsBar({ selectedCount, totalCount, isLoading, allSelected, entityNoun, actions, onToggleAll, onClear, className }: BulkActionsBarProps) {
  const [pendingActionId, setPendingActionId] = React.useState<string | null>(null);
  // O menu devolve o foco ao gatilho ao fechar. Quando o item escolhido abre um dialog,
  // essa devolução acontece DEPOIS do dialog montar e rouba o foco dele.
  const confirmFromMenuRef = React.useRef(false);

  if (selectedCount === 0) return null;

  const noun = selectedCount === 1 ? entityNoun.singular : entityNoun.plural;
  const pendingAction = actions.find((action) => action.id === pendingActionId) ?? null;
  const inlineActions = actions.filter((action) => !action.secondary);
  const menuActions = actions.filter((action) => action.secondary);

  const handleSelect = (action: BulkAction) => {
    if (action.confirm) setPendingActionId(action.id);
    else action.onSelect();
  };

  const handleConfirm = () => {
    pendingAction?.onSelect();
    setPendingActionId(null);
  };

  return (
    <div className={cn("pointer-events-none absolute inset-x-0 bottom-6 z-sticky flex justify-center px-4", className)}>
      <div className="bulk-slab pointer-events-auto flex max-w-full flex-wrap items-center divide-x divide-background-20 overflow-hidden rounded-lg">
        <span className="inline-flex h-control-large shrink-0 items-center px-4 text-sm tabular-nums text-background-60">
          <b className="font-semibold text-background">{selectedCount}</b>
          {totalCount !== undefined ? (
            <>
              {" de "}
              <b className="font-semibold text-background">{totalCount}</b>
            </>
          ) : null}
          {` ${selectedCount === 1 ? "selecionado" : "selecionados"}`}
        </span>

        <button type="button" className={cn(SEGMENT, SEGMENT_NEUTRAL, SEGMENT_QUIET)} disabled={isLoading} onClick={() => onToggleAll(!allSelected)}>
          {allSelected ? "Desmarcar todos" : "Selecionar todos"}
        </button>

        {inlineActions.map((action) => (
          <button
            key={action.id}
            type="button"
            aria-pressed={action.active}
            className={cn(SEGMENT, action.tone ? TONE_CLASS[action.tone] : SEGMENT_NEUTRAL)}
            disabled={isLoading || action.disabled}
            onClick={() => handleSelect(action)}
          >
            {isLoading && action.showsLoading ? <IconLoader2 className="animate-spin" /> : action.icon}
            {action.label}
            {action.opensList ? <IconChevronDown className="opacity-60" /> : null}
          </button>
        ))}

        {menuActions.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={cn(SEGMENT, SEGMENT_NEUTRAL, "data-[state=open]:bg-background-10")} disabled={isLoading}>
                <IconDots />
                Mais
                <IconChevronDown className="opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="top"
              align="end"
              sideOffset={8}
              className="bulk-menu w-60 rounded-lg border-0 p-1.5 shadow-elevation-overlay"
              onCloseAutoFocus={(event) => {
                if (!confirmFromMenuRef.current) return;
                confirmFromMenuRef.current = false;
                event.preventDefault();
              }}
            >
              {menuActions.map((action) => (
                <DropdownMenuItem
                  key={action.id}
                  disabled={isLoading || action.disabled}
                  className="bulk-menu-item h-control-default gap-2.5 rounded-md px-3 text-sm font-medium [&_svg]:size-4"
                  onSelect={() => {
                    confirmFromMenuRef.current = !!action.confirm;
                    handleSelect(action);
                  }}
                >
                  {action.icon}
                  {action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        <button type="button" className={cn(SEGMENT, SEGMENT_NEUTRAL, SEGMENT_QUIET, "px-3.5")} disabled={isLoading} onClick={onClear} aria-label="Limpar seleção">
          <IconX />
        </button>
      </div>

      {/* Renderiza via portal (AppDialog/Radix) — escapa do wrapper pointer-events-none. */}
      <ConfirmDialog
        isOpen={pendingAction !== null}
        onClose={() => setPendingActionId(null)}
        title={pendingAction?.confirm ? pendingAction.confirm.title(selectedCount, noun) : ""}
        message={pendingAction?.confirm ? pendingAction.confirm.message(selectedCount, noun) : ""}
        confirmText={pendingAction?.confirm?.confirmText ?? "Confirmar"}
        variant={pendingAction?.confirm?.variant ?? "default"}
        confirmIcon={pendingAction?.confirm?.icon}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
