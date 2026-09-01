import { IconArrowBarToUp, IconPlayerPause, IconPlayerPlay, IconShare2, IconTag } from "@tabler/icons-react";
import type { BulkAction } from "@/components/common/BulkActionsBar";

interface BuildManagerBulkActionsParams {
  /** Pausar/ativar. Ausentes na aba Criativos, onde a seleção existe para compartilhar. */
  onPause?: () => void;
  onActivate?: () => void;
  /** Abre o compartilhamento da seleção (link público em stories). Sem confirmação — não é destrutivo. */
  onShare?: () => void;
  /**
   * Abre a marcação em massa. Só existe onde a linha é um criativo (abas Criativos
   * e Por anúncio) — a tag é do criativo, e aplicá-la numa linha de conjunto ou
   * campanha seria uma expansão implícita para os N criativos daquele grupo.
   */
  onTags?: () => void;
  /**
   * Liga/desliga "selecionados no topo". Existe só onde a tabela sabe reordenar
   * (ManagerTable); a tabela de filhos do drill não passa.
   */
  onTogglePin?: () => void;
  /** Estado atual do "selecionados no topo" — pinta o botão como pressionado. */
  isPinned?: boolean;
}

/**
 * Ações em massa do Manager. Vive fora dos componentes porque ManagerTable e
 * ManagerChildrenTable renderizam a mesma barra: a copy dos dialogs precisa
 * existir em um lugar só, senão as duas superfícies divergem com o tempo.
 */
export function buildManagerBulkActions({ onPause, onActivate, onShare, onTags, onTogglePin, isPinned = false }: BuildManagerBulkActionsParams): BulkAction[] {
  const actions: BulkAction[] = [];

  if (onTogglePin) {
    actions.push({
      id: "pin",
      // Primeira ação da barra: é a única que serve para LER (juntar as linhas para
      // comparar), e é o passo natural depois de marcar os checkboxes. As de escrita
      // (pausar/ativar) vêm depois, longe do gesto de conferir.
      label: isPinned ? "Desafixar" : "Fixar no topo",
      icon: <IconArrowBarToUp className="h-3.5 w-3.5" />,
      active: isPinned,
      onSelect: onTogglePin,
    });
  }

  if (onTags) {
    actions.push({
      id: "tags",
      label: "Tags",
      icon: <IconTag className="h-3.5 w-3.5" />,
      // Sem confirm: o diálogo já é a confirmação, e marcar é reversível num clique.
      onSelect: onTags,
    });
  }

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
