"use client";

import React from "react";
import { IconLoader2, IconPlayerPause, IconPlayerPlay, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { cn } from "@/lib/utils/cn";

export interface BulkActionsBarProps {
  selectedCount: number;
  isLoading: boolean;
  /** True quando todas as linhas selecionáveis (pós-filtro) já estão selecionadas. */
  allSelected: boolean;
  /** Substantivo da entidade para copy do dialog de confirmação (ex.: anúncio/anúncios). */
  entityNoun: { singular: string; plural: string };
  onPause: () => void;
  onActivate: () => void;
  /** Selecionar todos (true) / desmarcar todos (false) — sobre as linhas visíveis pós-filtro. */
  onToggleAll: (checked: boolean) => void;
  onClear: () => void;
  /** Ajuste de posição (ex.: bottom offset) por superfície. */
  className?: string;
}

/**
 * Barra flutuante de ações em massa (pausar/ativar). Aparece centrada na base da área da
 * tabela quando há linhas selecionadas — perto de onde o usuário está clicando, sem disputar
 * espaço com o toolbar (busca/filtros). O pai precisa ser `relative`.
 *
 * Toda ação em massa exige confirmação (dialog): diferente do toggle individual, um clique
 * aqui atinge N ativos de uma vez no Meta — pausa acidental de dezenas de anúncios já
 * aconteceu. O dialog vive aqui dentro para que toda superfície que renderize a barra
 * (ManagerTable, ManagerChildrenTable) ganhe a proteção sem duplicar estado.
 */
export function BulkActionsBar({ selectedCount, isLoading, allSelected, entityNoun, onPause, onActivate, onToggleAll, onClear, className }: BulkActionsBarProps) {
  const [pendingAction, setPendingAction] = React.useState<"pause" | "activate" | null>(null);

  if (selectedCount === 0) return null;

  const noun = selectedCount === 1 ? entityNoun.singular : entityNoun.plural;
  const isPause = pendingAction === "pause";

  const handleConfirm = () => {
    if (pendingAction === "pause") onPause();
    if (pendingAction === "activate") onActivate();
    setPendingAction(null);
  };

  return (
    <div className={cn("pointer-events-none absolute inset-x-0 bottom-6 z-sticky flex justify-center", className)}>
      <div className="pointer-events-auto flex h-control-default items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm shadow-elevation-overlay">
        <span className="whitespace-nowrap font-medium text-muted-foreground">
          {selectedCount} selecionado{selectedCount !== 1 ? "s" : ""}
        </span>
        <div className="h-4 w-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          className="h-auto gap-1 px-2 py-0.5 text-xs hover:bg-destructive hover:text-destructive-foreground"
          disabled={isLoading}
          onClick={() => setPendingAction("pause")}
        >
          {isLoading ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" /> : <IconPlayerPause className="h-3.5 w-3.5" />}
          Pausar
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-auto gap-1 px-2 py-0.5 text-xs hover:bg-success hover:text-success-foreground"
          disabled={isLoading}
          onClick={() => setPendingAction("activate")}
        >
          {isLoading ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" /> : <IconPlayerPlay className="h-3.5 w-3.5" />}
          Ativar
        </Button>
        <div className="h-4 w-px bg-border" />
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
        onClose={() => setPendingAction(null)}
        title={`${isPause ? "Pausar" : "Ativar"} ${selectedCount} ${noun}?`}
        message={
          isPause
            ? `A veiculação ${selectedCount === 1 ? "deste" : "destes"} ${noun} será interrompida no Meta imediatamente.`
            : `${selectedCount === 1 ? "Este" : "Estes"} ${noun} ${selectedCount === 1 ? "voltará" : "voltarão"} a veicular no Meta (exceto os bloqueados por campanha/conjunto pausado).`
        }
        confirmText={isPause ? "Pausar" : "Ativar"}
        variant={isPause ? "destructive" : "success"}
        confirmIcon={isPause ? <IconPlayerPause className="h-5 w-5" /> : <IconPlayerPlay className="h-5 w-5" />}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
