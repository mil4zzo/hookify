"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { StandardCard } from "@/components/common/StandardCard";
import { PackCard } from "@/components/packs/PackCard";
import { PackJudgmentDialog } from "@/components/packs/PackJudgmentDialog";
import { TranscriptionStatusDialog } from "@/components/packs/TranscriptionStatusDialog";
import { Input } from "@/components/ui/input";
import { SearchInputWithClear } from "@/components/common/SearchInputWithClear";
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
import { IconFilter, IconPlus, IconTrash, IconChartBar, IconLoader2, IconCircleCheck, IconCircleX, IconCircleDot, IconInfoCircle, IconMicrophone, IconArrowsSort, IconRefresh, IconChevronUp, IconChevronDown } from "@tabler/icons-react";

import { FilterRule } from "@/lib/api/schemas";
import { AdsPack } from "@/lib/types";
import { useFormatCurrency } from "@/lib/utils/currency";
import { PageContainer } from "@/components/common/PageContainer";
import { PageActions } from "@/components/common/PageActions";
import { StatePanel } from "@/components/common/States";
// design-system-exception: direct-skeleton-import - skeleton replica o card de pack (efeito leque) com formato real, fora do escopo dos variants de StateSkeleton
import { Skeleton } from "@/components/ui/skeleton";
import { PageBodyStack } from "@/components/common/layout";
import { getTodayLocal, formatDateLocal } from "@/lib/utils/dateFilters";
import { subDays } from "date-fns";
import { useUpdatingPacksStore } from "@/lib/store/updatingPacks";
import { usePacksLoading } from "@/components/layout/PacksLoader";
import { usePackRefresh, type RefreshToggles } from "@/lib/hooks/usePackRefresh";
import { usePackCreation } from "@/lib/hooks/usePackCreation";
import { MetaIcon, GoogleSheetsIcon } from "@/components/icons";
import { logger } from "@/lib/utils/logger";
import { usePackSortStore } from "@/lib/store/packSort";
import { PACK_SORT_OPTIONS, filterPacksBySearch, sortPacks, type PackSortKey } from "@/lib/utils/packSort";
import { useMultiSelect } from "@/lib/hooks/useMultiSelect";
import { useBulkPackDelete } from "@/lib/hooks/useBulkPackDelete";
import { BulkActionsBar, type BulkAction } from "@/components/common/BulkActionsBar";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils/cn";

const STORAGE_KEY_DATE_RANGE = "hookify-packs-date-range";
const STORAGE_KEY_REFRESH_TOGGLES = "hookify:refresh-toggles";

const DEFAULT_REFRESH_TOGGLES: RefreshToggles = {
  meta: true,
  leadscore: true,
  transcription: false,
};

function PacksGridSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="relative inline-block w-full">
          <div className="absolute inset-x-0 top-4 bottom-0 rounded-md bg-card border border-border-50 origin-bottom -rotate-[1.5deg] opacity-60 pointer-events-none" />
          <div className="absolute inset-x-0 top-4 bottom-0 rounded-md bg-card border border-border-50 origin-bottom rotate-[1.5deg] opacity-60 pointer-events-none" />
          <div className="relative z-10 rounded-md border border-border bg-card overflow-hidden">
            <div className="p-6 flex flex-col gap-6">
              <div className="flex flex-col items-center gap-3">
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-4 w-20" />
              </div>
              <div className="flex flex-col items-center gap-2">
                <Skeleton className="h-8 w-28" />
                <Skeleton className="h-4 w-16" />
              </div>
              <div className="grid grid-cols-4 gap-2">
                <Skeleton className="h-10 rounded-md" />
                <Skeleton className="h-10 rounded-md" />
                <Skeleton className="h-10 rounded-md" />
                <Skeleton className="h-10 rounded-md" />
              </div>
              <Skeleton className="h-6 w-24 self-center" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PacksPageSkeleton() {
  return (
    <PageContainer variant="standard" title="Biblioteca" description="Gerencie seus Packs de anúncios.">
      <PageBodyStack>
        <PacksGridSkeleton />
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
  const { startCreation, isCreating } = usePackCreation({
    onComplete: () => {
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
  const [judgmentPack, setJudgmentPack] = useState<AdsPack | null>(null);

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
  const togglePackSortDirection = usePackSortStore((state) => state.toggleDirection);

  // Ordena antes de filtrar para sobrar a lista ordenada COMPLETA: a seleção pode conter
  // packs que a busca escondeu, e eles precisam de uma ordem definida na hora de agir.
  const sortedPacks = useMemo(() => sortPacks(packs, packSortKey, { accountNameById: adAccountNameById, direction: packSortDirection }), [packs, packSortKey, packSortDirection, adAccountNameById]);
  const visiblePacks = useMemo(() => filterPacksBySearch(sortedPacks, packSearch, { accountNameById: adAccountNameById }), [sortedPacks, packSearch, adAccountNameById]);

  const isSearching = packSearch.trim().length > 0;
  // Com 0 ou 1 pack a barra é só ruído — nada a buscar, ordenar ou selecionar.
  const showPacksToolbar = !isLoadingPacks && packs.length > 1;

  // Selecionável = o que está visível (a busca define o universo do "selecionar todos").
  const visiblePackIds = useMemo(() => visiblePacks.map((p) => p.id), [visiblePacks]);
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

  /** Remove só a integração de planilha, um pack de cada vez. O pack em si fica intacto. */
  const handleBulkRemoveSheetIntegration = async () => {
    const targets = selectedPacksWithSheets;
    if (targets.length === 0) return;

    const failed: string[] = [];
    for (const pack of targets) {
      try {
        await api.integrations.google.deleteSheetIntegration(pack.sheet_integration!.id);
        updatePack(pack.id, { sheet_integration: undefined });
      } catch (error) {
        logger.error(`Erro ao remover integração do pack ${pack.id}:`, error);
        failed.push(pack.name);
      }
    }

    clearPackSelection();
    if (failed.length === 0) showSuccess(`Integração removida de ${targets.length} ${targets.length === 1 ? "pack" : "packs"}.`);
    else showError({ message: `Falha ao remover a integração de: ${failed.join(", ")}.` });
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
      label: "Remover planilha",
      icon: <GoogleSheetsIcon className="h-3.5 w-3.5" />,
      disabled: selectedPacksWithSheets.length === 0,
      confirm: {
        title: () => `Remover integração de ${selectedPacksWithSheets.length} ${selectedPacksWithSheets.length === 1 ? "pack" : "packs"}?`,
        message: () => "Os packs continuam existindo — só o vínculo com a planilha é desfeito, e apenas nos packs selecionados que têm integração. A planilha no Google não é alterada.",
        confirmText: "Remover integração",
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
      }
    } catch (error) {
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

  const handleDeleteSheetIntegration = (pack: AdsPack) => {
    if (!pack.sheet_integration?.id) return;
    setPackToRemoveIntegration(pack);
  };

  const confirmRemoveSheetIntegration = async () => {
    const pack = packToRemoveIntegration;
    if (!pack?.sheet_integration?.id) return;

    setPackToRemoveIntegration(null);
    try {
      await api.integrations.google.deleteSheetIntegration(pack.sheet_integration.id);
      updatePack(pack.id, { sheet_integration: undefined });
      showSuccess("Integração removida com sucesso!");
    } catch (error) {
      showError(error instanceof Error ? error : new Error("Erro ao remover integração"));
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
        actions={
          <PageActions className="sm:flex-nowrap">
            <Button className="flex items-center gap-2" onClick={() => setIsDialogOpen(true)}>
              <IconPlus className="w-4 h-4" />
              Novo Pack
            </Button>
          </PageActions>
        }
      >
        <PageBodyStack>
          {/* Busca + ordenação */}
          {showPacksToolbar && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <SearchInputWithClear value={packSearch} onChange={setPackSearch} placeholder="Buscar por nome ou conta..." wrapperClassName="w-full sm:w-80" aria-label="Buscar packs" />
              <div className="flex items-center gap-3">
                {isSearching && (
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    {visiblePacks.length} de {packs.length}
                  </span>
                )}
                <Select value={packSortKey} onValueChange={(value) => setPackSortKey(value as PackSortKey)}>
                  <SelectTrigger className="w-full sm:w-[210px]" aria-label="Ordenar packs">
                    <div className="flex items-center gap-2 min-w-0">
                      <IconArrowsSort className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      <SelectValue />
                    </div>
                  </SelectTrigger>
                  <SelectContent>
                    {PACK_SORT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={togglePackSortDirection}
                  aria-label={packSortDirection === "asc" ? "Ordem crescente. Clique para inverter para decrescente." : "Ordem decrescente. Clique para inverter para crescente."}
                  title={packSortDirection === "asc" ? "Crescente" : "Decrescente"}
                >
                  {packSortDirection === "asc" ? <IconChevronUp className="h-4 w-4" /> : <IconChevronDown className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}

          {/* Packs Grid */}
          {isLoadingPacks ? (
            <PacksGridSkeleton />
          ) : packs.length === 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-6">
              <div className="relative inline-block w-full">
                <div className="absolute inset-x-0 top-4 bottom-0 rounded-md bg-card border border-border-50 origin-bottom -rotate-[1.5deg] opacity-60 pointer-events-none" />
                <div className="absolute inset-x-0 top-4 bottom-0 rounded-md bg-card border border-border-50 origin-bottom rotate-[1.5deg] opacity-60 pointer-events-none" />
                <StandardCard variant="default" padding="none" className="relative flex flex-col z-10 w-full overflow-hidden">
                  <div className="p-6 flex flex-col items-center justify-center gap-4 h-full relative z-10 min-h-[220px]">
                    <IconChartBar className="w-8 h-8 text-muted-foreground" />
                    <div className="flex flex-col items-center gap-1 text-center">
                      <span className="text-xl font-semibold">Nenhum Pack Carregado</span>
                      <span className="text-sm text-muted-foreground">Carregue seu primeiro pack de anúncios para começar a análise</span>
                    </div>
                    <Button onClick={() => setIsDialogOpen(true)}>
                      <IconPlus className="w-4 h-4 mr-2" />
                      Carregar Primeiro Pack
                    </Button>
                  </div>
                </StandardCard>
              </div>
            </div>
          ) : visiblePacks.length === 0 ? (
            <StatePanel kind="empty" title="Nenhum pack encontrado" message={`Nenhum pack corresponde a "${packSearch.trim()}".`} action={<Button variant="outline" onClick={() => setPackSearch("")}>Limpar busca</Button>} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-10 gap-y-8">
              {visiblePacks.map((pack) => (
                <div key={pack.id} className="group/select relative">
                  {showPacksToolbar && (
                    // O card inteiro é um DropdownMenuTrigger — parar a propagação aqui evita
                    // que marcar o checkbox abra o menu do pack.
                    <div
                      className={cn("absolute left-3 top-3 z-20 transition-opacity", isPackSelected(pack.id) || selectedPackCount > 0 ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover/select:opacity-100")}
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
                <PackCard pack={pack} adAccountName={adAccountNameById.get(pack.adaccount_id)} formatCurrency={formatCurrency} formatDate={formatDate} onRefresh={handleRefreshPack} onRemove={handleRemovePack} onToggleAutoRefresh={handleToggleAutoRefresh} onSetSheetIntegration={setSheetIntegrationPack} onEditSheetIntegration={handleEditSheetIntegration} onDeleteSheetIntegration={handleDeleteSheetIntegration} onEditJudgment={setJudgmentPack} onTranscribeAds={(packId, packName) => setTranscriptionDialogPack({ id: packId, name: packName })} isSelected={isPackSelected(pack.id)} isUpdating={isPackUpdating(pack.id)} isTogglingAutoRefresh={isTogglingAutoRefresh} packToDisableAutoRefresh={packToDisableAutoRefresh} />
                </div>
              ))}
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

      {/* Load Pack Modal */}
      <AppDialog isOpen={isDialogOpen} onClose={() => setIsDialogOpen(false)} title="Carregar Pack de Anúncios" size="2xl" padding="md" closeOnOverlayClick closeOnEscape showCloseButton>
        <div className="space-y-1.5 mb-6">
          <h2 className="text-lg font-semibold leading-none tracking-tight">Carregar Pack de Anúncios</h2>
          <p className="text-sm text-muted-foreground">Configure os parâmetros para carregar um novo pack de anúncios</p>
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
              <div className="flex flex-col gap-2 p-4 border border-border rounded-md bg-muted-50">
                <p className="text-sm text-muted-foreground">Nenhuma conta de anúncios encontrada. Conecte sua conta do Facebook primeiro.</p>
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
              </div>
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
                  <Button type="button" variant="outline" className="h-full w-full hover:border-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => handleRemoveFilter(index)}>
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
            <h2 className="text-xl font-semibold text-text mb-1">{isBulkRefresh ? `Atualizar ${refreshModalPacks.length} packs?` : "Atualizar Pack?"}</h2>
            <p className="text-sm text-text-muted">
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
            const sinceLastAnchor = pack?.last_refreshed_at || pack?.date_stop;
            // Em lote cada pack tem sua própria âncora e seu próprio período — um range
            // concreto seria mentira. Descreve a regra em vez de resumir datas.
            const sinceLastRange = isBulkRefresh ? "Cada pack a partir da sua última atualização" : sinceLastAnchor ? `${formatDateDisplay(formatDateLocal(subDays(new Date(sinceLastAnchor + "T12:00:00"), 1)))} → ${formatDateDisplay(today)}` : "—";
            const fullPeriodRange = isBulkRefresh ? "O período completo de cada pack" : pack?.date_start && pack?.date_stop ? (pack.auto_refresh ? `${formatDateDisplay(pack.date_start)} → ${formatDateDisplay(today)}` : `${formatDateDisplay(pack.date_start)} → ${formatDateDisplay(pack.date_stop)}`) : "—";
            return (
              <div className="w-full space-y-2">
                <button type="button" onClick={() => setRefreshType("since_last_refresh")} className={`w-full p-3 rounded-lg border-2 text-left transition-all cursor-pointer ${refreshType === "since_last_refresh" ? "border-primary bg-primary-10" : "border-border hover:border-primary-50 bg-input-30"}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${refreshType === "since_last_refresh" ? "border-primary" : "border-border"}`}>{refreshType === "since_last_refresh" && <div className="w-2 h-2 rounded-full bg-primary" />}</div>
                    <div>
                      <div className="font-semibold text-text text-sm">Dados mais recentes</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{sinceLastRange}</div>
                    </div>
                  </div>
                </button>

                <button type="button" onClick={() => setRefreshType("full_period")} className={`w-full p-3 rounded-lg border-2 text-left transition-all cursor-pointer ${refreshType === "full_period" ? "border-primary bg-primary-10" : "border-border hover:border-primary-50 bg-input-30"}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${refreshType === "full_period" ? "border-primary" : "border-border"}`}>{refreshType === "full_period" && <div className="w-2 h-2 rounded-full bg-primary" />}</div>
                    <div>
                      <div className="font-semibold text-text text-sm">Todo o período</div>
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

      {/* Remoção da integração de planilha (individual) */}
      <ConfirmDialog
        isOpen={!!packToRemoveIntegration}
        onClose={() => setPackToRemoveIntegration(null)}
        title="Remover integração de planilha"
        message={`O pack "${packToRemoveIntegration?.name}" continua existindo — só o vínculo com a planilha é desfeito. A planilha no Google não é alterada.`}
        onConfirm={confirmRemoveSheetIntegration}
        variant="destructive"
        confirmText="Remover integração"
        layout="left-aligned"
        confirmIcon={<GoogleSheetsIcon className="w-4 h-4" />}
      />

      {/* Confirmation Dialog */}
      <ConfirmDialog isOpen={!!packToRemove} onClose={() => !isDeleting && setPackToRemove(null)} title={isDeleting ? "Deletando Pack..." : "Confirmar Remoção"} message={isDeleting ? `Excluindo os dados do pack "${packToRemove?.name}..."` : `Tem certeza que deseja remover o pack "${packToRemove?.name}"?`} onConfirm={confirmRemovePack} onCancel={cancelRemovePack} variant="destructive" confirmText="Remover Pack" isLoading={isDeleting} loadingText="Deletando..." layout="left-aligned" confirmIcon={<IconTrash className="w-4 h-4" />}>
        {!isDeleting && (
          <div className="py-4">
            <div className="bg-border p-4 rounded-lg">
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
    </>
  );
}
