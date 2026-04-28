"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { StandardCard } from "@/components/common/StandardCard";
import { PackCard } from "@/components/packs/PackCard";
import { PacksOverflowMenu } from "@/components/packs/PacksOverflowMenu";
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
import { IconFilter, IconPlus, IconTrash, IconChartBar, IconLoader2, IconCircleCheck, IconCircleX, IconCircleDot, IconInfoCircle, IconMicrophone } from "@tabler/icons-react";

import { FilterRule } from "@/lib/api/schemas";
import { AdsPack } from "@/lib/types";
import { useFormatCurrency } from "@/lib/utils/currency";
import { PageContainer } from "@/components/common/PageContainer";
import { PageActions } from "@/components/common/PageActions";
import { StatePanel, StateSkeleton } from "@/components/common/States";
import { PageBodyStack } from "@/components/common/layout";
import { getTodayLocal, formatDateLocal } from "@/lib/utils/dateFilters";
import { subDays } from "date-fns";
import { useUpdatingPacksStore } from "@/lib/store/updatingPacks";
import { usePacksLoading } from "@/components/layout/PacksLoader";
import { usePackRefresh, type RefreshToggles } from "@/lib/hooks/usePackRefresh";
import { usePackCreation } from "@/lib/hooks/usePackCreation";
import { MetaIcon, GoogleSheetsIcon } from "@/components/icons";
import { logger } from "@/lib/utils/logger";

const STORAGE_KEY_DATE_RANGE = "hookify-packs-date-range";
const STORAGE_KEY_REFRESH_TOGGLES = "hookify:refresh-toggles";

const DEFAULT_REFRESH_TOGGLES: RefreshToggles = {
  meta: true,
  leadscore: true,
  transcription: false,
};

