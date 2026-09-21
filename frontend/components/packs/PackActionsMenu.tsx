"use client";

import React, { useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconRotateClockwise, IconCalendarEvent, IconMicrophone, IconTargetArrow, IconTableExport, IconPencil, IconTrash, IconUsers, IconHistory, IconLogout } from "@tabler/icons-react";
import { PackActivityDialog } from "@/components/packs/PackActivityDialog";
import { PackShareDialog } from "@/components/packs/PackShareDialog";
import { api } from "@/lib/api/endpoints";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { showError, showSuccess } from "@/lib/utils/toast";
import type { AdsPack } from "@/lib/types";

export interface PackActionsMenuProps {
  pack: AdsPack;
  /** O gatilho. Vira `DropdownMenuTrigger asChild` — o card inteiro, ou um `⋯`. */
  children: React.ReactNode;
  isUpdating?: boolean;
  /** Trava o menu fechado. O card usa enquanto o nome está em edição inline. */
  disabled?: boolean;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  onRefresh: (packId: string) => void;
  onRemove: (packId: string) => void;
  onEditDateRange?: (pack: AdsPack) => void;
  onTranscribeAds?: (packId: string, packName: string) => void;
  onEditJudgment?: (pack: AdsPack) => void;
  onEditSheetIntegration?: (pack: AdsPack) => void;
  onDeleteSheetIntegration?: (pack: AdsPack) => void;
}

/**
 * O menu de ações de um pack, com o gatilho de quem chamar.
 *
 * Vive aqui, e não no `PackCard`, porque a árvore da Biblioteca precisa do MESMO
 * menu num `⋯` ao lado do nome. Duplicar a lista faria as duas versões divergirem
 * no primeiro item novo — e ela tem regra de papel em quase toda linha.
 *
 * O componente carrega o próprio estado (compartilhar, histórico, sair): são
 * diálogos que só este menu abre, e mantê-los junto evita que cada chamador
 * tenha de replicar três `useState` e a saída do pack.
 */
