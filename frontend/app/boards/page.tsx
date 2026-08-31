"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconLayoutBoard } from "@tabler/icons-react";

import { AppDialog } from "@/components/common/AppDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { PackConflictGuard } from "@/components/common/PackConflictGuard";
import { PageContainer } from "@/components/common/PageContainer";
import { AnalyticsWorkspace } from "@/components/common/layout";
import { StatePanel } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { AdDetailsDialog } from "@/components/ads/AdDetailsDialog";
import { BoardGroupBand } from "@/components/boards/BoardGroupBand";
import { BoardGroupDialog, type BoardGroupDraft } from "@/components/boards/BoardGroupDialog";
import { BoardToolbar } from "@/components/boards/BoardToolbar";
import {
  useAdPerformance,
  useBoards,
  useCreateBoard,
  useCreateBoardGroup,
  useDeleteBoard,
  useDeleteBoardGroup,
  useReorderBoardGroups,
  useUpdateBoard,
  useUpdateBoardGroup,
} from "@/lib/api/hooks";
import type { RankingsItem, RankingsRequest } from "@/lib/api/schemas";
import { rowMatchesRules, type RuleNameDictionary } from "@/lib/rules/evaluate";
import { buildRuleDimensionOptions, type RuleDimensionOptions } from "@/lib/rules/dimensionOptions";
import { useProvenanceIndex } from "@/lib/manager/provenance";
import { normalizeRuleTree } from "@/lib/rules/types";
import type { Board, BoardGroup } from "@/lib/boards/types";
import { TAG_COLORS } from "@/lib/tags/colors";
import { useAppAuthReady } from "@/lib/hooks/useAppAuthReady";
import { useFilters } from "@/lib/hooks/useFilters";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";
import { usePacksLoading } from "@/components/layout/PacksLoader";
import { mapRankingRow } from "@/lib/utils/mapRankingRow";
import { formatLocaleInteger } from "@/lib/utils/currency";
import { logger } from "@/lib/utils/logger";
import { toast } from "sonner";

const ACTIVE_BOARD_STORAGE_KEY = "hookify-boards-active-id";

type RuleRow = RankingsItem & Record<string, any>;

function BoardsPageShell({ children }: { children: React.ReactNode }) {
  return (
    <PageContainer
      title="Boards"
      description="Agrupe seus criativos por regra e compare os grupos entre si"
      variant="analytics"
      className="min-h-0"
    >
      <AnalyticsWorkspace>{children}</AnalyticsWorkspace>
    </PageContainer>
  );
}