function PacksPageSkeleton() {
  return (
    <PageContainer variant="standard" title="Biblioteca" description="Gerencie seus Packs de anúncios.">
      <PageBodyStack>
        <StateSkeleton variant="page" rows={4} className="rounded-md border border-border bg-card" />
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
  const [packToRefresh, setPackToRefresh] = useState<{ id: string; name: string } | null>(null);
  const [refreshType, setRefreshType] = useState<"since_last_refresh" | "full_period">("since_last_refresh");
  const [refreshToggles, setRefreshToggles] = useState<RefreshToggles>(() => loadRefreshToggles() ?? DEFAULT_REFRESH_TOGGLES);
  const [packToDisableAutoRefresh, setPackToDisableAutoRefresh] = useState<{ id: string; name: string } | null>(null);
  const [isTogglingAutoRefresh, setIsTogglingAutoRefresh] = useState<string | null>(null);
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
  const { isLoading: isLoadingPacks } = usePacksLoading();

  // API hooks
  const { data: adAccountsData = [], isLoading: adAccountsLoading } = useAdAccountsDb({
    enabled: isDialogOpen,
    populateStore: false,
  });

  // Para o modal de refresh: habilita botão Confirmar apenas se ao menos um processo estiver selecionado
  const refreshModalPack = packToRefresh ? packs.find((p) => p.id === packToRefresh.id) : null;
  const hasSheetIntegrationInModal = !!refreshModalPack?.sheet_integration?.id;
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

    setPackToRefresh({
      id: pack.id,
      name: pack.name,
    });
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

  const cancelRefreshPack = () => {
    // Verifica se algum pack está atualizando
    const currentPackId = packToRefresh?.id;
    if (currentPackId && isRefreshing(currentPackId)) return; // Não permite cancelar durante o refresh
    setPackToRefresh(null);
    setRefreshType("since_last_refresh"); // Resetar para padrão
  };

  /**
   * Confirma e executa o refresh do pack usando o hook centralizado
   */
  const confirmRefreshPack = async () => {
    if (!packToRefresh) return;

    const packId = packToRefresh.id;
    const packName = packToRefresh.name;
    const pack = packs.find((p) => p.id === packId);
    const hasSheetIntegration = !!pack?.sheet_integration?.id;

    // Toggles efetivos: leadscore só conta se o pack tiver integração
    const effectiveToggles: RefreshToggles = {
      ...refreshToggles,
      leadscore: refreshToggles.leadscore && hasSheetIntegration,
    };

    // Persistir preferência dos toggles para a próxima abertura do modal
    saveRefreshToggles(refreshToggles);

    // Fechar modal imediatamente após confirmar
    setPackToRefresh(null);

    // Usar hook centralizado para refresh (processos independentes conforme toggles)
    await refreshPack({
      packId,
      packName,
      refreshType,
      sheetIntegrationId: pack?.sheet_integration?.id,
      toggles: effectiveToggles,
    });
  };

  const handleEditSheetIntegration = (pack: AdsPack) => {
    setSheetIntegrationPack(pack);
  };

  const handleDeleteSheetIntegration = async (pack: AdsPack) => {
    if (!pack.sheet_integration?.id) return;

    if (!confirm(`Tem certeza que deseja remover a integração de planilha do pack "${pack.name}"?`)) {
      return;
    }

    try {
      await api.integrations.google.deleteSheetIntegration(pack.sheet_integration.id);
      showSuccess("Integração removida com sucesso!");

      // Recarregar packs para atualizar dados
      try {
        const response = await api.analytics.listPacks(false);
        if (response.success && response.packs) {
          const updatedPack = response.packs.find((p: any) => p.id === pack.id);
          if (updatedPack) {
            updatePack(pack.id, {
              sheet_integration: updatedPack.sheet_integration || null,
            } as Partial<AdsPack>);
          }
        }
      } catch (error) {
        logger.error("Erro ao recarregar pack após deletar integração:", error);
      }
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
              Carregar Pack
            </Button>
            <PacksOverflowMenu />
          </PageActions>
        }
      >
        <PageBodyStack>
        {/* Packs Grid */}
        {isLoadingPacks ? (
          <StateSkeleton variant="page" rows={4} className="rounded-md border border-border bg-card" />
        ) : packs.length === 0 ? (
          <StatePanel
            kind="empty"
            icon={IconChartBar}
            title="Nenhum Pack Carregado"
            message="Carregue seu primeiro pack de anúncios para começar a análise"
            density="spacious"
            action={
              <Button onClick={() => setIsDialogOpen(true)}>
                <IconPlus className="w-4 h-4 mr-2" />
                Carregar Primeiro Pack
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {packs.map((pack) => (
              <PackCard key={pack.id} pack={pack} formatCurrency={formatCurrency} formatDate={formatDate} onRefresh={handleRefreshPack} onRemove={handleRemovePack} onToggleAutoRefresh={handleToggleAutoRefresh} onSetSheetIntegration={setSheetIntegrationPack} onEditSheetIntegration={handleEditSheetIntegration} onDeleteSheetIntegration={handleDeleteSheetIntegration} onTranscribeAds={(packId, packName) => startTranscriptionOnly(packId, packName)} isUpdating={isPackUpdating(pack.id)} isTogglingAutoRefresh={isTogglingAutoRefresh} packToDisableAutoRefresh={packToDisableAutoRefresh} />
            ))}
          </div>
        )}
        </PageBodyStack>
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
            <p className={packNameDuplicateError ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{packNameDuplicateError ? "Já existe um pack com esse nome. Escolha outro." : "Dê um nome descritivo para identificar facilmente seu pack"}</p>
          </div>

          {/* Ad Account */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Conta de Anúncios</label>
            {adAccountsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <IconLoader2 className="w-4 h-4 animate-spin" />
                Carregando contas de anúncios...
              </div>
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
            {Array.isArray(adAccountsData) && adAccountsData.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {adAccountsData.length} {adAccountsData.length === 1 ? "conta disponível" : "contas disponíveis"}
              </p>
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
                  labelClassName={formData.date_stop !== getTodayLocal() ? "text-muted-foreground cursor-not-allowed" : "cursor-pointer"}
                />
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <IconInfoCircle className="w-4 h-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{formData.date_stop !== getTodayLocal() ? "Disponível apenas quando a data final é hoje." : "Quando ativado, o pack será atualizado automaticamente."}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
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
              <div key={index} className="grid grid-cols-12 gap-2 items-end">
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
                <div className="col-span-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => handleRemoveFilter(index)}>
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
      <AppDialog isOpen={!!packToRefresh} onClose={cancelRefreshPack} title="Atualizar Pack" size="md" padding="md" closeOnOverlayClick closeOnEscape showCloseButton>
        <div className="flex flex-col gap-5 py-4">
          <div>
            <h2 className="text-xl font-semibold text-text mb-1">Atualizar Pack?</h2>
            <p className="text-sm text-text-muted">
              Deseja atualizar o pack <strong>"{packToRefresh?.name}"</strong>? Escolha o tipo de atualização:
            </p>
          </div>

          {/* Toggles: Meta, Leadscore, Transcrição */}
          {(() => {
            const pack = packToRefresh ? packs.find((p) => p.id === packToRefresh.id) : null;
            const hasSheetIntegration = !!pack?.sheet_integration?.id;
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
                  <ToggleSwitch id="refresh-toggle-transcription" checked={refreshToggles.transcription} onCheckedChange={(checked) => setRefreshToggles((prev) => ({ ...prev, transcription: checked }))} label="Transcrição" variant="minimal" icon={<IconMicrophone className="h-4 w-4 flex-shrink-0 text-warning" />} />
                </div>
              </div>
            );
          })()}

          {/* Opções de período */}
          {(() => {
            const pack = refreshModalPack;
            const formatDateDisplay = (s: string) => {
              if (!s) return "";
              const [y, m, d] = s.split("-");
              return `${d}/${m}/${y}`;
            };
            const today = getTodayLocal();
            const sinceLastRange = pack?.last_refreshed_at ? `${formatDateDisplay(formatDateLocal(subDays(new Date(pack.last_refreshed_at + "T12:00:00"), 1)))} → ${formatDateDisplay(today)}` : "—";
            const fullPeriodRange = pack?.date_start && pack?.date_stop ? (pack.auto_refresh ? `${formatDateDisplay(pack.date_start)} → ${formatDateDisplay(today)}` : `${formatDateDisplay(pack.date_start)} → ${formatDateDisplay(pack.date_stop)}`) : "—";
            return (
              <div className="w-full space-y-2">
                <button type="button" onClick={() => setRefreshType("since_last_refresh")} className={`w-full p-3 rounded-lg border-2 text-left transition-all cursor-pointer ${refreshType === "since_last_refresh" ? "border-primary bg-primary-10" : "border-border hover:border-primary-50 bg-input-30"}`}>
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${refreshType === "since_last_refresh" ? "border-primary" : "border-border"}`}>{refreshType === "since_last_refresh" && <div className="w-2 h-2 rounded-full bg-primary" />}</div>
                    <div>
                      <div className="font-semibold text-text text-sm">Desde a última atualização</div>
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
    </>
  );
}




