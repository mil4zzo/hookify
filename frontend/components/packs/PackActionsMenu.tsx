"use client";

import { useTranslations } from "next-intl";
import React, { useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconRotateClockwise, IconFolderSymlink, IconCalendarEvent, IconMicrophone, IconTargetArrow, IconTableExport, IconPencil, IconTrash, IconUsers, IconHistory, IconLogout } from "@tabler/icons-react";
import { PackActivityDialog } from "@/components/packs/PackActivityDialog";
import { PackShareDialog } from "@/components/packs/PackShareDialog";
import { api } from "@/lib/api/endpoints";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { showError, showSuccess } from "@/lib/utils/toast";
import type { AdsPack } from "@/lib/types";
import { canRedefinePack } from "@/lib/utils/folderShares";

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
  /**
   * Mover para pasta. Sem guarda de convidado de propósito: pasta é organização de
   * QUEM VÊ (o vínculo é por usuário), então o convidado arruma a tela dele sem
   * mexer no pack de ninguém — é a mesma regra do backend, que exige acesso e não posse.
   */
  onMove?: (pack: AdsPack) => void;
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
  onMove,
  onEditDateRange,
  onTranscribeAds,
  onEditJudgment,
  onEditSheetIntegration,
  onDeleteSheetIntegration,
}: PackActionsMenuProps) {
  const t = useTranslations("packs.actionsMenu");
  const { removePack } = useClientPacks();
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [isActivityDialogOpen, setIsActivityDialogOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  // A UI gateia por papel; a autorização REAL é do backend.
  const isSharedGuest = !!pack.shared_role;
  const isViewer = pack.shared_role === "viewer";
  const hasJudgmentOverride =
    (pack.mql_leadscore_min !== null && pack.mql_leadscore_min !== undefined) ||
    (pack.target_cpr !== null && pack.target_cpr !== undefined) ||
    (pack.lead_economics !== null && pack.lead_economics !== undefined);

  const spreadsheetRenamedFrom = pack.sheet_integration?.spreadsheet_renamed_from || null;
  const renameNotice = spreadsheetRenamedFrom ? t("renamedFrom", { name: spreadsheetRenamedFrom }) : null;

  const handleLeavePack = async () => {
    if (!confirm(t("leaveConfirm", { name: pack.name }))) return;
    setIsLeaving(true);
    try {
      await api.packShares.leave(pack.id);
      removePack(pack.id);
      showSuccess(t("leftOk", { name: pack.name }));
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
          <DropdownMenuItem icon={<IconRotateClockwise />} onClick={() => onRefresh(pack.id)} disabled={isUpdating}>
            {t("refresh")}
          </DropdownMenuItem>
          {onMove && (
            <DropdownMenuItem icon={<IconFolderSymlink />} onClick={() => onMove(pack)}>
              {t("moveTo")}
            </DropdownMenuItem>
          )}
          {onEditDateRange && canRedefinePack(pack) && (
            <DropdownMenuItem icon={<IconCalendarEvent />} onClick={() => onEditDateRange(pack)} disabled={isUpdating}>
              {t("editPeriod")}
            </DropdownMenuItem>
          )}
          {onTranscribeAds && !isSharedGuest && (
            <DropdownMenuItem icon={<IconMicrophone />} onClick={() => onTranscribeAds(pack.id, pack.name)} disabled={isUpdating}>
              {t("transcribe")}
            </DropdownMenuItem>
          )}
          {onEditJudgment && !isViewer && (
            <DropdownMenuItem icon={<IconTargetArrow />} description={hasJudgmentOverride ? t("judgmentOwn") : undefined} onClick={() => onEditJudgment(pack)}>
              {t("judgment")}
            </DropdownMenuItem>
          )}
          {pack.sheet_integration ? (
            <>
              <DropdownMenuItem icon={<IconTableExport className="text-success" />} disabled className="opacity-100">
                <div className="flex flex-col items-start">
                  <span className="text-xs font-medium text-success">{t("sheetConnected")}</span>
                  <span className="text-xs text-muted-foreground">
                    {pack.sheet_integration.spreadsheet_name || t("sheetFallback")} • {pack.sheet_integration.worksheet_title || t("tabFallback")}
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
                <DropdownMenuItem icon={<IconPencil />} onClick={() => onEditSheetIntegration(pack)}>
                  {t("editIntegration")}
                </DropdownMenuItem>
              )}
              {onDeleteSheetIntegration && !isSharedGuest && (
                <DropdownMenuItem icon={<IconTrash />} onClick={() => onDeleteSheetIntegration(pack)} className="text-destructive focus:text-destructive focus:bg-destructive-10">
                  {t("disconnectSheet")}
                </DropdownMenuItem>
              )}
            </>
          ) : null}
          {!isSharedGuest && (
            <DropdownMenuItem icon={<IconUsers />} onClick={() => setIsShareDialogOpen(true)}>
              {t("share")}
            </DropdownMenuItem>
          )}
          {/* Qualquer membro lê o histórico, viewer inclusive: todos já veem os
              EFEITOS das ações, esconder o autor não protegeria nada. */}
          <DropdownMenuItem icon={<IconHistory />} onClick={() => setIsActivityDialogOpen(true)}>
            {t("history")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {isSharedGuest && pack.shared_via_folder && pack.shared_role === "editor" ? (
            // Editor de uma pasta compartilhada age como o dono (181), inclusive exclui.
            <DropdownMenuItem icon={<IconTrash />} onClick={() => onRemove(pack.id)} className="text-destructive focus:text-destructive focus:bg-destructive-10">
              {t("removePack")}
            </DropdownMenuItem>
          ) : isSharedGuest && pack.shared_via_folder ? (
            // Vem pela pasta: sair só deste pack não dá — o acesso voltaria por ela.
            <DropdownMenuItem icon={<IconLogout />} disabled description={t("leaveViaFolder")}>
              {t("leavePack")}
            </DropdownMenuItem>
          ) : isSharedGuest ? (
            // Convidado não apaga o pack do dono — ele SAI (remove o próprio grant).
            <DropdownMenuItem icon={<IconLogout />} onClick={handleLeavePack} disabled={isLeaving} className="text-destructive focus:text-destructive focus:bg-destructive-10">
              {t("leavePack")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem icon={<IconTrash />} onClick={() => onRemove(pack.id)} className="text-destructive focus:text-destructive focus:bg-destructive-10">
              {t("removePack")}
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