export function PackActionsMenu({
  pack,
  children,
  isUpdating = false,
  disabled = false,
  align = "start",
  side = "right",
  onRefresh,
  onRemove,
  onEditDateRange,
  onTranscribeAds,
  onEditJudgment,
  onEditSheetIntegration,
  onDeleteSheetIntegration,
}: PackActionsMenuProps) {
  const { removePack } = useClientPacks();
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [isActivityDialogOpen, setIsActivityDialogOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  // A UI gateia por papel; a autorização REAL é do backend.
  const isSharedGuest = !!pack.shared_role;
  const isViewer = pack.shared_role === "viewer";
  const hasJudgmentOverride =
    (pack.mql_leadscore_min !== null && pack.mql_leadscore_min !== undefined) ||
    (pack.target_cpr !== null && pack.target_cpr !== undefined);

  const spreadsheetRenamedFrom = pack.sheet_integration?.spreadsheet_renamed_from || null;
  const renameNotice = spreadsheetRenamedFrom ? `Renomeada: antes era ${spreadsheetRenamedFrom}.` : null;

  const handleLeavePack = async () => {
    if (!confirm(`Sair do pack "${pack.name}"? Você deixará de ver os dados dele.`)) return;
    setIsLeaving(true);
    try {
      await api.packShares.leave(pack.id);
      removePack(pack.id);
      showSuccess(`Você saiu do pack "${pack.name}".`);
    } catch (e: any) {
      showError(e);
    } finally {
      setIsLeaving(false);
    }
  };

  return (
    <>
      <DropdownMenu open={disabled ? false : undefined}>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align={align} side={side}>
          <DropdownMenuItem onClick={() => onRefresh(pack.id)} disabled={isUpdating}>
            <IconRotateClockwise className="w-4 h-4 mr-2" />
            Atualizar pack
          </DropdownMenuItem>
          {onEditDateRange && !isSharedGuest && (
            <DropdownMenuItem onClick={() => onEditDateRange(pack)} disabled={isUpdating}>
              <IconCalendarEvent className="w-4 h-4 mr-2" />
              Editar período
            </DropdownMenuItem>
          )}
          {onTranscribeAds && !isSharedGuest && (
            <DropdownMenuItem onClick={() => onTranscribeAds(pack.id, pack.name)} disabled={isUpdating}>
              <IconMicrophone className="w-4 h-4 mr-2" />
              Transcrever anúncios
            </DropdownMenuItem>
          )}
          {onEditJudgment && !isViewer && (
            <DropdownMenuItem onClick={() => onEditJudgment(pack)}>
              <IconTargetArrow className="w-4 h-4 mr-2" />
              <div className="flex flex-col items-start">
                <span>Critérios de julgamento</span>
                {hasJudgmentOverride && <span className="text-2xs text-muted-foreground">Este pack usa critérios próprios</span>}
              </div>
            </DropdownMenuItem>
          )}
          {pack.sheet_integration ? (
            <>
              <DropdownMenuItem disabled className="opacity-100">
                <IconTableExport className="w-4 h-4 mr-2 text-success" />
                <div className="flex flex-col items-start">
                  <span className="text-xs font-medium text-success">Planilha conectada</span>
                  <span className="text-xs text-muted-foreground">
                    {pack.sheet_integration.spreadsheet_name || "Planilha"} • {pack.sheet_integration.worksheet_title || "Aba"}
                  </span>
                  {/* Largura travada: o nome antigo é texto do usuário e pode ser
                      longo — sem isto ele esticaria o menu inteiro. */}
                  {renameNotice && (
                    <span title={renameNotice} className="text-2xs text-warning block max-w-[15rem] truncate">
                      {renameNotice}
                    </span>
                  )}
                </div>
              </DropdownMenuItem>
              {onEditSheetIntegration && !isSharedGuest && (
                <DropdownMenuItem onClick={() => onEditSheetIntegration(pack)}>
                  <IconPencil className="w-4 h-4 mr-2" />
                  Editar integração
                </DropdownMenuItem>
              )}
              {onDeleteSheetIntegration && !isSharedGuest && (
                <DropdownMenuItem onClick={() => onDeleteSheetIntegration(pack)} className="text-destructive focus:text-destructive focus:bg-destructive-10">
                  <IconTrash className="w-4 h-4 mr-2" />
                  Desconectar planilha
                </DropdownMenuItem>
              )}
            </>
          ) : null}
          {!isSharedGuest && (
            <DropdownMenuItem onClick={() => setIsShareDialogOpen(true)}>
              <IconUsers className="w-4 h-4 mr-2" />
              Compartilhar
            </DropdownMenuItem>
          )}
          {/* Qualquer membro lê o histórico, viewer inclusive: todos já veem os
              EFEITOS das ações, esconder o autor não protegeria nada. */}
          <DropdownMenuItem onClick={() => setIsActivityDialogOpen(true)}>
            <IconHistory className="w-4 h-4 mr-2" />
            Histórico
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {isSharedGuest ? (
            // Convidado não apaga o pack do dono — ele SAI (remove o próprio grant).
            <DropdownMenuItem onClick={handleLeavePack} disabled={isLeaving} className="text-destructive focus:text-destructive focus:bg-destructive-10">
              <IconLogout className="w-4 h-4 mr-2" />
              Sair do pack
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => onRemove(pack.id)} className="text-destructive focus:text-destructive focus:bg-destructive-10">
              <IconTrash className="w-4 h-4 mr-2" />
              Remover pack
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {!isSharedGuest && <PackShareDialog pack={pack} open={isShareDialogOpen} onOpenChange={setIsShareDialogOpen} />}
      {/* Montado só depois do primeiro clique: o feed é uma tela rara e o menu é
          renderizado dezenas de vezes na página de packs. */}
      {isActivityDialogOpen && <PackActivityDialog pack={pack} open={isActivityDialogOpen} onOpenChange={setIsActivityDialogOpen} />}
    </>
  );
}
