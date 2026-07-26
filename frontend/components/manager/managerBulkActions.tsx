import { IconPlayerPause, IconPlayerPlay, IconShare2 } from "@tabler/icons-react";
import type { BulkAction } from "@/components/common/BulkActionsBar";

interface BuildManagerBulkActionsParams {
  /** Pausar/ativar. Ausentes na aba Criativos, onde a seleção existe para compartilhar. */
  onPause?: () => void;
  onActivate?: () => void;
  /** Abre o compartilhamento da seleção (link público em stories). Sem confirmação — não é destrutivo. */
  onShare?: () => void;
}

/**
 * Ações em massa do Manager. Vive fora dos componentes porque ManagerTable e
 * ManagerChildrenTable renderizam a mesma barra: a copy dos dialogs precisa
 * existir em um lugar só, senão as duas superfícies divergem com o tempo.
 */
export function buildManagerBulkActions({ onPause, onActivate, onShare }: BuildManagerBulkActionsParams): BulkAction[] {
  const actions: BulkAction[] = [];

  if (onPause && onActivate) {
    actions.push({
      id: "pause",
      label: "Pausar",
      icon: <IconPlayerPause className="h-3.5 w-3.5" />,
      className: "hover:bg-destructive hover:text-destructive-foreground",
      showsLoading: true,
      confirm: {
        title: (count, noun) => `Pausar ${count} ${noun}?`,
        message: (count, noun) => `A veiculação ${count === 1 ? "deste" : "destes"} ${noun} será interrompida no Meta imediatamente.`,
        confirmText: "Pausar",
        variant: "destructive",
        icon: <IconPlayerPause className="h-5 w-5" />,
      },
      onSelect: onPause,
    });

    actions.push({
      id: "activate",
      label: "Ativar",
      icon: <IconPlayerPlay className="h-3.5 w-3.5" />,
      className: "hover:bg-success hover:text-success-foreground",
      showsLoading: true,
      confirm: {
        title: (count, noun) => `Ativar ${count} ${noun}?`,
        message: (count, noun) => `${count === 1 ? "Este" : "Estes"} ${noun} ${count === 1 ? "voltará" : "voltarão"} a veicular no Meta (exceto os bloqueados por campanha/conjunto pausado).`,
        confirmText: "Ativar",
        variant: "success",
        icon: <IconPlayerPlay className="h-5 w-5" />,
      },
      onSelect: onActivate,
    });
  }

  if (onShare) {
    actions.push({
      id: "share",
      label: "Compartilhar",
      icon: <IconShare2 className="h-3.5 w-3.5" />,
      className: "text-brand hover:bg-primary hover:text-primary-foreground",
      onSelect: onShare,
    });
  }

  return actions;
}