export default function BoardsPage() {
  const { isClient, authStatus, onboardingStatus, isAuthorized } = useAppAuthReady();
  const { selectedPackIds, effectiveDateRange: dateRange, actionType, actionTypeOptions, packs, packsClient } = useFilters();
  const { isLoading: packsLoading } = usePacksLoading();
  const { mqlLeadscoreMin } = useMqlLeadscore();

  const packsReady = packsClient && packs.length > 0 && !packsLoading;

  const hasSheetIntegration = useMemo(
    () => selectedPackIds.size > 0 && packs.some((pack) => selectedPackIds.has(pack.id) && !!pack.sheet_integration),
    [packs, selectedPackIds],
  );

  // ── Boards ─────────────────────────────────────────────────────────────────
  const { data: boardsData, isLoading: boardsLoading } = useBoards(isAuthorized);
  const boards = useMemo<Board[]>(
    () =>
      (boardsData?.data ?? []).map((board) => ({
        id: board.id,
        name: board.name,
        position: board.position,
        groups: (board.groups ?? []).map((group) => ({
          ...group,
          rules: normalizeRuleTree(group.rules),
        })) as BoardGroup[],
      })),
    [boardsData],
  );

  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);

  // Qual board estava aberto é preferência de sessão, não dado de negócio — por
  // isso localStorage, e não uma coluna. Um id que sumiu (board apagado noutra
  // aba) cai no primeiro em vez de deixar a tela vazia sem explicação.
  useEffect(() => {
    if (boards.length === 0) {
      setActiveBoardId(null);
      return;
    }
    setActiveBoardId((current) => {
      if (current && boards.some((board) => board.id === current)) return current;
      let stored: string | null = null;
      try {
        stored = localStorage.getItem(ACTIVE_BOARD_STORAGE_KEY);
      } catch {
        stored = null;
      }
      if (stored && boards.some((board) => board.id === stored)) return stored;
      return boards[0].id;
    });
  }, [boards]);

  useEffect(() => {
    if (!activeBoardId) return;
    try {
      localStorage.setItem(ACTIVE_BOARD_STORAGE_KEY, activeBoardId);
    } catch {
      /* modo privado / storage cheio: a preferência simplesmente não persiste */
    }
  }, [activeBoardId]);

  const activeBoard = boards.find((board) => board.id === activeBoardId) ?? null;

  const createBoard = useCreateBoard();
  const updateBoard = useUpdateBoard();
  const deleteBoard = useDeleteBoard();
  const createGroup = useCreateBoardGroup();
  const updateGroup = useUpdateBoardGroup();
  const deleteGroup = useDeleteBoardGroup();
  const reorderGroups = useReorderBoardGroups();

  const isMutating =
    createBoard.isPending ||
    updateBoard.isPending ||
    deleteBoard.isPending ||
    createGroup.isPending ||
    updateGroup.isPending ||
    deleteGroup.isPending ||
    reorderGroups.isPending;

  // ── Linhas do recorte ──────────────────────────────────────────────────────
  // Sempre agrupado por criativo (`ad_name`): as tags só existem nesse nível — a
  // RPC devolve [] nos demais — e o board é uma leitura de criativo, não de
  // veiculação. Por isso não há seletor de agrupamento nesta tela.
  const rankingsRequest: RankingsRequest = useMemo(
    () => ({
      date_start: dateRange.start || "",
      date_stop: dateRange.end || "",
      group_by: "ad_name",
      action_type: actionType || undefined,
      limit: 10000,
      offset: 0,
      filters: {},
      pack_ids: Array.from(selectedPackIds),
      include_series: false,
      include_leadscore: hasSheetIntegration,
      include_available_conversion_types: false,
    }),
    [dateRange.start, dateRange.end, actionType, selectedPackIds, hasSheetIntegration],
  );

  const {
    data: rankingsData,
    isLoading: rowsLoading,
    error: rowsError,
  } = useAdPerformance(rankingsRequest, isAuthorized && packsReady && !!dateRange.start && !!dateRange.end);

  useEffect(() => {
    const TOAST_ID = "boards-data-error";
    if (rowsError) {
      logger.error("Erro ao buscar dados dos boards:", rowsError);
      toast.error("Erro ao carregar dados. Tente reduzir o período ou selecionar menos packs.", {
        id: TOAST_ID,
        duration: Infinity,
      });
    } else {
      toast.dismiss(TOAST_ID);
    }
  }, [rowsError]);

  const rows = useMemo<RuleRow[]>(() => {
    const serverData = rankingsData?.data ?? [];
    return serverData.map((row: any) => mapRankingRow(row, actionType, "por-anuncio"));
  }, [rankingsData, actionType]);

  const provenanceIndex = useProvenanceIndex();

  const totalSpend = useMemo(() => rows.reduce((sum, row) => sum + (Number(row.spend) || 0), 0), [rows]);

  /**
   * Dicionário id → nome de campanhas e conjuntos desta resposta (migration 136).
   * A linha traz os ids; o nome vem uma vez só, na raiz. Sem ele, uma regra sobre
   * "Nome da campanha" é ignorada em vez de responder com o nome do representante.
   */
  const names = useMemo(() => (rankingsData as any)?.names as RuleNameDictionary | undefined, [rankingsData]);

  /** Opções dos campos multi-seleção: só o que existe no recorte atual. */
  const dimensionOptions = useMemo<RuleDimensionOptions>(
    () =>
      buildRuleDimensionOptions(rows, {
        packNameById: new Map(packs.map((pack) => [pack.id, pack.name])),
        accountNameById: provenanceIndex.accountNameById,
        names,
      }),
    [rows, packs, provenanceIndex, names],
  );

  /**
   * Quantos criativos do recorte caem em ALGUM grupo.
   *
   * Como os grupos são independentes e não-exclusivos, um board pode mentir por
   * omissão sem ninguém notar: regra errada = grupo vazio, que se lê como "não
   * tenho isso" em vez de "minha condição está errada". Esta linha é o contraste.
   */
  const coverage = useMemo(() => {
    if (!activeBoard || activeBoard.groups.length === 0 || rows.length === 0) {
      return { covered: 0, total: rows.length };
    }
    const context = { actionType, mqlLeadscoreMin, names };
    const rulesByGroup = activeBoard.groups.map((group) => normalizeRuleTree(group.rules));
    // Linha por fora, grupo por dentro: o `some` para no primeiro grupo que casa,
    // então o caso comum (criativo classificado) não paga as outras 19 regras.
    const covered = rows.reduce(
      (total, row) => total + (rulesByGroup.some((rules) => rowMatchesRules(row, rules, context)) ? 1 : 0),
      0,
    );
    return { covered, total: rows.length };
  }, [activeBoard, rows, actionType, mqlLeadscoreMin, names]);

  // ── Diálogos ───────────────────────────────────────────────────────────────
  const [groupDialog, setGroupDialog] = useState<{ open: boolean; group: BoardGroup | null }>({ open: false, group: null });
  const [pendingDelete, setPendingDelete] = useState<{ kind: "board" | "group"; id: string; name: string } | null>(null);
  const [selectedAd, setSelectedAd] = useState<RuleRow | null>(null);

  const handleSubmitGroup = useCallback(
    async (draft: BoardGroupDraft) => {
      if (!activeBoard) return;
      const payload = {
        name: draft.name,
        color: draft.color,
        rules: draft.rules,
        sort_metric: draft.sort_metric,
        sort_direction: draft.sort_direction,
      };
      try {
        if (groupDialog.group) {
          await updateGroup.mutateAsync({ boardId: activeBoard.id, groupId: groupDialog.group.id, patch: payload });
        } else {
          await createGroup.mutateAsync({ boardId: activeBoard.id, payload });
        }
        setGroupDialog({ open: false, group: null });
      } catch {
        /* showError já notificou no onError da mutation */
      }
    },
    [activeBoard, groupDialog.group, createGroup, updateGroup],
  );

  const handleMoveGroup = useCallback(
    (groupId: string, direction: -1 | 1) => {
      if (!activeBoard) return;
      const ids = activeBoard.groups.map((group) => group.id);
      const from = ids.indexOf(groupId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= ids.length) return;
      const next = [...ids];
      [next[from], next[to]] = [next[to], next[from]];
      reorderGroups.mutate({ boardId: activeBoard.id, groupIds: next });
    },
    [activeBoard, reorderGroups],
  );

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "board") {
      deleteBoard.mutate(pendingDelete.id);
    } else if (activeBoard) {
      deleteGroup.mutate({ boardId: activeBoard.id, groupId: pendingDelete.id });
    }
    setPendingDelete(null);
  }, [pendingDelete, activeBoard, deleteBoard, deleteGroup]);

  const dialogAverages = useMemo(() => {
    const base = (rankingsData as any)?.averages;
    if (!base) return undefined;
    const perSelected = actionType ? base.per_action_type?.[actionType] : undefined;
    return {
      hook: typeof base.hook === "number" ? base.hook : null,
      hold_rate: typeof base.hold_rate === "number" ? base.hold_rate : null,
      video_watched_p50: typeof base.video_watched_p50 === "number" ? base.video_watched_p50 : null,
      scroll_stop: typeof base.scroll_stop === "number" ? base.scroll_stop : null,
      ctr: typeof base.ctr === "number" ? base.ctr : null,
      website_ctr: typeof base.website_ctr === "number" ? base.website_ctr : null,
      connect_rate: typeof base.connect_rate === "number" ? base.connect_rate : null,
      cpm: typeof base.cpm === "number" ? base.cpm : null,
      cpr: typeof perSelected?.cpr === "number" ? perSelected.cpr : null,
      page_conv: typeof perSelected?.page_conv === "number" ? perSelected.page_conv : null,
    };
  }, [rankingsData, actionType]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!isClient || authStatus !== "authorized" || onboardingStatus === "requires_onboarding") {
    return (
      <BoardsPageShell>
        <StatePanel kind="loading" title="Carregando..." fill />
      </BoardsPageShell>
    );
  }

  // Todo loading vem ANTES de qualquer estado vazio: sem este gate, o board
  // recém-aberto pisca "nenhum board" antes da lista chegar.
  if (boardsLoading) {
    return (
      <BoardsPageShell>
        <StatePanel kind="loading" title="Carregando boards..." fill />
      </BoardsPageShell>
    );
  }

  const suggestedColor = TAG_COLORS[(activeBoard?.groups.length ?? 0) % TAG_COLORS.length];

  return (
    <BoardsPageShell>
      <BoardToolbar
        boards={boards}
        activeBoardId={activeBoardId}
        onSelectBoard={setActiveBoardId}
        onCreateBoard={async (name) => {
          const created = await createBoard.mutateAsync(name);
          if (created?.data?.id) setActiveBoardId(created.data.id);
        }}
        onRenameBoard={async (boardId, name) => {
          await updateBoard.mutateAsync({ boardId, patch: { name } });
        }}
        onDeleteBoard={(boardId) => {
          const board = boards.find((item) => item.id === boardId);
          if (board) setPendingDelete({ kind: "board", id: board.id, name: board.name });
        }}
        onCreateGroup={() => setGroupDialog({ open: true, group: null })}
        isBusy={isMutating}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <PackConflictGuard serverOverlapRows={(rankingsData as any)?.overlap?.rows ?? null}>
          {boards.length === 0 ? (
            <StatePanel
              kind="empty"
              icon={IconLayoutBoard}
              title="Nenhum board ainda"
              message="Um board é uma lente sobre os seus criativos: você cria grupos, cada grupo tem uma condição, e todo criativo do recorte que atender aparece nele. Os grupos não são exclusivos — o mesmo criativo pode estar em vários. Packs e período continuam vindo do filtro do topo, então o mesmo board serve qualquer recorte."
              fill
            />
          ) : !activeBoard ? (
            <StatePanel kind="empty" icon={IconLayoutBoard} title="Escolha um board" fill />
          ) : activeBoard.groups.length === 0 ? (
            <StatePanel
              kind="empty"
              icon={IconLayoutBoard}
              title={`"${activeBoard.name}" ainda não tem grupos`}
              message="Crie o primeiro grupo e dê a ele uma condição — por exemplo, uma tag de hook, ou CPR acima do seu alvo."
              action={
                <Button type="button" onClick={() => setGroupDialog({ open: true, group: null })}>
                  Criar primeiro grupo
                </Button>
              }
              fill
            />
          ) : rowsLoading ? (
            <StatePanel kind="loading" title="Carregando criativos..." fill />
          ) : (
            <div className="space-y-stack pb-4">
              {activeBoard.groups.map((group, index) => (
                <BoardGroupBand
                  key={group.id}
                  group={group}
                  rows={rows}
                  totalSpend={totalSpend}
                  actionType={actionType}
                  hasSheetIntegration={hasSheetIntegration}
                  mqlLeadscoreMin={mqlLeadscoreMin}
                  names={names}
                  isFirst={index === 0}
                  isLast={index === activeBoard.groups.length - 1}
                  onEdit={() => setGroupDialog({ open: true, group })}
                  onDelete={() => setPendingDelete({ kind: "group", id: group.id, name: group.name })}
                  onMove={(direction) => handleMoveGroup(group.id, direction)}
                  onOpenAd={(row) => setSelectedAd(row as RuleRow)}
                />
              ))}

              <p className="px-1 text-2xs text-muted-foreground">
                {formatLocaleInteger(coverage.total)} criativos no recorte · {formatLocaleInteger(coverage.covered)} aparecem em
                algum grupo
                {coverage.total > coverage.covered && ` · ${formatLocaleInteger(coverage.total - coverage.covered)} fora de todos`}
              </p>
            </div>
          )}
        </PackConflictGuard>
      </div>

      <BoardGroupDialog
        isOpen={groupDialog.open}
        onClose={() => setGroupDialog({ open: false, group: null })}
        group={groupDialog.group}
        suggestedColor={suggestedColor}
        dimensionOptions={dimensionOptions}
        hasSheetIntegration={hasSheetIntegration}
        isSaving={createGroup.isPending || updateGroup.isPending}
        onSubmit={handleSubmitGroup}
      />

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title={pendingDelete?.kind === "board" ? "Apagar board" : "Apagar grupo"}
        message={
          pendingDelete?.kind === "board"
            ? `Apagar "${pendingDelete.name}" e todos os seus grupos? Nenhum criativo, tag ou anúncio é afetado — o board só guarda regras.`
            : `Apagar o grupo "${pendingDelete?.name}"? Nenhum criativo é afetado.`
        }
        confirmText="Apagar"
        variant="destructive"
        onConfirm={confirmDelete}
        isLoading={deleteBoard.isPending || deleteGroup.isPending}
      />

      <AppDialog
        isOpen={selectedAd !== null}
        onClose={() => setSelectedAd(null)}
        title="Detalhes do anúncio"
        size="5xl"
        padding="md"
        className="flex h-[90dvh] min-h-0 flex-col overflow-hidden"
        bodyClassName="flex min-h-0 flex-1 flex-col"
      >
        {selectedAd && (
          <AdDetailsDialog
            ad={selectedAd}
            groupByAdName
            dateStart={dateRange.start}
            dateStop={dateRange.end}
            actionType={actionType}
            packIds={Array.from(selectedPackIds)}
            availableConversionTypes={actionTypeOptions}
            averages={dialogAverages}
          />
        )}
      </AppDialog>
    </BoardsPageShell>
  );
}
