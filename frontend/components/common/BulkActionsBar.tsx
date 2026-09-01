"use client";

import React from "react";
import { IconLoader2, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
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

export interface BulkAction {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** Classes extras do botão — tint de hover conforme a natureza da ação. */
  className?: string;
  disabled?: boolean;
  /** Ação de liga/desliga: quando true, o botão aparece pressionado (estado visível na barra). */
  active?: boolean;
  /** Troca o ícone por spinner enquanto `isLoading`. Só para ações que disparam a carga. */
  showsLoading?: boolean;
  /** Ausente = executa direto (ação não destrutiva). Presente = passa pelo ConfirmDialog. */
  confirm?: BulkActionConfirm;
  onSelect: () => void;
}

export interface BulkActionsBarProps {
  selectedCount: number;
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

/**
 * Barra flutuante de ações em massa. Aparece centrada na base da área de conteúdo quando
 * há itens selecionados — perto de onde o usuário está clicando, sem disputar espaço com
 * o toolbar (busca/filtros). O pai precisa ser `relative`.
 *
 * Ações destrutivas ou de alto impacto declaram `confirm` e passam por um dialog: diferente
 * do toggle individual, um clique aqui atinge N itens de uma vez — pausa acidental de dezenas
 * de anúncios já aconteceu. O dialog vive aqui dentro para que toda superfície que renderize
 * a barra ganhe a proteção sem duplicar estado.
 */
export function BulkActionsBar({ selectedCount, isLoading, allSelected, entityNoun, actions, onToggleAll, onClear, className }: BulkActionsBarProps) {
  const [pendingActionId, setPendingActionId] = React.useState<string | null>(null);

  if (selectedCount === 0) return null;

  const noun = selectedCount === 1 ? entityNoun.singular : entityNoun.plural;
  const pendingAction = actions.find((action) => action.id === pendingActionId) ?? null;

  const handleClick = (action: BulkAction) => {
    if (action.confirm) setPendingActionId(action.id);
    else action.onSelect();
  };

  const handleConfirm = () => {
    pendingAction?.onSelect();
    setPendingActionId(null);
  };

  return (
    <div className={cn("pointer-events-none absolute inset-x-0 bottom-6 z-sticky flex justify-center", className)}>
      <div className="pointer-events-auto flex h-control-default items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm shadow-elevation-overlay">
        <span className="whitespace-nowrap font-medium text-muted-foreground">
          {selectedCount} selecionado{selectedCount !== 1 ? "s" : ""}
        </span>
        <div className="h-4 w-px bg-border" />
        {actions.map((action) => (
          <Button key={action.id} variant="ghost" size="sm" aria-pressed={action.active} className={cn("h-auto gap-1 px-2 py-0.5 text-xs", action.active && "bg-primary-10 text-primary", action.className)} disabled={isLoading || action.disabled} onClick={() => handleClick(action)}>
            {isLoading && action.showsLoading ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" /> : action.icon}
            {action.label}
          </Button>
        ))}
        {actions.length > 0 && <div className="h-4 w-px bg-border" />}
        <Button variant="ghost" size="sm" className="h-auto px-2 py-0.5 text-xs text-muted-foreground" disabled={isLoading} onClick={() => onToggleAll(!allSelected)}>
          {allSelected ? "Desmarcar todos" : "Selecionar todos"}
        </Button>
        <Button variant="ghost" size="sm" className="h-auto px-1 py-0.5 text-muted-foreground" disabled={isLoading} onClick={onClear} aria-label="Limpar seleção">
          <IconX className="h-3.5 w-3.5" />
        </Button>
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
