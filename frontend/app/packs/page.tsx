"use client";

import { Fragment, useState, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { PackCard } from "@/components/packs/PackCard";
import { PackJudgmentDialog } from "@/components/packs/PackJudgmentDialog";
import { PackDateRangeDialog } from "@/components/packs/PackDateRangeDialog";
import { TranscriptionStatusDialog } from "@/components/packs/TranscriptionStatusDialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AppDialog } from "@/components/common/AppDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { DateRangeFilter, DateRangeValue } from "@/components/common/DateRangeFilter";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAdAccountsDb, useInvalidatePackAds } from "@/lib/api/hooks";
import { GoogleSheetIntegrationDialog } from "@/components/ads/GoogleSheetIntegrationDialog";
import { useClientAuth, useClientPacks } from "@/lib/hooks/useClientSession";
import { useOnboardingGate } from "@/lib/hooks/useOnboardingGate";
import { showSuccess, showError } from "@/lib/utils/toast";
import { api } from "@/lib/api/endpoints";
import { IconFilter, IconPlus, IconTrash, IconChartBar, IconSearch, IconLoader2, IconCircleCheck, IconCircleX, IconCircleDot, IconInfoCircle, IconRefresh, IconChevronLeft, IconChevronRight, IconPencil, IconFolderPlus, IconSortAscending, IconSortDescending } from "@tabler/icons-react";

import { FilterRule, ClearEnrichmentResult } from "@/lib/api/schemas";
import { AdsPack } from "@/lib/types";
import { useFormatCurrency } from "@/lib/utils/currency";
import { PageContainer } from "@/components/common/PageContainer";
import { PageActions } from "@/components/common/PageActions";
import { StatePanel, InlineNotice } from "@/components/common/States";
import { PageBodyStack } from "@/components/common/layout";
import { getTodayLocal, formatDateLocal } from "@/lib/utils/dateFilters";
import { lookbackDaysForPack, refreshUntil, sinceLastRefreshStart } from "@/lib/utils/refreshWindow";
import { useUpdatingPacksStore } from "@/lib/store/updatingPacks";
import { usePacksLoading } from "@/components/layout/PacksLoader";
import { usePackRefresh, type RefreshToggles } from "@/lib/hooks/usePackRefresh";
import { usePackCreation } from "@/lib/hooks/usePackCreation";
import { MetaIcon, GoogleSheetsIcon } from "@/components/icons";
import { logger } from "@/lib/utils/logger";
import { usePackSortStore } from "@/lib/store/packSort";
import { PACK_SORT_OPTIONS, filterPacksBySearch, sortPacks, type PackSortKey, type PackSortDirection } from "@/lib/utils/packSort";
import { useMultiSelect } from "@/lib/hooks/useMultiSelect";
import { useBulkPackDelete } from "@/lib/hooks/useBulkPackDelete";
import { BulkActionsBar, type BulkAction } from "@/components/common/BulkActionsBar";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils/cn";
import { isPackRefreshingOnServer } from "@/lib/utils/packRefreshState";
import { useFolders } from "@/lib/hooks/useFolders";
import { ALL_PACKS_VIEW, PackFolderTree, TreeRowMenuTrigger, type FolderView } from "@/components/packs/PackFolderTree";
import { FolderActionsMenu } from "@/components/packs/FolderActionsMenu";
import { PackActionsMenu } from "@/components/packs/PackActionsMenu";
import { FolderCard } from "@/components/packs/FolderCard";
import { PacksActionsSkeleton, PacksLibrarySkeleton } from "@/components/packs/PacksLibrarySkeleton";
import { FolderNameDialog } from "@/components/packs/FolderNameDialog";
import { filterFolderTree, flattenTree, folderPath, subtreeIds } from "@/lib/utils/folderTree";
import type { PackFolder } from "@/lib/types";

const STORAGE_KEY_DATE_RANGE = "hookify-packs-date-range";
const STORAGE_KEY_REFRESH_TOGGLES = "hookify:refresh-toggles";

const DEFAULT_REFRESH_TOGGLES: RefreshToggles = {
  meta: true,
  leadscore: true,
  transcription: false,
};

// Mesmas props de layout da página real, para o esqueleto ocupar o mesmo lugar.
function PacksPageSkeleton() {
  return (
    <PageContainer
      variant="standard"
      title="Biblioteca"
      description="Gerencie seus Packs de anúncios."
      contentScroll
      className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col"
      contentClassName="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col"
      actions={<PacksActionsSkeleton />}
    >
      <PageBodyStack className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <PacksLibrarySkeleton />
      </PageBodyStack>
    </PageContainer>
  );
}

// Funções auxiliares para gerenciar dateRange no localStorage
const saveDateRange = (dateRange: { start?: string; end?: string }) => {
  try {
    localStorage.setItem(STORAGE_KEY_DATE_RANGE, JSON.stringify(dateRange));
  } catch (e) {
    logger.error("Erro ao salvar dateRange no localStorage:", e);
  }
};

const loadDateRange = (): { start?: string; end?: string } | null => {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY_DATE_RANGE);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    // Validar que tem start e end
    if (parsed && typeof parsed === "object" && parsed.start && parsed.end) {
      return parsed;
    }
    return null;
  } catch (e) {
    logger.error("Erro ao carregar dateRange do localStorage:", e);
    return null;
  }
};

// Funções auxiliares para persistir preferências dos toggles de refresh
const loadRefreshToggles = (): RefreshToggles | null => {
  if (typeof window === "undefined") return null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY_REFRESH_TOGGLES);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (parsed && typeof parsed === "object" && "meta" in parsed && "leadscore" in parsed && "transcription" in parsed) {
      return {
        meta: Boolean(parsed.meta),
        leadscore: Boolean(parsed.leadscore),
        transcription: Boolean(parsed.transcription),
      };
    }
    return null;
  } catch (e) {
    logger.error("Erro ao carregar refresh toggles do localStorage:", e);
    return null;
  }
};

const saveRefreshToggles = (toggles: RefreshToggles) => {
  try {
    localStorage.setItem(STORAGE_KEY_REFRESH_TOGGLES, JSON.stringify(toggles));
  } catch (e) {
    logger.error("Erro ao salvar refresh toggles no localStorage:", e);
  }
};

interface PackFormData {
  name: string;
  adaccount_id: string;
  date_start: string;
  date_stop: string;
  level: "campaign" | "adset" | "ad";
  filters: FilterRule[];
  auto_refresh?: boolean;
}

const FILTER_FIELDS = [
  { label: "Campaign Name", value: "campaign.name" },
  { label: "Adset Name", value: "adset.name" },
  { label: "Ad Name", value: "ad.name" },
];

const FILTER_OPERATORS = ["CONTAIN", "EQUAL", "NOT_EQUAL", "NOT_CONTAIN", "STARTS_WITH", "ENDS_WITH"];

export default function PacksPage() {
  const formatCurrency = useFormatCurrency();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [packToRemove, setPackToRemove] = useState<{ id: string; name: string; adsCount: number } | null>(null);
  // Lista de ids: um pack individual é só o caso N=1, então o dialog serve aos dois fluxos.
  const [packsToRefresh, setPacksToRefresh] = useState<string[] | null>(null);
  const [refreshType, setRefreshType] = useState<"since_last_refresh" | "full_period">("since_last_refresh");
  const [refreshToggles, setRefreshToggles] = useState<RefreshToggles>(() => loadRefreshToggles() ?? DEFAULT_REFRESH_TOGGLES);
  const [packToDisableAutoRefresh, setPackToDisableAutoRefresh] = useState<{ id: string; name: string } | null>(null);
  const [isTogglingAutoRefresh, setIsTogglingAutoRefresh] = useState<string | null>(null);
  const [transcriptionDialogPack, setTranscriptionDialogPack] = useState<{ id: string; name: string } | null>(null);
  const { isPackUpdating } = useUpdatingPacksStore();
  const { refreshPack, isRefreshing, startTranscriptionOnly } = usePackRefresh();
  // Pasta aberta quando a criação começou: o pack nasce solto no servidor, então é
  // movido para ela ao terminar. Ref (não estado) porque o job termina depois, e a
  // vista pode ter mudado no meio — vale a pasta de onde o usuário pediu.
  const creationFolderRef = useRef<string | null>(null);
  const { startCreation, isCreating } = usePackCreation({
    onComplete: ({ packId }) => {
      const folderId = creationFolderRef.current;
      creationFolderRef.current = null;
      if (folderId) void movePacks([packId], folderId);
      setFormData((prev) => ({
        ...prev,
        name: getNextPackName(),
        filters: [],
        auto_refresh: false,
      }));
    },
  });
  const [sheetIntegrationPack, setSheetIntegrationPack] = useState<any | null>(null);
  const [packToRemoveIntegration, setPackToRemoveIntegration] = useState<AdsPack | null>(null);
  /**
   * Prévia do leadscore que será apagado junto com a integração. Buscada ao
   * abrir o diálogo: desconectar e apagar viraram UMA ação, e o número precisa
   * estar na tela antes de confirmar.
   */
  const [removeIntegrationPreview, setRemoveIntegrationPreview] = useState<ClearEnrichmentResult | null>(null);
  const [isLoadingRemovePreview, setIsLoadingRemovePreview] = useState(false);
  const [isRemovingIntegration, setIsRemovingIntegration] = useState(false);
  const [judgmentPack, setJudgmentPack] = useState<AdsPack | null>(null);
  const [dateRangePack, setDateRangePack] = useState<AdsPack | null>(null);

  // Função auxiliar para obter "hoje - 2 dias" no formato YYYY-MM-DD
  const getTwoDaysAgoLocal = (): string => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    return formatDateLocal(twoDaysAgo);
  };

  // Carregar dateRange do localStorage ou usar valores padrão
  const getInitialDateRange = () => {
    const saved = loadDateRange();
    if (saved) {
      return {
        date_start: saved.start || getTwoDaysAgoLocal(),
        date_stop: saved.end || getTodayLocal(),
      };
    }
    return {
      date_start: getTwoDaysAgoLocal(),
      date_stop: getTodayLocal(),
    };
  };

  const initialDateRange = getInitialDateRange();

  // Função auxiliar para gerar nome do pack com formatação
  const getNextPackName = () => {
    const nextNumber = packs.length + 1;
    return `Pack ${nextNumber.toString().padStart(2, "0")}`;
  };

  const [formData, setFormData] = useState<PackFormData>({
    name: "", // Será atualizado pelo useEffect quando o modal abrir
    adaccount_id: "",
    date_start: initialDateRange.date_start,
    date_stop: initialDateRange.date_stop,
    level: "ad", // Sempre "ad" - mantido apenas para compatibilidade com tipos
    filters: [],
    auto_refresh: initialDateRange.date_stop === getTodayLocal(), // Ativado se a data final for hoje
  });
  const [packNameDuplicateError, setPackNameDuplicateError] = useState(false);

  // Store hooks
  const { isClient } = useClientAuth();
  const { packs, removePack, updatePack } = useClientPacks();
  const { authStatus, onboardingStatus } = useOnboardingGate("app");
  const { invalidatePackAds, invalidateAdPerformance } = useInvalidatePackAds();
  const { deletePacks, isDeleting: isBulkDeleting } = useBulkPackDelete();
  const { isLoading: isLoadingPacks } = usePacksLoading();

  // API hooks
  // Habilitado sempre (não só com o modal aberto): os cards de pack usam o nome da conta de origem.
  const { data: adAccountsData = [], isLoading: adAccountsLoading } = useAdAccountsDb({
    populateStore: false,
  });

  // Mapa adaccount_id → nome, para exibir a conta de origem em cada card de pack.
  const adAccountNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const account of adAccountsData) {
      if (account?.id) map.set(account.id, account.name);
    }
    return map;
  }, [adAccountsData]);

  // Busca é efêmera (some ao sair da página); a ordenação é preferência persistida.
  const [packSearch, setPackSearch] = useState("");
  const packSortKey = usePackSortStore((state) => state.sortKey);
  const packSortDirection = usePackSortStore((state) => state.direction);
  const setPackSortKey = usePackSortStore((state) => state.setSortKey);
  const setPackSortDirection = usePackSortStore((state) => state.setDirection);

  // Lista ordenada COMPLETA (sem busca e sem recorte de pasta): a seleção pode conter
  // packs que a busca escondeu ou que estão em outra pasta, e eles precisam de uma
  // ordem definida na hora de agir. O recorte da tela vive em `packsInView`.
  const sortLabel = PACK_SORT_OPTIONS.find((option) => option.value === packSortKey)?.label ?? "";

  const sortedPacks = useMemo(() => sortPacks(packs, packSortKey, { accountNameById: adAccountNameById, direction: packSortDirection }), [packs, packSortKey, packSortDirection, adAccountNameById]);

  const isSearching = packSearch.trim().length > 0;
  // Com 0 ou 1 pack a barra é só ruído — nada a buscar, ordenar ou selecionar.
  const showPacksToolbar = !isLoadingPacks && packs.length > 1;

  // ── Pastas (migration 168) ────────────────────────────────────────────────
  // O agrupamento é derivado no cliente sobre os packs que a página já carregou.
  const { rootBuckets, buckets, bucketById, loosePacks, folderIdByPack, isLoading: isLoadingFolders, createFolder, renameFolder, deleteFolder, moveFolder, movePacks, undoMove } = useFolders(packs);
  // A Biblioteca só é desenhada com packs E pastas na mão: sem esperar as pastas, a
  // grade mostrava todos os packs soltos por um instante e eles "pulavam" para dentro.
  const isLoadingLibrary = isLoadingPacks || isLoadingFolders;
  const [folderView, setFolderView] = useState<FolderView>(null);
  const [draggingPackIds, setDraggingPackIds] = useState<string[]>([]);
  // Pasta sendo arrastada — na árvore ou num tile; os dois lados leem daqui.
  const [draggingFolderId, setDraggingFolderId] = useState<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  // `parentId` só na criação: onde a pasta nova nasce (null = raiz).
  const [folderDialog, setFolderDialog] = useState<{ mode: "create" | "rename"; folder?: PackFolder; packIds: string[]; parentId?: string | null } | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<PackFolder | null>(null);

  const currentBucket = useMemo(() => (folderView && folderView !== ALL_PACKS_VIEW ? bucketById.get(folderView) ?? null : null), [bucketById, folderView]);

  // Pasta apagada em outra aba deixaria a tela vazia e sem saída — volta para a raiz.
  useEffect(() => {
    if (folderView === ALL_PACKS_VIEW ? buckets.length === 0 : folderView && !buckets.some((b) => b.folder.id === folderView)) setFolderView(null);
  }, [folderView, buckets]);

  // A busca procura na Biblioteca INTEIRA, qualquer que seja a vista: quem digita
  // "EI.27" quer os EI.27 das três pastas, não só os da pasta aberta. Por isso,
  // buscando, a grade é a de "Todos os packs"; limpar a busca devolve a vista de antes.
  const gridView: FolderView = isSearching ? ALL_PACKS_VIEW : folderView;
  const isAllView = gridView === ALL_PACKS_VIEW;
  // Pasta onde um pack criado agora vai parar (a aberta; buscando, nenhuma).
  const creationFolder = gridView && !isAllView ? currentBucket?.folder ?? null : null;

  // O universo da tela: na raiz, os packs SOLTOS (os em pasta estão colapsados nela);
  // dentro de uma pasta, só os dela; em "Todos", todos. A busca filtra por cima.
  const packsInView = useMemo(() => {
    if (gridView === ALL_PACKS_VIEW) return filterPacksBySearch(sortedPacks, packSearch, { accountNameById: adAccountNameById });
    const base = gridView ? currentBucket?.packs ?? [] : loosePacks;
    const ordered = sortPacks(base, packSortKey, { accountNameById: adAccountNameById, direction: packSortDirection });
    return filterPacksBySearch(ordered, packSearch, { accountNameById: adAccountNameById });
  }, [gridView, sortedPacks, currentBucket, loosePacks, packSortKey, packSortDirection, adAccountNameById, packSearch]);

  /**
   * Árvore filtrada pela busca: a pasta fica se ELA casa, se algum pack dela casa ou
   * se alguma subpasta ficou — assim as pastas acima de um resultado fundo continuam
   * na tela, e dá para ver onde ele está. Os packs listados são só os que casam.
   */
  const treeRoots = useMemo(() => {
    const term = packSearch.trim();
    if (!term) return rootBuckets;
    const lowered = term.toLocaleLowerCase("pt-BR");
    const matched = new Set(filterPacksBySearch(packs, term, { accountNameById: adAccountNameById }).map((p) => p.id));
    return filterFolderTree(rootBuckets, (p) => matched.has(p.id), (f) => f.name.toLocaleLowerCase("pt-BR").includes(lowered));
  }, [rootBuckets, packs, packSearch, adAccountNameById]);

  const treeLoosePacks = useMemo(
    () => filterPacksBySearch(loosePacks, packSearch, { accountNameById: adAccountNameById }),
    [loosePacks, packSearch, adAccountNameById],
  );

  /**
   * Tiles de pasta da grade: na raiz, as de primeiro nível; dentro de uma pasta, as
   * subpastas dela; em "Todos", nenhum (é a lista corrida). Buscando, as pastas que
   * são RESULTADO — nome que casa ou pack direto que casa; as que só ficaram na
   * árvore por serem caminho até um resultado não viram tile. A contagem é a cheia:
   * o tile é o resumo da pasta, não a lista de resultados.
   */
  const folderTiles = useMemo(() => {
    if (isSearching) {
      const lowered = packSearch.trim().toLocaleLowerCase("pt-BR");
      return flattenTree(treeRoots)
        .filter((node) => node.packs.length > 0 || node.folder.name.toLocaleLowerCase("pt-BR").includes(lowered))
        .map((node) => bucketById.get(node.folder.id) ?? node);
    }
    if (folderView === null) return rootBuckets;
    if (folderView === ALL_PACKS_VIEW) return [];
    return currentBucket?.children ?? [];
  }, [isSearching, packSearch, treeRoots, bucketById, folderView, rootBuckets, currentBucket]);

  // Da raiz até a pasta aberta — o caminho no topo da grade.
  const currentPath = useMemo(() => folderPath(bucketById, currentBucket?.folder.id ?? null), [bucketById, currentBucket]);
  // Onde uma pasta nova nasce: dentro da aberta (como "Nova pasta" num gerenciador de
  // arquivos); na raiz, em "Todos" e durante a busca.
  const newFolderParentId = !isSearching && currentBucket ? currentBucket.folder.id : null;

  // Selecionável = o que está visível (a busca define o universo do "selecionar todos").
  const visiblePackIds = useMemo(() => packsInView.map((p) => p.id), [packsInView]);
  const {
    selectedKeys: selectedPackKeys,
    selectedCount: selectedPackCount,
    allSelected: allPacksSelected,
    isSelected: isPackSelected,
    toggleOne: togglePack,
    toggleAll: toggleAllPacks,
    handleCheckboxClick: handlePackCheckboxClick,
    clear: clearPackSelection,
  } = useMultiSelect(visiblePackIds);

  // TODA a seleção (inclusive o que a busca escondeu), na ordem da tela — senão o contador
  // da barra prometeria N packs e a ação rodaria em menos.
  const selectedPacksList = useMemo(() => sortedPacks.filter((p) => selectedPackKeys.has(p.id)), [sortedPacks, selectedPackKeys]);
  const selectedPackIds = useMemo(() => selectedPacksList.map((p) => p.id), [selectedPacksList]);

  const selectedPacksWithSheets = useMemo(() => selectedPacksList.filter((p) => !!p.sheet_integration?.id), [selectedPacksList]);

  /**
   * Desconecta a planilha de vários packs, um de cada vez. O pack em si fica
   * intacto — mas o leadscore importado sai junto, como na ação individual.
   * Limpar ANTES de deletar: a limpeza descobre o pack a partir da integração.
   */
  const handleBulkRemoveSheetIntegration = async () => {
    const targets = selectedPacksWithSheets;
    if (targets.length === 0) return;

    const failed: string[] = [];
    let totalCleared = 0;
    for (const pack of targets) {
      try {
        const integrationId = pack.sheet_integration!.id;
        // A rota de exclusão apaga o leadscore antes de desconectar e devolve
        // quantos dias saíram — a ordem é garantia do backend, não da tela.
        totalCleared += (await api.integrations.google.deleteSheetIntegration(integrationId)).rows_cleared;
        updatePack(pack.id, { sheet_integration: undefined });
      } catch (error) {
        logger.error(`Erro ao remover integração do pack ${pack.id}:`, error);
        failed.push(pack.name);
      }
    }

    clearPackSelection();
    if (totalCleared > 0) {
      invalidateAdPerformance();
      await Promise.all(targets.map((p) => invalidatePackAds(p.id).catch(() => {})));
    }
    if (failed.length === 0) {
      showSuccess(
        `Planilha desconectada de ${targets.length} ${targets.length === 1 ? "pack" : "packs"}` +
          (totalCleared > 0 ? `, com o leadscore apagado de ${totalCleared.toLocaleString()} dias.` : "."),
      );
    } else {
      showError({ message: `Falha ao desconectar a planilha de: ${failed.join(", ")}.` });
    }
  };

  /** Arrastar um pack que está selecionado leva a seleção inteira. */
  const handlePackDragStart = (packId: string) => (event: React.DragEvent<HTMLDivElement>) => {
    const ids = selectedPackKeys.has(packId) && selectedPackCount > 1 ? Array.from(selectedPackKeys) : [packId];
    setDraggingPackIds(ids);
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setData("text/plain", ids.join(","));
    } catch {
      // Firefox exige setData para iniciar o arrasto; se falhar, o estado local basta.
    }
  };

  const handlePackDragEnd = () => {
    setDraggingPackIds([]);
    setDropTargetFolderId(null);
  };

  // Onde a pasta arrastada NÃO pode cair: nela mesma e em qualquer descendente.
  const folderDragForbidden = useMemo(() => {
    const node = draggingFolderId ? bucketById.get(draggingFolderId) : undefined;
    return node ? subtreeIds(node) : new Set<string>();
  }, [draggingFolderId, bucketById]);

  const handleFolderDragEnd = () => {
    setDraggingFolderId(null);
    setDropTargetFolderId(null);
    setLevelDropTarget(null);
  };

  /**
   * Soltar num NÍVEL (voltar, caminho no topo): a pasta ou os packs sobem para ele.
   * `null` = a raiz. Pasta vai para o fim do nível ("dentro"); na raiz, que não é
   * pasta, entra depois da pasta de primeiro nível de onde veio.
   */
  const [levelDropTarget, setLevelDropTarget] = useState<string | null>(null);
  const levelDropProps = (levelId: string | null) => {
    const key = levelId ?? "__root__";
    const canTake = () => {
      if (draggingFolderId) return !(levelId && folderDragForbidden.has(levelId)) && (bucketById.get(draggingFolderId)?.folder.parent_id ?? null) !== levelId;
      return draggingPackIds.length > 0;
    };
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!canTake()) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setLevelDropTarget(key);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setLevelDropTarget(null);
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setLevelDropTarget(null);
        if (draggingFolderId) {
          const dragged = draggingFolderId;
          handleFolderDragEnd();
          if (levelId) void moveFolder(dragged, levelId, "inside");
          else {
            const top = folderPath(bucketById, dragged)[0];
            if (top && top.folder.id !== dragged) void moveFolder(dragged, top.folder.id, "after");
          }
        } else {
          void handleDropPacks(levelId);
        }
      },
      isTarget: levelDropTarget === key,
    };
  };

  /** Solta os packs arrastados. `folderId` nulo tira da pasta. */
  const handleDropPacks = async (folderId: string | null) => {
    const ids = draggingPackIds;
    setDraggingPackIds([]);
    setDropTargetFolderId(null);
    if (!ids.length) return;
    // Soltar onde já estava não é movimento — não vale toast nem escrita.
    if (ids.every((id) => (folderIdByPack[id] ?? null) === folderId)) return;

    const result = await movePacks(ids, folderId);
    if (!result) return;
    clearPackSelection();

    const targetName = folderId ? bucketById.get(folderId)?.folder.name : null;
    const label = targetName
      ? `${ids.length} ${ids.length === 1 ? "pack movido" : "packs movidos"} para “${targetName}”`
      : `${ids.length} ${ids.length === 1 ? "pack retirado" : "packs retirados"} da pasta`;

    // Arrasto erra em silêncio — solta na pasta vizinha e ninguém percebe. O
    // "Desfazer" é o que torna o gesto seguro o bastante para existir.
    showSuccess(
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {label}
        <button type="button" onClick={() => undoMove(result.packIds, result.before)} className="focus-inset rounded-sm font-semibold underline underline-offset-2">
          Desfazer
        </button>
      </span>,
    );
  };

  /** Clique num pack da árvore: abre a pasta dele (ou a raiz) e rola até o card. */
  const handleSelectPackFromTree = (packId: string) => {
    const target = folderIdByPack[packId] ?? null;
    // Em "Todos" o card já está na grade: não há para onde ir.
    if (folderView !== ALL_PACKS_VIEW && target !== folderView) {
      setFolderView(target);
      clearPackSelection();
    }
    setPackSearch("");
    // Depois do render: o card pode não existir ainda quando a vista muda.
    requestAnimationFrame(() => {
      document.getElementById(`pack-card-${packId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const handleRefreshFolder = (folder: PackFolder) => {
    // Com as subpastas (decisão de produto: a pasta responde pelo conteúdo inteiro).
    const ids = bucketById.get(folder.id)?.allPacks.map((p) => p.id) ?? [];
    if (!ids.length) return;
    setPacksToRefresh(ids);
    setRefreshType("since_last_refresh");
  };

  const handleConfirmDeleteFolder = async () => {
    const folder = folderToDelete;
    setFolderToDelete(null);
    if (!folder) return;
    // O conteúdo sobe para a pasta de cima — é para lá que a vista vai junto.
    if (folderView === folder.id) setFolderView(folder.parent_id ?? null);
    await deleteFolder(folder.id);
  };

  const handleBulkDeletePacks = async () => {
    const targets = selectedPacksList.map((p) => ({ id: p.id, name: p.name }));
    clearPackSelection();
    await deletePacks(targets);
  };

  // Sem useMemo: os handlers acima são recriados a cada render de qualquer forma, e a barra
  // não é memoizada — memoizar aqui só exigiria suprimir o lint de deps sem ganho nenhum.
  const packBulkActions: BulkAction[] = [
    {
      id: "refresh",
      label: "Atualizar",
      icon: <IconRefresh className="h-3.5 w-3.5" />,
      className: "hover:bg-success hover:text-success-foreground",
      // Sem confirm: o próprio dialog de atualização é a confirmação, e ele traz as opções.
      onSelect: () => {
        setPacksToRefresh(selectedPackIds);
        setRefreshType("since_last_refresh");
      },
    },
    {
      id: "remove-sheets",
      label: "Desconectar planilha",
      icon: <GoogleSheetsIcon className="h-3.5 w-3.5" />,
      disabled: selectedPacksWithSheets.length === 0,
      confirm: {
        title: () => `Desconectar a planilha de ${selectedPacksWithSheets.length} ${selectedPacksWithSheets.length === 1 ? "pack" : "packs"}?`,
        // Em massa não há prévia por pack (seriam N idas ao servidor antes de
        // abrir o diálogo): o texto diz o que vai acontecer e o total sai depois.
        message: () => "Os packs continuam existindo e a planilha no Google não é alterada. O leadscore já importado por essas planilhas é apagado junto, e não há como desfazer.",
        confirmText: "Desconectar e apagar",
        variant: "destructive",
        icon: <GoogleSheetsIcon className="h-5 w-5" />,
      },
      onSelect: handleBulkRemoveSheetIntegration,
    },
    {
      id: "delete",
      label: "Deletar",
      icon: <IconTrash className="h-3.5 w-3.5" />,
      className: "hover:bg-destructive hover:text-destructive-foreground",
      showsLoading: true,
      confirm: {
        title: (count, noun) => `Deletar ${count} ${noun}?`,
        message: (count, noun) =>
          `Os anúncios e métricas exclusivos ${count === 1 ? "deste" : "destes"} ${noun} serão apagados, e a integração com o Google Sheets de cada um é removida junto (planilhas de outros packs não são afetadas). Os packs são deletados um de cada vez. Esta ação não pode ser desfeita.`,
        confirmText: "Deletar",
        variant: "destructive",
        icon: <IconTrash className="h-5 w-5" />,
      },
      onSelect: handleBulkDeletePacks,
    },
  ];

  // Para o modal de refresh: habilita botão Confirmar apenas se ao menos um processo estiver selecionado
  const refreshModalPacks = useMemo(() => (packsToRefresh ? (packsToRefresh.map((id) => packs.find((p) => p.id === id)).filter(Boolean) as AdsPack[]) : []), [packsToRefresh, packs]);
  const isBulkRefresh = refreshModalPacks.length > 1;
  // Em lote, basta UM pack com planilha para o toggle fazer sentido; quem não tem, pula essa perna.
  const hasSheetIntegrationInModal = refreshModalPacks.some((p) => !!p.sheet_integration?.id);
  const canConfirmRefresh = refreshToggles.meta || (refreshToggles.leadscore && hasSheetIntegrationInModal) || refreshToggles.transcription;

  // Update pack name when packs change or modal opens
  useEffect(() => {
    if (isDialogOpen) {
      setPackNameDuplicateError(false);
      const nextNumber = packs.length + 1;
      const packName = `Pack ${nextNumber.toString().padStart(2, "0")}`;
      // Manter o dateRange salvo no localStorage ao abrir o modal
      const savedDateRange = loadDateRange();
      const today = getTodayLocal();
      const twoDaysAgo = getTwoDaysAgoLocal();
      setFormData((prev) => ({
        ...prev,
        name: packName,
        date_start: savedDateRange?.start || twoDaysAgo,
        date_stop: savedDateRange?.end || today,
        // Ativa automaticamente se a data final for hoje
        auto_refresh: (savedDateRange?.end || today) === getTodayLocal(),
      }));
    }
  }, [packs.length, isDialogOpen]);

  // Packs são carregados globalmente pelo PacksLoader - não precisa carregar aqui
  // Dados de integrações já vêm junto com os packs (via sheet_integration)

  // Handle opening dialog from URL parameter or custom event
  useEffect(() => {
    if (!isClient) return;

    // Check URL parameter
    const params = new URLSearchParams(window.location.search);
    if (params.get("openDialog") === "true") {
      setIsDialogOpen(true);
      // Remove parameter from URL without page reload
      const url = new URL(window.location.href);
      url.searchParams.delete("openDialog");
      window.history.replaceState({}, "", url.toString());
    }

    // Listen for custom event from Topbar
    const handleOpenDialog = () => {
      setIsDialogOpen(true);
    };

    window.addEventListener("openLoadPackDialog", handleOpenDialog);

    return () => {
      window.removeEventListener("openLoadPackDialog", handleOpenDialog);
    };
  }, [isClient]);

  const handleAddFilter = () => {
    setFormData((prev) => ({
      ...prev,
      filters: [...prev.filters, { field: "campaign.name", operator: "CONTAIN", value: "" }],
    }));
  };

  const handleRemoveFilter = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      filters: prev.filters.filter((_, i) => i !== index),
    }));
  };

  const handleFilterChange = (index: number, field: keyof FilterRule, value: string) => {
    setFormData((prev) => ({
      ...prev,
      filters: prev.filters.map((filter, i) => (i === index ? { ...filter, [field]: value } : filter)),
    }));
  };

  const validateForm = (): string | null => {
    if (!formData.name.trim()) {
      return "Nome do pack é obrigatório";
    }
    if (!formData.adaccount_id) {
      return "Selecione uma conta de anúncios";
    }
    if (!formData.date_start || !formData.date_stop) {
      return "Selecione o período de datas";
    }
    if (new Date(formData.date_start) > new Date(formData.date_stop)) {
      return "Data de início deve ser anterior à data de fim";
    }

    // Validate filters
    for (const filter of formData.filters) {
      if (!filter.value.trim()) {
        return "Todos os filtros devem ter um valor";
      }
    }

    return null;
  };

  const handleLoadPack = async () => {
    const validationError = validateForm();
    if (validationError) {
      showError({ message: validationError });
      return;
    }

    const packName = formData.name.trim() || getNextPackName();

    // Verificar nome duplicado
    const existingPack = packs.find((p) => p.name.trim().toLowerCase() === packName.toLowerCase());
    if (existingPack) {
      setPackNameDuplicateError(true);
      showError({ message: `Já existe um pack com o nome "${packName}"` });
      return;
    }

    try {
      creationFolderRef.current = creationFolder?.id ?? null;
      const result = await startCreation({
        adaccount_id: formData.adaccount_id,
        date_start: formData.date_start,
        date_stop: formData.date_stop,
        level: "ad",
        limit: 1000,
        filters: formData.filters,
        name: packName,
        auto_refresh: formData.auto_refresh || false,
        today_local: getTodayLocal(),
      });

      if (result) {
        // Job iniciado — fechar modal, o progresso segue no toast
        setIsDialogOpen(false);
      } else {
        creationFolderRef.current = null;
      }
    } catch (error) {
      creationFolderRef.current = null;
      logger.error("packs/page: erro ao iniciar criação do pack", error);
      showError(error as any);
    }
  };

  const handleRemovePack = async (packId: string) => {
    const pack = packs.find((p) => p.id === packId);
    if (!pack) return;

    let adsCount = pack.stats?.uniqueAds || 0;

    if (adsCount === 0 && !pack.stats) {
      try {
        const response = await api.analytics.getPack(packId, false);
        if (response.success && response.pack?.stats) {
          adsCount = response.pack.stats.uniqueAds || 0;
        }
      } catch (error) {
        logger.error("Erro ao buscar stats do pack:", error);
        adsCount = 0;
      }
    }

    setPackToRemove({
      id: pack.id,
      name: pack.name,
      adsCount,
    });
  };

  const confirmRemovePack = async () => {
    if (!packToRemove || isDeleting) return;

    setIsDeleting(true);
    try {
      await api.analytics.deletePack(packToRemove.id, []);
      removePack(packToRemove.id);
      await invalidatePackAds(packToRemove.id);
      invalidateAdPerformance();

      showSuccess(`Pack "${packToRemove.name}" removido com sucesso!`);
      setPackToRemove(null);
    } catch (error) {
      logger.error("Erro ao deletar pack do Supabase:", error);
      removePack(packToRemove.id);
      await invalidatePackAds(packToRemove.id).catch(() => {});
      invalidateAdPerformance();

      showError({ message: `Pack removido localmente, mas houve erro ao deletar do servidor: ${error}` });
      setPackToRemove(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const cancelRemovePack = () => {
    if (isDeleting) return;
    setPackToRemove(null);
  };

  const formatDate = (dateString: string) => {
    const [year, month, day] = dateString.split("-");
    return `${day}/${month}/${year}`;
  };

  const handleRefreshPack = (packId: string) => {
    const pack = packs.find((p) => p.id === packId);
    if (!pack) return;

    setPacksToRefresh([pack.id]);
    // Resetar para opção padrão (desde última atualização)
    setRefreshType("since_last_refresh");
  };

  const handleToggleAutoRefresh = (packId: string, newValue: boolean) => {
    const pack = packs.find((p) => p.id === packId);
    if (!pack) return;

    // Se está tentando desativar, mostrar modal de confirmação
    if (!newValue && pack.auto_refresh) {
      setPackToDisableAutoRefresh({
        id: pack.id,
        name: pack.name,
      });
      return;
    }

    // Se está ativando, fazer diretamente
    confirmToggleAutoRefresh(packId, newValue);
  };

  const cancelDisableAutoRefresh = () => {
    if (isTogglingAutoRefresh) return; // Não permite cancelar durante a atualização
    setPackToDisableAutoRefresh(null);
  };

  const confirmToggleAutoRefresh = async (packId: string, newValue: boolean) => {
    const pack = packs.find((p) => p.id === packId);
    if (!pack) return;

    setIsTogglingAutoRefresh(packId);
    try {
      await api.analytics.updatePackAutoRefresh(packId, newValue);

      // Atualizar pack no store local
      updatePack(packId, {
        auto_refresh: newValue,
      } as Partial<AdsPack>);

      showSuccess(`Auto-refresh ${newValue ? "ativado" : "desativado"} para o pack "${pack.name}"`);

      // Fechar modal se estiver aberto
      if (packToDisableAutoRefresh?.id === packId) {
        setPackToDisableAutoRefresh(null);
      }
    } catch (error) {
      logger.error("Erro ao atualizar auto_refresh:", error);
      showError({ message: `Erro ao ${newValue ? "ativar" : "desativar"} auto-refresh: ${error}` });
    } finally {
      setIsTogglingAutoRefresh(null);
    }
  };

  const handleConfirmTranscription = (adNames: string[]) => {
    if (!transcriptionDialogPack) return;
    const { id, name } = transcriptionDialogPack;
    setTranscriptionDialogPack(null);
    startTranscriptionOnly(id, name, adNames);
  };

  const handleForceTranscription = (adNames: string[]) => {
    if (!transcriptionDialogPack) return;
    const { id, name } = transcriptionDialogPack;
    setTranscriptionDialogPack(null);
    startTranscriptionOnly(id, name, adNames, { forceNoAudio: true });
  };

  const cancelRefreshPack = () => {
    // Não permite cancelar se algum dos packs do modal já está atualizando
    if (refreshModalPacks.some((p) => isRefreshing(p.id))) return;
    setPacksToRefresh(null);
    setRefreshType("since_last_refresh"); // Resetar para padrão
  };

  /**
   * Confirma e executa o refresh usando o hook centralizado.
   *
   * Em lote não há nada de especial: dispara um refresh por pack, exatamente como
   * se o usuário tivesse clicado um a um. A fila do usePackRefresh
   * (REFRESH_MAX_CONCURRENCY = 1) serializa o trabalho pesado, e o hook já ignora
   * pack que esteja em refresh. O allSettled só evita rejeição não tratada.
   */
  const confirmRefreshPack = async () => {
    const targets = refreshModalPacks;
    if (targets.length === 0) return;

    // Persistir preferência dos toggles para a próxima abertura do modal
    saveRefreshToggles(refreshToggles);

    // Fechar modal imediatamente após confirmar
    setPacksToRefresh(null);
    clearPackSelection();

    await Promise.allSettled(
      targets.map((pack) =>
        refreshPack({
          packId: pack.id,
          packName: pack.name,
          refreshType,
          sheetIntegrationId: pack.sheet_integration?.id,
          // Leadscore só conta para quem tem planilha — os demais rodam só o Meta.
          toggles: { ...refreshToggles, leadscore: refreshToggles.leadscore && !!pack.sheet_integration?.id },
        }),
      ),
    );
  };

  const handleEditSheetIntegration = (pack: AdsPack) => {
    setSheetIntegrationPack(pack);
  };

  /**
   * Desconectar a planilha. Abre o diálogo já com a prévia do que será apagado:
   * a limpeza do leadscore deixou de ser uma ação separada porque, uma vez
   * desconectada a planilha, não haveria mais nenhuma porta para limpar o que
   * ficou órfão — o item de menu vivia na integração que acabou de sumir.
   */
  const handleDeleteSheetIntegration = async (pack: AdsPack) => {
    const integrationId = pack.sheet_integration?.id;
    if (!integrationId) return;
    setPackToRemoveIntegration(pack);
    setRemoveIntegrationPreview(null);
    setIsLoadingRemovePreview(true);
    try {
      setRemoveIntegrationPreview(await api.integrations.google.previewSheetEnrichmentClear(integrationId));
    } catch (error) {
      // A prévia é informativa: sem ela o diálogo ainda funciona, só não mostra
      // os números. Não vale bloquear a desconexão por causa disso.
      logger.warn("Não foi possível prever o leadscore a apagar:", error);
    } finally {
      setIsLoadingRemovePreview(false);
    }
  };

  const confirmRemoveSheetIntegration = async () => {
    const pack = packToRemoveIntegration;
    const integrationId = pack?.sheet_integration?.id;
    if (!pack || !integrationId) return;

    setIsRemovingIntegration(true);
    let cleared = 0;
    try {
      // A rota de exclusão apaga o leadscore com o vínculo ainda de pé e só
      // então desconecta; se a limpeza falhar, nada é desconectado.
      cleared = (await api.integrations.google.deleteSheetIntegration(integrationId)).rows_cleared;
      updatePack(pack.id, { sheet_integration: undefined });
      setPackToRemoveIntegration(null);
      if (cleared > 0) {
        // O leadscore saiu do banco; sem invalidar, Manager e Insights seguem
        // servindo MQL/CPMQL calculados com o dado que acabou de ser apagado.
        invalidateAdPerformance();
        await invalidatePackAds(pack.id);
        showSuccess(`Integração removida e leadscore apagado de ${cleared.toLocaleString()} ${cleared === 1 ? "dia" : "dias"}.`);
      } else {
        showSuccess("Integração removida com sucesso!");
      }
    } catch (error) {
      showError(error instanceof Error ? error : new Error("Erro ao remover integração"));
    } finally {
      setIsRemovingIntegration(false);
    }
  };

  // Client-side only rendering
  if (!isClient) {
    return <PacksPageSkeleton />;
  }

  if (authStatus !== "authorized") {
    return <PacksPageSkeleton />;
  }

  if (onboardingStatus === "requires_onboarding") {
    return <PacksPageSkeleton />;
  }

  return (
    <>
      <PageContainer
        variant="standard"
        title="Biblioteca"
        description="Gerencie seus Packs de anúncios."
        // A partir de `lg` quem rola é a grade de packs, não a página: cabeçalho,
        // ações e explorer ficam sempre visíveis. Abaixo disso a página rola normal.
        contentScroll
        className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col"
        contentClassName="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col"
        actions={
          <PageActions>
            {showPacksToolbar && (
              // Um controle só. Antes eram dois — um seletor de campo e um botão de
              // direção — e ninguém lia os dois como a mesma decisão. Aqui todo estado
              // é EXPLÍCITO no menu: nada de "clique de novo no campo ativo para
              // inverter", que é o truque do Finder e que ninguém descobre sozinho.
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label={`Ordenar packs: ${sortLabel}, ${packSortDirection === "asc" ? "crescente" : "decrescente"}`} title={`Ordenar: ${sortLabel}`}>
                    {packSortDirection === "asc" ? <IconSortAscending className="h-4 w-4" /> : <IconSortDescending className="h-4 w-4" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Ordenar por</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={packSortKey} onValueChange={(value) => setPackSortKey(value as PackSortKey)}>
                    {PACK_SORT_OPTIONS.map((option) => (
                      <DropdownMenuRadioItem key={option.value} value={option.value}>
                        {option.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuRadioGroup value={packSortDirection} onValueChange={(value) => setPackSortDirection(value as PackSortDirection)}>
                    <DropdownMenuRadioItem value="asc">
                      <IconSortAscending className="h-4 w-4" />
                      Crescente
                    </DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="desc">
                      <IconSortDescending className="h-4 w-4" />
                      Decrescente
                    </DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button variant="outline" className="flex items-center gap-2" onClick={() => setFolderDialog({ mode: "create", packIds: selectedPackIds, parentId: newFolderParentId })}>
              <IconFolderPlus className="w-4 h-4" />
              Nova pasta
            </Button>
            <Button className="flex items-center gap-2" onClick={() => setIsDialogOpen(true)}>
              <IconPlus className="w-4 h-4" />
              Novo Pack
            </Button>
          </PageActions>
        }
      >
        <PageBodyStack className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
          {/* Explorer (busca + árvore) acoplado ao conteúdo: empilha no celular,
              vira coluna ao lado da grade a partir de `lg`. */}
          {isLoadingLibrary ? (
            <PacksLibrarySkeleton />
          ) : (
          <div className="flex flex-col items-stretch gap-6 lg:min-h-0 lg:flex-1 lg:flex-row xl:gap-8">
            <PackFolderTree
              roots={treeRoots}
              loosePacks={treeLoosePacks}
              view={gridView}
              search={packSearch}
              onSearchChange={setPackSearch}
              matchCount={packsInView.length}
              totalInView={packs.length}
              allCount={packs.length}
              showAllRow={buckets.length > 0}
              onNavigate={(next) => {
                setFolderView(next);
                // Buscando, a grade é a de "Todos": escolher um lugar na árvore é sair
                // da busca para ele, senão o clique não mudaria nada na tela.
                setPackSearch("");
                clearPackSelection();
              }}
              onSelectPack={handleSelectPackFromTree}
              // O MESMO menu do card, num `⋯` ao lado do nome. Passado como render
              // prop para a árvore não precisar conhecer nenhum handler de pack.
              renderPackMenu={(pack) => (
                <PackActionsMenu
                  pack={pack}
                  align="start"
                  side="right"
                  isUpdating={isPackUpdating(pack.id) || isPackRefreshingOnServer(pack)}
                  onRefresh={handleRefreshPack}
                  onRemove={handleRemovePack}
                  onEditDateRange={setDateRangePack}
                  onTranscribeAds={(packId, packName) => setTranscriptionDialogPack({ id: packId, name: packName })}
                  onEditJudgment={setJudgmentPack}
                  onEditSheetIntegration={handleEditSheetIntegration}
                  onDeleteSheetIntegration={handleDeleteSheetIntegration}
                >
                  <TreeRowMenuTrigger label="Ações do pack" />
                </PackActionsMenu>
              )}
              // Mesmo menu do tile de pasta. "Atualizar todos" age sobre TODOS os
              // packs dela — é a ação em massa que existe hoje a nível de pasta.
              renderFolderMenu={(folder, packCount) => (
                <FolderActionsMenu
                  folder={folder}
                  // Contagem CHEIA: buscando, a árvore traz só os resultados, mas
                  // "Atualizar todos" atualiza a pasta inteira — o número tem de bater.
                  packCount={bucketById.get(folder.id)?.allPacks.length ?? packCount}
                  align="start"
                  side="right"
                  onOpen={(id) => { setFolderView(id); clearPackSelection(); }}
                  onRename={(f) => setFolderDialog({ mode: "rename", folder: f, packIds: [] })}
                  onDelete={setFolderToDelete}
                  onRefreshAll={handleRefreshFolder}
                  onCreateSubfolder={(f) => setFolderDialog({ mode: "create", packIds: [], parentId: f.id })}
                  hasSubfolders={(bucketById.get(folder.id)?.children.length ?? 0) > 0}
                >
                  <TreeRowMenuTrigger label={`Ações da pasta ${folder.name}`} />
                </FolderActionsMenu>
              )}
              onDropPacks={handleDropPacks}
              isDragging={draggingPackIds.length > 0}
              onMoveFolder={moveFolder}
              onFolderDragChange={setDraggingFolderId}
              externalDraggingFolderId={draggingFolderId}
              externalForbiddenIds={folderDragForbidden}
              onPackDragStart={handlePackDragStart}
              onPackDragEnd={handlePackDragEnd}
              isPackDragging={(packId) => draggingPackIds.includes(packId)}
              // A MESMA seleção dos cards: duas superfícies, um estado só. A árvore
              // é a única com ordem linear, então é onde o shift+clique por intervalo
              // funciona sem ambiguidade — numa grade de 4 colunas "o que está entre
              // estes dois" não tem resposta.
              isPackSelected={isPackSelected}
              onTogglePack={togglePack}
              onPackCheckboxClick={handlePackCheckboxClick}
              hasSelection={selectedPackCount > 0}
              // A busca mora dentro do explorer, então ele NÃO pode sumir no celular —
              // some a única busca da tela junto. Abaixo de `lg` ele empilha acima da
              // grade com altura limitada; a partir daí vira coluna fixa ao lado.
              //
              // `lg:top-8` é o mesmo respiro de 32px que o componente usa para calcular
              // o teto de altura — os dois têm de bater, senão o espaço de cima e o de
              // baixo saem diferentes quando o painel gruda.
              // O `lg:max-h-*` é só o primeiro quadro, antes de o componente medir:
              // sem ele o painel nasceria com a altura inteira da lista e encolheria
              // à vista. A medida real substitui logo em seguida.
              // Sem caixa em volta, o painel também encosta na borda e o respiro do
              // fim vem de dentro da própria árvore — mesmo padrão da grade ao lado.
              className="max-h-72 w-full shrink-0 self-start lg:max-h-none lg:w-56 lg:self-stretch xl:w-64"
            />

            {/* O container que rola. `-mx-1 px-1` dá folga para o anel de foco dos
                cards não ser cortado pela borda da área de rolagem, e o `lg:pb-8`
                mora AQUI DENTRO: assim o respiro só aparece ao chegar no fim, em vez
                de virar uma faixa fixa que corta os cards no meio. */}
            <div className="-mx-1 flex min-w-0 flex-1 flex-col space-y-stack px-1 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pb-8">
          {/* Cabeçalho da pasta aberta */}
          {!isSearching && folderView && currentBucket && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border border-l-[3px] border-l-primary bg-primary-10 px-4 py-3">
              {/* Voltar sobe UM nível — para a pasta de cima, não direto para a raiz. Também
                  é alvo de arrasto: soltar aqui leva pasta ou packs para esse nível, o único
                  jeito de TIRAR algo de dentro pela grade. */}
              {(() => {
                const back = levelDropProps(currentBucket.folder.parent_id ?? null);
                return (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setFolderView(currentBucket.folder.parent_id ?? null); clearPackSelection(); }}
                onDragOver={back.onDragOver}
                onDragLeave={back.onDragLeave}
                onDrop={back.onDrop}
                className={cn(back.isTarget && "bg-surface ring-1 ring-inset ring-primary")}
              >
                <IconChevronLeft className="h-4 w-4" />
                <span className="max-w-40 truncate">{currentPath.length > 1 ? currentPath[currentPath.length - 2].folder.name : "Biblioteca"}</span>
              </Button>
                );
              })()}
              <div className="flex min-w-0 flex-col">
                {/* Caminho completo só quando há de onde vir além da raiz. */}
                {currentPath.length > 1 && (
                  <nav aria-label="Caminho da pasta" className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {(() => {
                      const root = levelDropProps(null);
                      return (
                        <button type="button" className={cn("focus-inset rounded-sm px-0.5 hover:text-foreground", root.isTarget && "bg-surface text-foreground ring-1 ring-inset ring-primary")} onClick={() => { setFolderView(null); clearPackSelection(); }} onDragOver={root.onDragOver} onDragLeave={root.onDragLeave} onDrop={root.onDrop}>
                          Biblioteca
                        </button>
                      );
                    })()}
                    {currentPath.slice(0, -1).map((node) => {
                      const crumb = levelDropProps(node.folder.id);
                      return (
                        <Fragment key={node.folder.id}>
                          <IconChevronRight className="h-3 w-3 shrink-0" />
                          <button type="button" className={cn("focus-inset max-w-32 truncate rounded-sm px-0.5 hover:text-foreground", crumb.isTarget && "bg-surface text-foreground ring-1 ring-inset ring-primary")} onClick={() => { setFolderView(node.folder.id); clearPackSelection(); }} onDragOver={crumb.onDragOver} onDragLeave={crumb.onDragLeave} onDrop={crumb.onDrop}>
                            {node.folder.name}
                          </button>
                        </Fragment>
                      );
                    })}
                  </nav>
                )}
                <span className="truncate text-sm font-semibold text-foreground">{currentBucket.folder.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {currentBucket.allPacks.length} {currentBucket.allPacks.length === 1 ? "pack" : "packs"}
                  {currentBucket.children.length > 0 && ` em ${flattenTree([currentBucket]).length} pastas`} · {formatCurrency(currentBucket.totalSpend)}
                </span>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-3">
                <Button variant="outline" size="sm" onClick={() => handleRefreshFolder(currentBucket.folder)} disabled={currentBucket.allPacks.length === 0}>
                  <IconRefresh className="h-4 w-4" />
                  Atualizar todos
                </Button>
                <Button variant="outline" size="sm" onClick={() => setFolderDialog({ mode: "rename", folder: currentBucket.folder, packIds: [] })}>
                  <IconPencil className="h-4 w-4" />
                  Renomear
                </Button>
                <Button variant="destructiveOutline" size="sm" onClick={() => setFolderToDelete(currentBucket.folder)}>
                  <IconTrash className="h-4 w-4" />
                  Desfazer pasta
                </Button>
              </div>
            </div>
          )}

          {/* Pastas — na raiz, as de primeiro nível; dentro de uma pasta, as subpastas;
              na busca, as que são resultado. "Todos os packs" é a lista corrida. */}
          {folderTiles.length > 0 && (
            <section className="flex flex-col gap-4">
              {/* Título de seção, como num gerenciador de arquivos: sem divisor e sem
                  contagem — o número de pastas está à vista logo abaixo. */}
              <h2 className="text-lg font-semibold text-foreground">Pastas</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                {folderTiles.map(({ folder, allPacks, children: subfolders, totalSpend, hasSheet, hasShared }) => (
                  <FolderCard
                    key={folder.id}
                    folder={folder}
                    packCount={allPacks.length}
                    hasSubfolders={subfolders.length > 0}
                    totalSpend={totalSpend}
                    hasSheet={hasSheet}
                    hasShared={hasShared}
                    isCurrent={false}
                    isDropTarget={dropTargetFolderId === folder.id}
                    formatCurrency={formatCurrency}
                    onOpen={(id) => { setFolderView(id); clearPackSelection(); }}
                    onRename={(f) => setFolderDialog({ mode: "rename", folder: f, packIds: [] })}
                    onDelete={setFolderToDelete}
                    onRefreshAll={handleRefreshFolder}
                    onCreateSubfolder={(f) => setFolderDialog({ mode: "create", packIds: [], parentId: f.id })}
                    onDropPacks={handleDropPacks}
                    onDragStateChange={setDropTargetFolderId}
                    onFolderDragStart={setDraggingFolderId}
                    onFolderDragEnd={handleFolderDragEnd}
                    acceptsFolderDrop={draggingFolderId !== null && !folderDragForbidden.has(folder.id)}
                    onDropFolder={(targetId) => {
                      const dragged = draggingFolderId;
                      handleFolderDragEnd();
                      if (dragged) void moveFolder(dragged, targetId, "inside");
                    }}
                    isDraggingSelf={draggingFolderId === folder.id}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Packs */}
          {packs.length === 0 ? (
            <StatePanel
              kind="empty"
              frame="dashed"
              density="spacious"
              icon={IconChartBar}
              title="Nenhum pack carregado"
              message="Um pack reúne os anúncios de uma conta num período. Carregue o primeiro para começar a análise."
              action={
                <Button onClick={() => setIsDialogOpen(true)}>
                  <IconPlus className="w-4 h-4" />
                  Novo pack
                </Button>
              }
            />
          ) : packsInView.length === 0 && (gridView === null || folderTiles.length > 0) ? null : (
            // Na raiz, sem pack solto para mostrar, a seção inteira some: com tudo em
            // pastas ela seria só um título sobre um vazio. Continua existindo quando
            // uma busca não achou NADA (nem pasta), para dizer isso; se achou só pastas,
            // os tiles já são a resposta — e o mesmo vale para uma pasta que só tem
            // subpastas. Para desarquivar
            // arrastando, o alvo é "Sem pasta" na árvore, que reaparece durante o arrasto.
            <section
              className="flex flex-col gap-4"
              onDragOver={(e) => { if (draggingPackIds.length && gridView === null) { e.preventDefault(); setDropTargetFolderId("__loose__"); } }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTargetFolderId(null); }}
              onDrop={(e) => { if (gridView === null) { e.preventDefault(); handleDropPacks(null); } }}
            >
              {isAllView && !isSearching ? (
                <h2 className="text-lg font-semibold text-foreground">Todos os packs</h2>
              ) : (
                folderTiles.length > 0 && packsInView.length > 0 && (
                  <h2 className="text-lg font-semibold text-foreground">Packs</h2>
                )
              )}

              {packsInView.length === 0 ? (
                isSearching ? (
                  <StatePanel kind="empty" frame="dashed" icon={IconSearch} title="Nenhum pack encontrado" message={`Nenhum pack corresponde a "${packSearch.trim()}".`} action={<Button variant="outline" onClick={() => setPackSearch("")}>Limpar busca</Button>} />
                ) : (
                  // Só alcançável dentro de uma pasta: na raiz a seção inteira some. A área
                  // não recebe arrasto (daqui não há pack para arrastar) — por isso é
                  // estado vazio, e o "mover" acontece soltando na pasta, na árvore.
                  <StatePanel
                    kind="empty"
                    frame="dashed"
                    title="Esta pasta está vazia"
                    message="Crie ou mova packs para cá."
                    action={
                      <Button variant="outline" onClick={() => setIsDialogOpen(true)}>
                        <IconPlus className="w-4 h-4" />
                        Novo pack
                      </Button>
                    }
                  />
                )
              ) : (
                <div className={cn("grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-8", dropTargetFolderId === "__loose__" && gridView === null && "rounded-lg ring-1 ring-inset ring-primary")}>
                  {packsInView.map((pack) => (
                    <div
                      key={pack.id}
                      id={`pack-card-${pack.id}`}
                      className={cn("group/select relative transition-opacity", draggingPackIds.includes(pack.id) && "opacity-40")}
                      draggable
                      onDragStart={handlePackDragStart(pack.id)}
                      onDragEnd={handlePackDragEnd}
                    >
                      {showPacksToolbar && (
                        // O card inteiro é um DropdownMenuTrigger — parar a propagação aqui evita
                        // que marcar o checkbox abra o menu do pack.
                        <div
                          className={cn("absolute left-3 top-3 z-20 transition-opacity", isPackSelected(pack.id) || selectedPackCount > 0 ? "opacity-100" : "opacity-0 has-[:focus-visible]:opacity-100 group-hover/select:opacity-100")}
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={isPackSelected(pack.id)}
                            onCheckedChange={(v) => togglePack(pack.id, !!v)}
                            onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
                            onClick={(e) => handlePackCheckboxClick(e, pack.id)}
                            aria-label={`Selecionar ${pack.name}`}
                          />
                        </div>
                      )}
                    <PackCard pack={pack} adAccountName={adAccountNameById.get(pack.adaccount_id)} formatCurrency={formatCurrency} formatDate={formatDate} onRefresh={handleRefreshPack} onRemove={handleRemovePack} onToggleAutoRefresh={handleToggleAutoRefresh} onSetSheetIntegration={setSheetIntegrationPack} onEditSheetIntegration={handleEditSheetIntegration} onDeleteSheetIntegration={handleDeleteSheetIntegration} onEditJudgment={setJudgmentPack} onEditDateRange={setDateRangePack} onTranscribeAds={(packId, packName) => setTranscriptionDialogPack({ id: packId, name: packName })} isSelected={isPackSelected(pack.id)} isUpdating={isPackUpdating(pack.id) || isPackRefreshingOnServer(pack)} updatingByName={isPackRefreshingOnServer(pack) ? pack.refresh_actor_name : null} isTogglingAutoRefresh={isTogglingAutoRefresh} packToDisableAutoRefresh={packToDisableAutoRefresh} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
            </div>
          </div>
          )}
        </PageBodyStack>

        {/* `fixed` sobrepõe o `absolute` da barra: a página de packs rola, então ancorar na
            base do grid deixaria a barra fora da tela ao selecionar cards do topo. */}
        <BulkActionsBar
          selectedCount={selectedPackCount}
          isLoading={isBulkDeleting}
          allSelected={allPacksSelected}
          entityNoun={{ singular: "pack", plural: "packs" }}
          actions={packBulkActions}
          onToggleAll={toggleAllPacks}
          onClear={clearPackSelection}
          className="fixed"
        />
      </PageContainer>

      <FolderNameDialog
        isOpen={!!folderDialog}
        mode={folderDialog?.mode ?? "create"}
        initialName={folderDialog?.folder?.name ?? ""}
        packCount={folderDialog?.packIds.length ?? 0}
        // Nome repetido só importa entre IRMÃS: "Vendas" dentro de dois clientes é normal.
        existingNames={buckets
          .filter((b) => (b.folder.parent_id ?? null) === (folderDialog?.mode === "rename" ? folderDialog.folder?.parent_id ?? null : folderDialog?.parentId ?? null))
          .map((b) => b.folder.name)}
        parentName={folderDialog?.mode === "create" && folderDialog.parentId ? bucketById.get(folderDialog.parentId)?.folder.name ?? null : null}
        onClose={() => setFolderDialog(null)}
        onConfirm={async (name) => {
          if (!folderDialog) return;
          if (folderDialog.mode === "rename" && folderDialog.folder) {
            await renameFolder(folderDialog.folder.id, name);
          } else {
            await createFolder(name, folderDialog.packIds, folderDialog.parentId ?? null);
            clearPackSelection();
          }
        }}
      />

      <ConfirmDialog
        isOpen={!!folderToDelete}
        onClose={() => setFolderToDelete(null)}
        title={`Desfazer a pasta "${folderToDelete?.name ?? ""}"?`}
        message={(() => {
          const parent = folderToDelete?.parent_id ? bucketById.get(folderToDelete.parent_id)?.folder.name : null;
          const hasSubfolders = (folderToDelete && bucketById.get(folderToDelete.id)?.children.length) || 0;
          const what = hasSubfolders ? "As subpastas e os packs dela" : "Os packs dela";
          return parent
            ? `Nada é apagado. ${what} sobem para “${parent}”, no lugar desta pasta. Só este agrupamento desaparece.`
            : `Nada é apagado. ${what} voltam para a Biblioteca${hasSubfolders ? " (os packs como soltos)" : " como packs soltos"}. Só este agrupamento desaparece.`;
        })()}
        confirmText="Desfazer pasta"
        variant="destructive"
        confirmIcon={<IconTrash className="h-5 w-5" />}
        onConfirm={handleConfirmDeleteFolder}
      />

      {/* Load Pack Modal */}
      <AppDialog isOpen={isDialogOpen} onClose={() => setIsDialogOpen(false)} title="Carregar Pack de Anúncios" size="2xl" padding="md" closeOnOverlayClick closeOnEscape showCloseButton>
        <div className="space-y-1.5 mb-6">
          <h2 className="text-lg font-semibold leading-none tracking-tight">Carregar Pack de Anúncios</h2>
          <p className="text-sm text-muted-foreground">
            Configure os parâmetros para carregar um novo pack de anúncios
            {creationFolder && <> · ele vai para a pasta <span className="font-medium text-foreground">{creationFolder.name}</span></>}
          </p>
        </div>

        <div className="space-y-6">
          {/* Pack Name */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Nome do Pack</label>
            <Input
              placeholder="Ex: Black Friday Campaign, Q4 Performance, etc."
              value={formData.name}
              onChange={(e) => {
                setPackNameDuplicateError(false);
                setFormData((prev) => ({ ...prev, name: e.target.value }));
              }}
              className={packNameDuplicateError ? "border-destructive focus-visible:ring-destructive" : undefined}
            />
            {packNameDuplicateError && <p className="text-xs text-destructive">Já existe um pack com esse nome. Escolha outro.</p>}
          </div>

          {/* Ad Account */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              Conta de Anúncios
              {Array.isArray(adAccountsData) && adAccountsData.length > 0 && (
                <span className="text-xs text-muted-foreground font-normal">
                  ({adAccountsData.length} {adAccountsData.length === 1 ? "conta disponível" : "contas disponíveis"})
                </span>
              )}
            </label>
            {adAccountsLoading ? (
              <Select disabled>
                <SelectTrigger className="w-full">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <IconLoader2 className="w-4 h-4 animate-spin" />
                    <span>Carregando contas de anúncios...</span>
                  </div>
                </SelectTrigger>
              </Select>
            ) : Array.isArray(adAccountsData) && adAccountsData.length > 0 ? (
              <Select value={formData.adaccount_id} onValueChange={(value) => setFormData((prev) => ({ ...prev, adaccount_id: value }))}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Selecione uma conta de anúncios" />
                </SelectTrigger>
                <SelectContent>
                  {[...adAccountsData]
                    .sort((a: any, b: any) => {
                      // Ordenar primeiro por status (ativas primeiro, depois pausadas)
                      const statusA = a.account_status || 0;
                      const statusB = b.account_status || 0;

                      // Prioridade: 1 (ativo) > 2 (pausado) > outros
                      const priority = { 1: 0, 2: 1 };
                      const priorityA = priority[statusA as keyof typeof priority] ?? 2;
                      const priorityB = priority[statusB as keyof typeof priority] ?? 2;

                      if (priorityA !== priorityB) {
                        return priorityA - priorityB;
                      }

                      // Depois ordenar por nome (alfabética A-Z)
                      const nameA = (a.name || a.id || "").toLowerCase();
                      const nameB = (b.name || b.id || "").toLowerCase();
                      return nameA.localeCompare(nameB);
                    })
                    .map((account: any) => {
                      const accountStatus = account.account_status;
                      const accountName = account.name || account.id;

                      // Definir ícone e cor baseado no status
                      let StatusIcon;
                      let iconColor;
                      if (accountStatus === 1) {
                        // Ativo
                        StatusIcon = IconCircleCheck;
                        iconColor = "text-success";
                      } else if (accountStatus === 2) {
                        // Pausado
                        StatusIcon = IconCircleDot;
                        iconColor = "text-warning";
                      } else if (accountStatus === 3) {
                        // Desativado
                        StatusIcon = IconCircleX;
                        iconColor = "text-destructive";
                      } else {
                        // Desconhecido
                        StatusIcon = IconCircleDot;
                        iconColor = "text-muted-foreground";
                      }

                      const isActive = accountStatus === 1;

                      return (
                        <SelectItem key={account.id} value={account.id} textValue={accountName}>
                          <div className={`flex items-center gap-2 w-full min-w-0 ${!isActive ? "opacity-50" : ""}`}>
                            <StatusIcon className={`w-4 h-4 flex-shrink-0 ${iconColor}`} />
                            <span className="font-medium text-sm truncate">{accountName}</span>
                          </div>
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
            ) : (
              <InlineNotice
                tone="warning"
                title="Nenhuma conta de anúncios encontrada"
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsDialogOpen(false);
                      // Pode redirecionar para página de conexão se necessário
                    }}
                  >
                    Conectar Facebook
                  </Button>
                }
              >
                Conecte sua conta do Facebook primeiro.
              </InlineNotice>
            )}
          </div>

          {/* Date Range */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Período</label>
              <div className="flex items-center gap-2">
                <ToggleSwitch
                  id="auto-refresh-switch"
                  checked={formData.auto_refresh || false}
                  onCheckedChange={(checked: boolean) => {
                    if (formData.date_stop === getTodayLocal()) {
                      setFormData((prev) => ({
                        ...prev,
                        auto_refresh: checked,
                      }));
                    }
                  }}
                  disabled={formData.date_stop !== getTodayLocal()}
                  labelLeft="Manter atualizado"
                  variant="minimal"
                  size="md"
                  labelClassName={formData.date_stop !== getTodayLocal() ? "text-muted-foreground cursor-not-allowed" : "text-xs text-muted-foreground cursor-pointer"}
                />
              </div>
            </div>
            <DateRangeFilter
              value={{
                start: formData.date_start || undefined,
                end: formData.date_stop || undefined,
              }}
              onChange={(dateRange: DateRangeValue) => {
                const newDateStop = dateRange.end || "";
                const newDateStart = dateRange.start || "";
                // Salvar no localStorage
                saveDateRange({
                  start: newDateStart,
                  end: newDateStop,
                });
                setFormData((prev) => ({
                  ...prev,
                  date_start: newDateStart,
                  date_stop: newDateStop,
                  // Ativa automaticamente se a data final for hoje, desativa caso contrário
                  auto_refresh: newDateStop === getTodayLocal(),
                }));
              }}
              useModal={true}
              disableFutureDates={true}
              showLabel={false}
            />
          </div>

          {/* Filters */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium flex items-center gap-2">
                <IconFilter className="w-4 h-4" />
                Filtros
              </label>
              <Button type="button" variant="outline" size="sm" onClick={handleAddFilter}>
                <IconPlus className="w-4 h-4 mr-1" />
                Adicionar Filtro
              </Button>
            </div>

            {formData.filters.map((filter, index) => (
              <div key={index} className="grid grid-cols-12 gap-2 items-stretch">
                <div className="col-span-4">
                  <Select value={filter.field} onValueChange={(value) => handleFilterChange(index, "field", value)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione o campo" />
                    </SelectTrigger>
                    <SelectContent>
                      {FILTER_FIELDS.map((field) => (
                        <SelectItem key={field.value} value={field.value}>
                          {field.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-3">
                  <Select value={filter.operator} onValueChange={(value) => handleFilterChange(index, "operator", value)}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Selecione o operador" />
                    </SelectTrigger>
                    <SelectContent>
                      {FILTER_OPERATORS.map((op) => (
                        <SelectItem key={op} value={op}>
                          {op.replace("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-4">
                  <Input placeholder="Valor..." value={filter.value} onChange={(e) => handleFilterChange(index, "value", e.target.value)} />
                </div>
                <div className="col-span-1 flex">
                  <Button type="button" variant="outline" className="h-full w-full hover:border-destructive hover:text-destructive hover:bg-destructive-10" onClick={() => handleRemoveFilter(index)}>
                    <IconTrash className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Submit Button */}
          <div className="flex gap-3">
            <Button onClick={handleLoadPack} disabled={!!validateForm() || isCreating} className="flex-1" size="lg">
              <IconChartBar className="w-4 h-4 mr-2" />
              Carregar Pack
            </Button>
          </div>
        </div>
      </AppDialog>

      {/* Refresh Pack Confirmation Dialog */}
      <AppDialog isOpen={refreshModalPacks.length > 0} onClose={cancelRefreshPack} title={isBulkRefresh ? "Atualizar Packs" : "Atualizar Pack"} size="md" padding="md" closeOnOverlayClick closeOnEscape showCloseButton>
        <div className="flex flex-col gap-5 py-4">
          <div>
            <h2 className="text-xl font-semibold text-foreground mb-1">{isBulkRefresh ? `Atualizar ${refreshModalPacks.length} packs?` : "Atualizar Pack?"}</h2>
            <p className="text-sm text-muted-foreground">
              {isBulkRefresh ? (
                <>
                  Os packs serão atualizados <strong>um de cada vez</strong>, na ordem da tela. Escolha o tipo de atualização:
                </>
              ) : (
                <>
                  Deseja atualizar o pack <strong>"{refreshModalPacks[0]?.name}"</strong>? Escolha o tipo de atualização:
                </>
              )}
            </p>
          </div>

          {/* Toggles: Meta, Leadscore, Transcrição */}
          {(() => {
            const hasSheetIntegration = hasSheetIntegrationInModal;
            return (
              <div className="w-full space-y-2">
                <div className="flex flex-col gap-3">
                  <ToggleSwitch id="refresh-toggle-meta" checked={refreshToggles.meta} onCheckedChange={(checked) => setRefreshToggles((prev) => ({ ...prev, meta: checked }))} label="Meta" variant="minimal" icon={<MetaIcon className="h-4 w-4 flex-shrink-0" />} />
                  <div className="flex items-center gap-2">
                    <ToggleSwitch id="refresh-toggle-leadscore" checked={hasSheetIntegration ? refreshToggles.leadscore : false} onCheckedChange={(checked) => setRefreshToggles((prev) => ({ ...prev, leadscore: checked }))} label="Leadscore (Google Sheets)" variant="minimal" icon={<GoogleSheetsIcon className="h-4 w-4 flex-shrink-0" />} disabled={!hasSheetIntegration} />
                    {!hasSheetIntegration && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help flex-shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent>Ative o leadscore integrando uma planilha.</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Opções de período */}
          {(() => {
            const pack = refreshModalPacks[0];
            const formatDateDisplay = (s: string) => {
              if (!s) return "";
              const [y, m, d] = s.split("-");
              return `${d}/${m}/${y}`;
            };
            const today = getTodayLocal();
            // Mesma regra do backend: última atualização menos a janela de atribuição
            // do pack (nunca antes do início). É o que o refresh vai pedir de fato.
            const sinceLastStart = sinceLastRefreshStart(pack);
            const lookbackDays = lookbackDaysForPack(pack);
            // Pack fechado ("manter atualizado" desligado) não anda: o fim pedido é o
            // date_stop, não hoje. Mesma regra do backend (pack_window.effective_until).
            const until = refreshUntil(pack, today);
            // Em lote cada pack tem sua própria âncora e seu próprio período — um range
            // concreto seria mentira. Descreve a regra em vez de resumir datas.
            const sinceLastRange = isBulkRefresh ? "Cada pack a partir da sua última atualização" : sinceLastStart ? `${formatDateDisplay(sinceLastStart)} → ${formatDateDisplay(until)}` : "—";
            const sinceLastHint = isBulkRefresh
              ? "Inclui a janela de atribuição de cada pack, para as conversões tardias entrarem."
              : sinceLastStart
                ? `Inclui ${lookbackDays} ${lookbackDays === 1 ? "dia" : "dias"} de janela de atribuição, para as conversões tardias entrarem.`
                : null;
            const fullPeriodRange = isBulkRefresh ? "O período completo de cada pack" : pack?.date_start && pack?.date_stop ? `${formatDateDisplay(pack.date_start)} → ${formatDateDisplay(until)}` : "—";
            return (
              <div className="w-full space-y-2">
                <button type="button" onClick={() => setRefreshType("since_last_refresh")} className={`w-full p-3 rounded-lg border-2 text-left transition-all cursor-pointer ${refreshType === "since_last_refresh" ? "border-primary bg-primary-10" : "border-border bg-surface-2 hover:bg-accent"}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${refreshType === "since_last_refresh" ? "border-primary" : "border-border"}`}>{refreshType === "since_last_refresh" && <div className="w-2 h-2 rounded-full bg-primary" />}</div>
                    <div>
                      <div className="font-semibold text-foreground text-sm">Dados mais recentes</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{sinceLastRange}</div>
                      {sinceLastHint && <div className="text-2xs text-muted-foreground mt-0.5">{sinceLastHint}</div>}
                    </div>
                  </div>
                </button>

                <button type="button" onClick={() => setRefreshType("full_period")} className={`w-full p-3 rounded-lg border-2 text-left transition-all cursor-pointer ${refreshType === "full_period" ? "border-primary bg-primary-10" : "border-border bg-surface-2 hover:bg-accent"}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${refreshType === "full_period" ? "border-primary" : "border-border"}`}>{refreshType === "full_period" && <div className="w-2 h-2 rounded-full bg-primary" />}</div>
                    <div>
                      <div className="font-semibold text-foreground text-sm">Todo o período</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{fullPeriodRange}</div>
                    </div>
                  </div>
                </button>
              </div>
            );
          })()}

          <div className="flex gap-4 w-full">
            <Button onClick={cancelRefreshPack} variant="destructiveOutline" className="flex-1 flex items-center justify-center gap-2">
              <IconCircleX className="h-5 w-5" />
              Cancelar
            </Button>

            <Button onClick={confirmRefreshPack} variant="success" className="flex-1 flex items-center justify-center gap-2" disabled={!canConfirmRefresh}>
              <IconCircleCheck className="h-5 w-5" />
              Confirmar
            </Button>
          </div>
        </div>
      </AppDialog>

      {/* Desconectar a planilha — uma ação só: o vínculo sai e, por padrão, o
          leadscore importado sai junto. Manter os dados sem a planilha deixaria
          números órfãos que nenhuma tela saberia mais limpar. */}
      <ConfirmDialog
        isOpen={!!packToRemoveIntegration}
        onClose={() => !isRemovingIntegration && setPackToRemoveIntegration(null)}
        title="Desconectar planilha"
        message={`O pack "${packToRemoveIntegration?.name}" continua existindo, e a planilha no Google não é alterada. O leadscore que veio dela é apagado: sem planilha conectada, o pack não guarda dados enriquecidos.`}
        onConfirm={confirmRemoveSheetIntegration}
        variant="destructive"
        confirmText="Desconectar e apagar"
        isLoading={isRemovingIntegration}
        loadingText="Desconectando..."
        layout="left-aligned"
        confirmIcon={<GoogleSheetsIcon className="w-4 h-4" />}
      >
        {!isRemovingIntegration && (
          <div className="py-4 space-y-3">
            {isLoadingRemovePreview ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <IconLoader2 className="w-4 h-4 animate-spin" />
                Conferindo o que foi importado...
              </div>
            ) : removeIntegrationPreview && removeIntegrationPreview.rows_matched > 0 ? (
              <>
                <div className="bg-background p-4 rounded-lg border border-border">
                  <p className="text-sm text-muted-foreground mb-2">O leadscore importado sai junto:</p>
                  <ul className="text-sm space-y-1">
                    <li>
                      • <strong>{removeIntegrationPreview.rows_with_leadscore.toLocaleString()}</strong> dias com leadscore
                    </li>
                    {removeIntegrationPreview.rows_with_custom > 0 && (
                      <li>
                        • <strong>{removeIntegrationPreview.rows_with_custom.toLocaleString()}</strong> dias com colunas adicionais
                      </li>
                    )}
                  </ul>
                </div>
                {/* Leadscore é do anúncio-dia, não do pack: dia compartilhado sai dos dois. */}
                {removeIntegrationPreview.rows_shared_with_other_packs > 0 && (
                  <InlineNotice tone="warning">
                    <strong>{removeIntegrationPreview.rows_shared_with_other_packs.toLocaleString()}</strong> desses dias também
                    estão em {removeIntegrationPreview.other_packs_affected === 1 ? "outro pack" : `outros ${removeIntegrationPreview.other_packs_affected} packs`},
                    que vão perder esse leadscore junto.
                  </InlineNotice>
                )}
                <p className="text-xs text-muted-foreground">
                  Não há como desfazer. Conectar a planilha de novo repovoa os dias que ela cobrir.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum leadscore foi importado por esta planilha.</p>
            )}
          </div>
        )}
      </ConfirmDialog>

      {/* Confirmation Dialog */}
      <ConfirmDialog isOpen={!!packToRemove} onClose={() => !isDeleting && setPackToRemove(null)} title={isDeleting ? "Deletando Pack..." : "Confirmar Remoção"} message={isDeleting ? `Excluindo os dados do pack "${packToRemove?.name}..."` : `Tem certeza que deseja remover o pack "${packToRemove?.name}"?`} onConfirm={confirmRemovePack} onCancel={cancelRemovePack} variant="destructive" confirmText="Remover Pack" isLoading={isDeleting} loadingText="Deletando..." layout="left-aligned" confirmIcon={<IconTrash className="w-4 h-4" />}>
        {!isDeleting && (
          <div className="py-4">
            <div className="bg-background p-4 rounded-lg border border-border">
              <p className="text-sm text-muted-foreground mb-2">Esta ação irá remover:</p>
              <ul className="text-sm space-y-1">
                <li>
                  • <strong>{packToRemove?.adsCount}</strong> anúncios
                </li>
                <li>• Todos os dados e métricas associados</li>
                <li>
                  • Esta ação <strong>não pode ser desfeita</strong>
                </li>
              </ul>
            </div>
          </div>
        )}
      </ConfirmDialog>

      {/* Disable Auto-Refresh Confirmation Dialog */}
      <ConfirmDialog isOpen={!!packToDisableAutoRefresh} onClose={() => !isTogglingAutoRefresh && cancelDisableAutoRefresh()} title="Desativar atualização automática?" message="Ao desativar você precisará lembrar de atualizá-lo manualmente quando necessário." onConfirm={() => packToDisableAutoRefresh && confirmToggleAutoRefresh(packToDisableAutoRefresh.id, false)} onCancel={cancelDisableAutoRefresh} confirmText="Desativar" isLoading={!!isTogglingAutoRefresh} />

      {/* Transcription Status Dialog */}
      <TranscriptionStatusDialog isOpen={!!transcriptionDialogPack} onClose={() => setTranscriptionDialogPack(null)} packId={transcriptionDialogPack?.id ?? ""} packName={transcriptionDialogPack?.name ?? ""} onConfirm={handleConfirmTranscription} onForce={handleForceTranscription} />

      {/* Booster de planilha por pack (Google Sheets) */}
      <GoogleSheetIntegrationDialog
        isOpen={!!sheetIntegrationPack}
        onClose={() => {
          setSheetIntegrationPack(null);
          // Packs serão recarregados automaticamente pelo PacksLoader
          // e já virão com sheet_integration atualizado
        }}
        packId={sheetIntegrationPack?.id ?? null}
      />

      {/* Critérios de julgamento por pack (herança com override) */}
      <PackJudgmentDialog
        pack={judgmentPack}
        open={!!judgmentPack}
        onOpenChange={(open) => {
          if (!open) setJudgmentPack(null);
        }}
      />

      {/* Edição do período do pack (só ampliar nesta etapa) */}
      <PackDateRangeDialog
        pack={dateRangePack}
        open={!!dateRangePack}
        onOpenChange={(open) => {
          if (!open) setDateRangePack(null);
        }}
        onConfirm={(pack, windowEdit) => {
          setDateRangePack(null);
          void refreshPack({
            packId: pack.id,
            packName: pack.name,
            refreshType: "window_edit",
            windowEdit,
            sheetIntegrationId: pack.sheet_integration?.id,
            toggles: { meta: true, leadscore: !!pack.sheet_integration, transcription: false },
          });
        }}
      />
    </>
  );
}
