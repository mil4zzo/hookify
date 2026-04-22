"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { TopbarFilters } from "@/components/layout/TopbarFilters";
import { Button } from "@/components/ui/button";
import { useClientAuth, useClientPacks } from "@/lib/hooks/useClientSession";
import { useAuthManager } from "@/lib/hooks/useAuthManager";
import { useFacebookAccountConnection } from "@/lib/hooks/useFacebookAccountConnection";
import { useFacebookConnectionVerification } from "@/lib/hooks/useFacebookConnectionVerification";
import { FacebookConnectionCard } from "@/components/facebook/FacebookConnectionCard";
import { showError, showSuccess, showWarning } from "@/lib/utils/toast";
import { AuthPopupError } from "@/lib/utils/authPopup";
import { getAggregatedPackStatistics } from "@/lib/utils/adCounting";
import { IconChartBar, IconMenu2, IconX, IconLogout, IconUser, IconUserFilled, IconUsers, IconBell, IconPlus, IconSettings, IconBrandFacebook, IconLoader2, IconBrandFacebookFilled, IconMoon, IconSun, IconCheck, IconAlertCircle, IconTarget, IconTrash, IconRefresh } from "@tabler/icons-react";
import { Modal } from "@/components/common/Modal";
import { AppDialog } from "@/components/common/AppDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { useSettings } from "@/lib/store/settings";
import { useSessionStore } from "@/lib/store/session";
import { useSettingsModalStore } from "@/lib/store/settingsModal";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { pageTitles } from "@/lib/config/pageConfig";
import { DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useAutoRefreshPacks } from "@/lib/hooks/useAutoRefreshPacks";
import { AutoRefreshConfirmModal } from "@/components/common/AutoRefreshConfirmModal";
import { formatToTitleCase } from "@/lib/utils/formatName";
import ServerStatusBanner from "./ServerStatusBanner";
import { ValidationCriteriaBuilder, ValidationCondition } from "@/components/common/ValidationCriteriaBuilder";
import { useValidationCriteria } from "@/lib/hooks/useValidationCriteria";
import { useMqlLeadscore } from "@/lib/hooks/useMqlLeadscore";
import { useCurrency } from "@/lib/hooks/useCurrency";
import { useLanguage } from "@/lib/hooks/useLanguage";
import { useNiche } from "@/lib/hooks/useNiche";
import { api } from "@/lib/api/endpoints";
import { useSyncAdAccounts } from "@/lib/api/hooks";
import { clearAllPacks } from "@/lib/storage/indexedDB";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useSupabaseAuth } from "@/lib/hooks/useSupabaseAuth";
import { useQueryClient } from "@tanstack/react-query";
import { UpdatedAtText } from "@/components/common/UpdatedAtText";
import { useGoogleReconnectHandler } from "@/lib/hooks/useGoogleReconnectHandler";
import { TabbedContent, TabbedContentItem, type TabItem } from "@/components/common/TabbedContent";
import { usePackRefresh } from "@/lib/hooks/usePackRefresh";
import { cn } from "@/lib/utils/cn";
import { getFacebookAvatarUrl } from "@/lib/utils/facebookAvatar";

export default function Topbar() {
  // TODOS OS HOOKS DEVEM SER CHAMADOS ANTES DE QUALQUER EARLY RETURN
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { isOpen: isSettingsOpen, activeTab: activeSettingsTab, openSettings, closeSettings, setActiveTab: setActiveSettingsTab } = useSettingsModalStore();
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const { criteria: validationCriteria, updateCriteria: setValidationCriteria, isLoading: isLoadingCriteria, isSaving: isSavingCriteria, saveCriteria } = useValidationCriteria();
  const { mqlLeadscoreMin, isLoading: isLoadingMql, isSaving: isSavingMql, updateMqlLeadscoreMin, saveMqlLeadscoreMin } = useMqlLeadscore();
  const { currency: userCurrency, isLoading: isLoadingCurrency, isSaving: isSavingCurrency, saveCurrency } = useCurrency();
  const { language: userLanguage, isLoading: isLoadingLanguage, isSaving: isSavingLanguage, saveLanguage } = useLanguage();
  const { niche: userNiche, isLoading: isLoadingNiche, isSaving: isSavingNiche, updateNiche, saveNiche } = useNiche();
  const { isAuthenticated, user, isClient } = useClientAuth();
  const { packs } = useClientPacks();
  const { handleLogout } = useAuthManager();
  const { settings, setLanguage, setNiche, updateSettings } = useSettings();
  const { connections, connect, disconnect, refreshPicture, activeConnections, expiredConnections, hasActiveConnection, hasExpiredConnections } = useFacebookAccountConnection();
  const { verifyConnections, clearConnectionCache } = useFacebookConnectionVerification();
  const syncAdAccounts = useSyncAdAccounts();
  const { user: supabaseUser } = useSupabaseAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const [isDeletingData, setIsDeletingData] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [showDeleteDataConfirm, setShowDeleteDataConfirm] = useState(false);
  const [showDeleteAccountConfirm, setShowDeleteAccountConfirm] = useState(false);
  const [deleteAccountInput, setDeleteAccountInput] = useState("");
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [isConfirmingUpdate, setIsConfirmingUpdate] = useState(false);
  const [profilePopupAvatarError, setProfilePopupAvatarError] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const { refreshPack, isRefreshing, refreshingPackIds } = usePackRefresh();

  // Hook para retomar jobs pausados quando o Google for reconectado
  useGoogleReconnectHandler();

  // Verificar conexões quando carregarem na aba de contas
  useEffect(() => {
    if (isSettingsOpen && activeSettingsTab === "accounts" && connections.data && connections.data.length > 0) {
      const connectionIds = connections.data.map((c: any) => c.id);
      verifyConnections(connectionIds);
    }
  }, [isSettingsOpen, activeSettingsTab, connections.data, verifyConnections]);
  const { showModal, packCount, autoRefreshPacks, handleConfirm, handleCancel } = useAutoRefreshPacks();

  // Initialize theme
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = (localStorage.getItem("theme") as "dark" | "light") || "dark";
      setTheme(saved);
      if (typeof document !== "undefined") {
        document.documentElement.setAttribute("data-theme", saved);
      }
    }
  }, []);

  // Stats dos packs são carregados globalmente por PacksLoader/useLoadPacks

  const toggleTheme = () => {
    const next: "dark" | "light" = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-theme", next);
    }
    if (typeof window !== "undefined") {
      localStorage.setItem("theme", next);
    }
  };

  // Não mostrar em rotas de autenticação (DEPOIS de todos os hooks)
  const isAuthRoute = pathname?.startsWith("/login") || pathname?.startsWith("/signup") || pathname?.startsWith("/callback");

  if (isAuthRoute) {
    return null;
  }

  // Calculate statistics
  const packStats = getAggregatedPackStatistics(packs);

  // Obter título e ícone da página atual
  const pageInfo = pageTitles[pathname] || { title: "Hookify" };
  const { title, icon: Icon } = pageInfo;

  const handleLogoutClick = async () => {
    await handleLogout();
    // handleLogout faz o redirect usando window.location.href para forçar reload completo
  };

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  // Só considera que tem conexão quando não está carregando E há conexões ativas
  const hasFacebookConnection = hasActiveConnection;

  // Foto de perfil do Facebook (conexão primária ou primeira ativa)
  const facebookAvatarUrl = useMemo(() => {
    if (!activeConnections || activeConnections.length === 0) return null;
    const primary = activeConnections.find((c: any) => c.is_primary);
    const conn = primary || activeConnections[0];
    return getFacebookAvatarUrl(conn);
  }, [activeConnections]);
  // Só mostra botão de conectar quando carregamento terminou E não há conexões ativas
  const shouldShowConnectButton = !connections.isLoading && !hasActiveConnection;

  const handleConnectFacebook = async () => {
    try {
      await connect.mutateAsync({});
    } catch (error) {
      const authError = error as AuthPopupError;
      if (authError?.code === "AUTH_POPUP_CLOSED") return; // Cancelamento pelo usuário — não mostrar toast
      showError(error as any);
    }
  };

  const handleReconnectFacebook = async () => {
    try {
      await connect.mutateAsync({ reauth: true });
      syncAdAccounts.mutate();
    } catch (error) {
      const authError = error as AuthPopupError;
      if (authError?.code === "AUTH_POPUP_CLOSED") return;
      showError(error as any);
    }
  };

  const handleRefreshPicture = async (connectionId: string) => {
    try {
      await refreshPicture.mutateAsync(connectionId);
    } catch (error) {
      showError(error as any);
    }
  };

  // Função para excluir dados do usuário (manter conta)
  const handleDeleteUserData = async () => {
    setIsDeletingData(true);
    try {
      await api.user.deleteData();
      await clearAllPacks();
      // Limpar packs do Zustand store para atualizar Topbar imediatamente
      useSessionStore.setState({ packs: [], adAccounts: [] });
      queryClient.clear();
      showSuccess("Seus dados foram excluídos com sucesso. Sua conta foi mantida.");
      setShowDeleteDataConfirm(false);
      closeSettings();
      router.push("/packs");
    } catch (error) {
      showError(error as any);
    } finally {
      setIsDeletingData(false);
    }
  };

  // Função para excluir conta completa (irreversível)
  const handleDeleteAccount = async () => {
    if (deleteAccountInput !== "EXCLUIR") {
      showWarning('Digite exatamente "EXCLUIR" para confirmar.');
      return;
    }
    setIsDeletingAccount(true);
    try {
      await api.user.deleteAccount();
      await clearAllPacks();
      // Resetar todo o estado da sessão (packs, user, token, etc.)
      useSessionStore.getState().logout();
      queryClient.clear();
      setShowDeleteAccountConfirm(false);
      setDeleteAccountInput("");
      closeSettings();
      router.push("/login?logout=true");
    } catch (error) {
      showError(error as any);
    } finally {
      setIsDeletingAccount(false);
    }
  };

  // Função para extrair iniciais do nome do usuário
  const getUserInitials = (user: any): string | null => {
    const name = user?.user_metadata?.name || user?.user_metadata?.full_name;

    if (!name || name.trim().length === 0) {
      return null;
    }

    const nameParts = name
      .trim()
      .split(/\s+/)
      .filter((part: string) => part.length > 0);

    if (nameParts.length >= 2) {
      // Tem nome e sobrenome: primeira letra do nome + primeira letra do último sobrenome
      const firstName = nameParts[0];
      const lastName = nameParts[nameParts.length - 1];
      return (firstName[0] + lastName[0]).toUpperCase();
    } else if (nameParts.length === 1) {
      // Tem apenas nome: duas primeiras letras do nome
      const firstName = nameParts[0];
      if (firstName.length >= 2) {
        return firstName.substring(0, 2).toUpperCase();
      } else {
        return firstName[0].toUpperCase();
      }
    }

    return null;
  };

  // URL única do avatar (Facebook prioridade; depois Supabase) para trigger e popup usarem a mesma fonte/cache
  const displayAvatarUrl = facebookAvatarUrl || user?.user_metadata?.avatar_url || null;

  useEffect(() => {
    setProfilePopupAvatarError(false);
  }, [displayAvatarUrl]);

  useEffect(() => {
    if (profileMenuOpen) setProfilePopupAvatarError(false);
  }, [profileMenuOpen]);

  // Função para renderizar o menu dropdown do perfil com Radix
  const renderProfileMenu = () => {
    if (!isAuthenticated || !user) return null;

    const initials = getUserInitials(user);

    const renderTriggerAvatar = () => {
      if (displayAvatarUrl) {
        return <img src={displayAvatarUrl} alt="Profile" className="w-full h-full object-cover" referrerPolicy="no-referrer" />;
      }
      if (initials) {
        return (
          <div className="w-full h-full bg-brand flex items-center justify-center">
            <span className="text-sm font-semibold text-primary-foreground">{initials}</span>
          </div>
        );
      }
      return (
        <div className="w-full h-full bg-brand flex items-center justify-center">
          <IconUserFilled className="h-5 w-5 text-primary-foreground" />
        </div>
      );
    };

    return (
      <DropdownMenu open={profileMenuOpen} onOpenChange={setProfileMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button className="relative flex items-center justify-center w-10 h-10 rounded-full overflow-hidden hover:ring-2 hover:ring-border transition-all focus:outline-none focus:ring-2 focus:ring-info" aria-label="Perfil do usuário">
            {renderTriggerAvatar()}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {/* User Info: mesma displayAvatarUrl que o trigger; onError evita ícone genérico quando a img falha no portal */}
          <div className="p-4">
            <div className="flex items-center gap-3">
              {displayAvatarUrl && !profilePopupAvatarError ? (
                <img
                  src={displayAvatarUrl}
                  alt="Profile"
                  className="w-12 h-12 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                  onError={() => setProfilePopupAvatarError(true)}
                />
              ) : initials ? (
                <div className="w-12 h-12 bg-brand rounded-full flex items-center justify-center">
                  <span className="text-base font-semibold text-primary-foreground">{initials}</span>
                </div>
              ) : (
                <div className="w-12 h-12 bg-brand rounded-full flex items-center justify-center">
                  <IconUserFilled className="h-6 w-6 text-primary-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-text truncate">{formatToTitleCase(user.user_metadata?.name || user.user_metadata?.full_name) || user.email?.split("@")[0] || "Usuário"}</p>
                <p className="text-sm text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>
          </div>

          <DropdownMenuSeparator />

          <DropdownMenuItem onSelect={() => {}} className="flex items-center gap-2">
            <IconBell className="h-4 w-4" />
            Notificações
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => toggleTheme()} className="flex items-center gap-2">
            {theme === "dark" ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
            {theme === "dark" ? "Modo Claro" : "Modo Escuro"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openSettings()} className="flex items-center gap-2">
            <IconSettings className="h-4 w-4" />
            Configurações
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleLogoutClick} className="flex items-center gap-2">
            <IconLogout className="h-4 w-4" />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // Função para selecionar um pack para atualização
  const handleSelectPack = (packId: string) => {
    setSelectedPackId(packId);
    setIsConfirmingUpdate(true);
  };

  // Função para cancelar confirmação
  const handleCancelConfirmation = () => {
    // Verifica se algum pack está atualizando
    if (selectedPackId && isRefreshing(selectedPackId)) return;
    setIsConfirmingUpdate(false);
    setSelectedPackId(null);
  };

  /**
   * Confirma e executa a atualização usando o hook centralizado
   */
  const handleConfirmUpdate = async () => {
    if (!selectedPackId) return;

    const pack = packs.find((p) => p.id === selectedPackId);
    if (!pack) {
      showError({ message: "Pack não encontrado" });
      return;
    }

    // Fechar modal imediatamente após confirmar
    setIsConfirmingUpdate(false);
    setSelectedPackId(null);

    // Usar hook centralizado para refresh
    await refreshPack({
      packId: pack.id,
      packName: pack.name,
      refreshType: "since_last_refresh",
      sheetIntegrationId: (pack as any).sheet_integration?.id,
    });
  };

  // Função auxiliar para formatar data de YYYY-MM-DD para DD/MM/YYYY
  const formatDate = (dateString: string) => {
    if (!dateString) return "";
    const [year, month, day] = dateString.split("-");
    return `${day}/${month}/${year}`;
  };

  // Função para renderizar o botão de Atualizar Dados
  const renderUpdateDataButton = () => {
    if (!isAuthenticated || !hasFacebookConnection || packs.length === 0) return null;

    // Se está atualizando, mostra botão desabilitado
    if (refreshingPackIds.length > 0) {
      return (
        <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" disabled aria-label="Atualizando dados">
          <IconLoader2 className="h-4 w-4 animate-spin" />
        </Button>
      );
    }

    // Se há apenas um pack, vai direto para confirmação ao clicar
    if (packs.length === 1) {
      return (
        <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => handleSelectPack(packs[0].id)} aria-label="Atualizar dados">
          <IconRefresh className="h-4 w-4" />
        </Button>
      );
    }

    // Se há múltiplos packs, mostra dropdown
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" aria-label="Atualizar dados">
            <IconRefresh className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="bg-card">Atualizar pack:</DropdownMenuLabel>
          {packs.map((pack) => (
            <DropdownMenuItem key={pack.id} onClick={() => handleSelectPack(pack.id)} className="flex flex-col items-start gap-1 py-3">
              <div className="flex items-center justify-between w-full">
                <span className="font-medium text-text truncate flex-1">{pack.name}</span>
                <IconRefresh className="h-4 w-4 text-muted-foreground flex-shrink-0 ml-2" />
              </div>
              <div className="flex flex-col items-start gap-0.5 w-full">
                <span className="text-xs text-muted-foreground">
                  {formatDate(pack.date_start)} → {formatDate(pack.date_stop)}
                </span>
                <UpdatedAtText dateTime={pack.updated_at} className="text-xs text-muted-foreground" />
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // Render functions para conteúdo dos tabs de Configurações (fonte única para desktop e mobile)
  const renderGeneralTabContent = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-text mb-6">Preferências</h3>
      </div>

      <div className="space-y-4">
        {/* Idioma */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-text">Idioma</label>
          <Select
            value={userLanguage}
            onValueChange={async (value) => {
              try {
                await saveLanguage(value);
                showSuccess("Idioma atualizado com sucesso");
              } catch (error) {
                console.error("Erro ao salvar idioma:", error);
                showError({ message: "Erro ao salvar idioma" });
              }
            }}
            disabled={isLoadingLanguage || isSavingLanguage}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione um idioma" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pt-BR">Português</SelectItem>
              <SelectItem value="en-US" disabled>
                Inglês
              </SelectItem>
              <SelectItem value="es-ES" disabled>
                Espanhol
              </SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{isSavingLanguage ? "Salvando..." : "O idioma será aplicado em todas as páginas do app"}</p>
        </div>

        {/* Moeda */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-text">Moeda</label>
          <Select
            value={userCurrency}
            onValueChange={async (value) => {
              try {
                await saveCurrency(value);
                showSuccess("Moeda atualizada com sucesso");
              } catch (error) {
                console.error("Erro ao salvar moeda:", error);
              }
            }}
            disabled={isLoadingCurrency || isSavingCurrency}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione uma moeda" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">USD - Dólar Americano ($)</SelectItem>
              <SelectItem value="EUR">EUR - Euro (€)</SelectItem>
              <SelectItem value="GBP">GBP - Libra Esterlina (£)</SelectItem>
              <SelectItem value="BRL">BRL - Real Brasileiro (R$)</SelectItem>
              <SelectItem value="MXN">MXN - Peso Mexicano ($)</SelectItem>
              <SelectItem value="CAD">CAD - Dólar Canadense ($)</SelectItem>
              <SelectItem value="AUD">AUD - Dólar Australiano ($)</SelectItem>
              <SelectItem value="JPY">JPY - Iene Japonês (¥)</SelectItem>
              <SelectItem value="CNY">CNY - Yuan Chinês (¥)</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{isSavingCurrency ? "Salvando..." : "A moeda será aplicada em todas as páginas do app"}</p>
        </div>

        {/* Nicho */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-text">Nicho</label>
          <Input
            type="text"
            placeholder="Ex: E-commerce, SaaS, etc."
            value={userNiche}
            onChange={(e) => {
              updateNiche(e.target.value);
            }}
            onBlur={async (e) => {
              const newValue = e.target.value;
              try {
                await saveNiche(newValue);
                showSuccess("Nicho atualizado com sucesso");
              } catch (error) {
                console.error("Erro ao salvar nicho:", error);
                showError({ message: "Erro ao salvar nicho" });
              }
            }}
            disabled={isLoadingNiche || isSavingNiche}
            className={isLoadingNiche || isSavingNiche ? "bg-border-50" : ""}
          />
          <p className="text-xs text-muted-foreground">{isSavingNiche ? "Salvando..." : "Digite o nicho do seu negócio (ex: E-commerce, SaaS, etc.)"}</p>
        </div>
      </div>
    </div>
  );

  const renderAccountsTabContent = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-text mb-6">Contas</h3>
      </div>

      {connections.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : connections.data && connections.data.length > 0 ? (
        <div className="space-y-3">
          {connections.data.map((connection: any) => (
            <FacebookConnectionCard
              key={connection.id}
              connection={connection}
              onReconnect={() => {
                void handleReconnectFacebook();
              }}
              onRefreshPicture={handleRefreshPicture}
              onVerify={() => syncAdAccounts.mutate()}
              onDelete={async (connectionId) => {
                try {
                  clearConnectionCache(connectionId);
                  await disconnect.mutateAsync(connectionId);
                  showSuccess("Conta desconectada com sucesso!");
                } catch (error) {
                  showError(error as any);
                }
              }}
              isDeleting={disconnect.isPending}
              showActions={true}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <IconBrandFacebook className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground mb-4">Nenhuma conta do Facebook conectada</p>
          <Button variant="default" onClick={handleConnectFacebook} disabled={connect.isPending} className="flex items-center gap-2 mx-auto">
            {connect.isPending ? <IconLoader2 className="h-4 w-4 animate-spin" /> : <IconBrandFacebook className="h-4 w-4" />}
            {connect.isPending ? "Conectando..." : "Conectar Facebook"}
          </Button>
        </div>
      )}

      {/* Zona de perigo */}
      <div className="mt-8 pt-6 border-t border-destructive-20 space-y-4">
        <h4 className="text-sm font-semibold text-destructive">Zona de perigo</h4>

        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text">Excluir meus dados</p>
            <p className="text-xs text-muted-foreground">Remove todos os dados (packs, métricas, anúncios, conexões e configurações). Sua conta Hookify será mantida.</p>
          </div>
          <Button variant="destructiveOutline" size="sm" className="flex-shrink-0" onClick={() => setShowDeleteDataConfirm(true)}>
            <IconTrash className="h-4 w-4 mr-1" />
            Excluir dados
          </Button>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-text">Excluir minha conta</p>
            <p className="text-xs text-muted-foreground">Remove permanentemente sua conta e todos os dados associados. Esta ação é irreversível.</p>
          </div>
          <Button variant="destructive" size="sm" className="flex-shrink-0" onClick={() => setShowDeleteAccountConfirm(true)}>
            <IconTrash className="h-4 w-4 mr-1" />
            Excluir conta
          </Button>
        </div>
      </div>
    </div>
  );

  const renderValidationTabContent = () => (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-text">Critério de validação</h3>
          {(isLoadingCriteria || isSavingCriteria) && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {isLoadingCriteria && (
                <>
                  <IconLoader2 className="h-4 w-4 animate-spin" />
                  <span>Carregando...</span>
                </>
              )}
              {isSavingCriteria && !isLoadingCriteria && (
                <>
                  <IconLoader2 className="h-4 w-4 animate-spin" />
                  <span>Salvando...</span>
                </>
              )}
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground mb-4">Configure os critérios de validação para os anúncios. Use condições individuais ou grupos de condições com operadores lógicos AND/OR.</p>
      </div>
      <div className="space-y-4">
        {isLoadingCriteria ? (
          <div className="flex items-center justify-center py-12">
            <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ValidationCriteriaBuilder
            value={validationCriteria}
            onChange={setValidationCriteria}
            onSave={async (criteria) => {
              await saveCriteria(criteria);
            }}
            isSaving={isSavingCriteria}
          />
        )}
      </div>
    </div>
  );

  const renderLeadscoreTabContent = () => (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-text">Configuração de Leadscore</h3>
          {(isLoadingMql || isSavingMql) && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {isLoadingMql && (
                <>
                  <IconLoader2 className="h-4 w-4 animate-spin" />
                  <span>Carregando...</span>
                </>
              )}
              {isSavingMql && !isLoadingMql && (
                <>
                  <IconLoader2 className="h-4 w-4 animate-spin" />
                  <span>Salvando...</span>
                </>
              )}
            </div>
          )}
        </div>
        <p className="text-sm text-muted-foreground mb-4">Defina o leadscore mínimo para considerar um lead como MQL (Marketing Qualified Lead). Leads com leadscore maior ou igual a este valor serão contabilizados como MQLs e utilizados para calcular métricas como quantidade de MQLs e custo por MQL.</p>
      </div>

      <div className="space-y-4">
        {isLoadingMql ? (
          <div className="flex items-center justify-center py-12">
            <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium text-text">Leadscore mínimo para MQL</label>
              <Input
                type="number"
                min="0"
                step="0.1"
                value={mqlLeadscoreMin}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  if (!isNaN(value) && value >= 0) {
                    updateMqlLeadscoreMin(value);
                  }
                }}
                disabled={isLoadingMql || isSavingMql}
                className="w-full [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none [-moz-appearance:textfield]"
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">Leads com leadscore &gt;= {mqlLeadscoreMin.toFixed(1)} serão considerados MQLs</p>
            </div>

            <Button
              onClick={async () => {
                try {
                  await saveMqlLeadscoreMin(mqlLeadscoreMin);
                  showSuccess("Configuração de leadscore salva com sucesso!");
                } catch (err) {
                  showError(err as any);
                }
              }}
              disabled={isLoadingMql || isSavingMql}
              className="w-full sm:w-auto"
            >
              {isSavingMql ? (
                <>
                  <IconLoader2 className="h-4 w-4 animate-spin mr-2" />
                  Salvando...
                </>
              ) : (
                "Salvar configuração"
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  );

  if (!isClient) {
    return (
      <>
        <ServerStatusBanner />
        <header className="z-40 w-full border-b border-border bg-background-95 backdrop-blur supports-[backdrop-filter]:bg-background-60">
          <div className="container mx-auto flex h-16 items-center justify-between px-4">
            <div className="flex items-center gap-3 flex-shrink-0">
              <h1 className="text-xl font-bold text-text">Hookify</h1>
            </div>
            {/* Center placeholder — keeps layout stable during SSR */}
            <div className="flex-1" />
            <div className="flex items-center gap-4">
              {isAuthenticated && (
                <>
                  {/* Stats Info - only show when authenticated and has packs */}
                  {packs.length > 0 && (
                    <div className="flex flex-col items-end gap-0 pr-3 border-r border-border">
                      <p className="text-xs font-medium text-text leading-tight">
                        {packs.length} {packs.length === 1 ? "pack" : "packs"}
                      </p>
                      <p className="text-xs font-medium text-muted-foreground leading-tight">
                        {packStats.uniqueAds} {packStats.uniqueAds === 1 ? "anúncio" : "anúncios"}
                      </p>
                    </div>
                  )}

                  {connections.isLoading ? (
                    <Skeleton className="h-9 w-[140px] rounded-md" />
                  ) : shouldShowConnectButton ? (
                    <Button variant="default" size="sm" onClick={handleConnectFacebook} disabled={connect.isPending} className="flex items-center gap-2">
                      {connect.isPending ? <IconLoader2 className="h-4 w-4 animate-spin" /> : <IconBrandFacebook className="h-4 w-4" />}
                      {connect.isPending ? "Conectando..." : "Conectar Facebook"}
                    </Button>
                  ) : hasFacebookConnection ? (
                    renderUpdateDataButton()
                  ) : null}

                  {/* Profile Avatar - apenas visual no SSR */}
                  {user ? (
                    renderProfileMenu()
                  ) : (
                    <Button asChild size="sm">
                      <Link href="/login">Entrar</Link>
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </header>
      </>
    );
  }

  return (
    <>
      <ServerStatusBanner />
      <header className="z-40 w-full border-b border-border bg-background-95 backdrop-blur supports-[backdrop-filter]:bg-background-60">
        {/* Layout unificado: um único container evita duplicar renderProfileMenu (que causava 2 popups) */}
        <div className="container mx-auto flex h-16 items-center justify-between gap-3 px-4 md:px-8">
          {/* Left: Título (desktop) ou Logo (mobile) */}
          <div className="flex min-w-0 items-center gap-3 flex-shrink-0">
            <div className="hidden md:flex md:items-center md:gap-3">
              {Icon && <Icon className="h-6 w-6 text-brand" />}
              <h1 className="text-2xl font-bold text-text">{title}</h1>
            </div>
            <Link href="/" className="flex md:hidden items-center hover:opacity-80 transition-opacity flex-shrink-0">
              <Image src="/logo-hookify-alpha.png" alt="Hookify" width={80} height={21} className="h-[21px] w-[80px]" priority />
            </Link>
          </div>

          {/* Center: global filters (desktop only) */}
          <div className="flex-1 flex items-center justify-center min-w-0">
            <TopbarFilters />
          </div>

          {/* Right: seção única com update/reset/profile (profile menu renderizado apenas 1x) */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {/* Conectar Facebook ou Atualizar Dados Button - only show when authenticated */}
            {isAuthenticated && (
              <>
                {/* Stats Info - only show when authenticated and has packs */}
                {isClient && packs.length > 0 && (
                  <div className="hidden md:flex flex-col items-end gap-0 pr-3 border-r border-border">
                    <p className="text-xs font-medium text-text leading-tight">
                      {packs.length} {packs.length === 1 ? "pack" : "packs"}
                    </p>
                    <p className="text-xs font-medium text-muted-foreground leading-tight">
                      {packStats.uniqueAds} {packStats.uniqueAds === 1 ? "anúncio" : "anúncios"}
                    </p>
                  </div>
                )}

                {connections.isLoading ? (
                  <Skeleton className="h-9 w-[140px] rounded-md" />
                ) : shouldShowConnectButton ? (
                  <Button variant="default" size="sm" onClick={handleConnectFacebook} disabled={connect.isPending} className="flex items-center gap-2">
                    {connect.isPending ? <IconLoader2 className="h-4 w-4 animate-spin" /> : <IconBrandFacebook className="h-4 w-4" />}
                    {connect.isPending ? "Conectando..." : "Conectar Facebook"}
                  </Button>
                ) : hasFacebookConnection ? (
                  renderUpdateDataButton()
                ) : null}
              </>
            )}

            {/* Profile Avatar - única instância (evita 2 popups ao abrir) */}
            {isAuthenticated && user ? (
              renderProfileMenu()
            ) : !isAuthenticated ? (
              <Button asChild size="sm">
                <Link href="/login">Entrar</Link>
              </Button>
            ) : null}
          </div>
        </div>

        {/* Settings Modal - Shared between mobile and desktop (AppDialog = Radix, foco acessível) */}
        {isAuthenticated && (
          <AppDialog isOpen={isSettingsOpen} onClose={closeSettings} size="4xl" padding="none" title="Configurações" mobileVariant="bottom-sheet" className="max-w-none md:max-w-4xl">
            <div className="flex flex-col h-[90vh] md:flex-row md:h-[600px] md:max-h-[90vh] overflow-hidden">
              {/* Mobile: Header with drag indicator + Title */}
              <div className="md:hidden">
                <div className="flex justify-center pt-2 pb-1">
                  <div className="w-10 h-1 rounded-full bg-border" />
                </div>
                <div className="flex items-center justify-between px-5 pb-3">
                  <h2 className="text-lg font-semibold text-text">Configurações</h2>
                </div>
                {/* Mobile: Tabs horizontal */}
                <div className="border-b border-border">
                  <div className="flex overflow-x-auto px-1">
                    {([
                      { value: "general", label: "Preferências", icon: IconSettings },
                      { value: "accounts", label: "Contas", icon: IconUsers },
                      { value: "validation", label: "Validação", icon: IconCheck },
                      { value: "leadscore", label: "Leadscore", icon: IconTarget },
                    ] as const).map((tab) => {
                      const Icon = tab.icon;
                      const isActive = activeSettingsTab === tab.value;
                      return (
                        <button
                          key={tab.value}
                          onClick={() => setActiveSettingsTab(tab.value as typeof activeSettingsTab)}
                          className={cn(
                            "flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors",
                            isActive
                              ? "border-primary text-primary"
                              : "border-transparent text-muted-foreground hover:text-text"
                          )}
                        >
                          <Icon className="w-4 h-4" />
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Mobile: Tab content */}
              <div className="md:hidden flex-1 overflow-y-auto p-5">
                {activeSettingsTab === "general" && renderGeneralTabContent()}
                {activeSettingsTab === "accounts" && renderAccountsTabContent()}
                {activeSettingsTab === "validation" && renderValidationTabContent()}
                {activeSettingsTab === "leadscore" && renderLeadscoreTabContent()}
              </div>

              {/* Desktop: Sidebar with Title and Tabs */}
              <div className="hidden md:flex w-fit min-w-0 border-r border-border bg-secondary flex-col shrink-0">
                <div className="p-4 border-b border-border">
                  <h2 className="text-lg font-semibold text-text whitespace-nowrap">Configurações</h2>
                </div>
                <div className="flex-1 overflow-y-auto min-w-0">
                  <TabbedContent
                    value={activeSettingsTab}
                    onValueChange={(value) => setActiveSettingsTab(value as typeof activeSettingsTab)}
                    variant="with-icons"
                    orientation="vertical"
                    tabs={[
                      { value: "general", label: "Preferências", icon: IconSettings },
                      { value: "accounts", label: "Contas", icon: IconUsers },
                      { value: "validation", label: "Critério de validação", icon: IconCheck },
                      { value: "leadscore", label: "Leadscore", icon: IconTarget },
                    ]}
                    tabsContainerClassName="h-full w-fit"
                    tabsListClassName="flex-col w-auto border-r-0 border-t-0 border-border bg-secondary rounded-none gap-1 space-y-1 p-2 flex-shrink-0"
                  >
                    <TabbedContentItem value="general" variant="with-icons" orientation="vertical" className="hidden">
                      {null}
                    </TabbedContentItem>
                    <TabbedContentItem value="accounts" variant="with-icons" orientation="vertical" className="hidden">
                      {null}
                    </TabbedContentItem>
                    <TabbedContentItem value="validation" variant="with-icons" orientation="vertical" className="hidden">
                      {null}
                    </TabbedContentItem>
                    <TabbedContentItem value="leadscore" variant="with-icons" orientation="vertical" className="hidden">
                      {null}
                    </TabbedContentItem>
                  </TabbedContent>
                </div>
              </div>

              {/* Desktop: Content Area */}
              <div className="hidden md:flex flex-1 overflow-y-auto">
                <TabbedContent
                  value={activeSettingsTab}
                  onValueChange={(value) => setActiveSettingsTab(value as typeof activeSettingsTab)}
                  variant="with-icons"
                  orientation="vertical"
                  tabs={[
                    { value: "general", label: "Preferências", icon: IconSettings },
                    { value: "accounts", label: "Contas", icon: IconUsers },
                    { value: "validation", label: "Critério de validação", icon: IconCheck },
                    { value: "leadscore", label: "Leadscore", icon: IconTarget },
                  ]}
                  tabsContainerClassName="flex flex-col h-full flex-1"
                  tabsListClassName="hidden"
                >
                  <TabbedContentItem value="general" variant="with-icons" orientation="vertical">{renderGeneralTabContent()}</TabbedContentItem>
                  <TabbedContentItem value="accounts" variant="with-icons" orientation="vertical">{renderAccountsTabContent()}</TabbedContentItem>
                  <TabbedContentItem value="validation" variant="with-icons" orientation="vertical">{renderValidationTabContent()}</TabbedContentItem>
                  <TabbedContentItem value="leadscore" variant="with-icons" orientation="vertical">{renderLeadscoreTabContent()}</TabbedContentItem>
                </TabbedContent>
              </div>
            </div>
          </AppDialog>
        )}

        <AutoRefreshConfirmModal isOpen={showModal} packCount={packCount} autoRefreshPacks={autoRefreshPacks} onConfirm={handleConfirm} onCancel={handleCancel} />

        {/* Modal de confirmação de atualização */}
        {isConfirmingUpdate && selectedPackId && (
          <ConfirmDialog
            isOpen={isConfirmingUpdate}
            onClose={handleCancelConfirmation}
            title="Confirmar atualização"
            message={
              <>
                Deseja atualizar o pack <strong>"{packs.find((p) => p.id === selectedPackId)?.name || "desconhecido"}"</strong>?
                <br />
                <span className="text-xs">A atualização buscará novos dados desde a última atualização até hoje.</span>
              </>
            }
            confirmText="Confirmar atualização"
            onConfirm={handleConfirmUpdate}
            isLoading={refreshingPackIds.length > 0}
            confirmIcon={<IconRefresh className="h-4 w-4" />}
          />
        )}

        {/* Modal de confirmação: Excluir dados */}
        <ConfirmDialog
          isOpen={showDeleteDataConfirm}
          onClose={() => setShowDeleteDataConfirm(false)}
          title="Excluir meus dados"
          message={
            <>
              Tem certeza que deseja excluir <strong>todos os seus dados</strong>? Isso inclui packs, métricas, anúncios, conexões e configurações.
              <br />
              <br />
              <span className="text-xs">Sua conta Hookify será mantida e você poderá usá-la novamente no futuro.</span>
            </>
          }
          confirmText="Sim, excluir meus dados"
          variant="destructive"
          onConfirm={handleDeleteUserData}
          isLoading={isDeletingData}
          loadingText="Excluindo dados..."
          confirmIcon={<IconTrash className="h-4 w-4" />}
        />

        {/* Modal de confirmação: Excluir conta */}
        <ConfirmDialog
          isOpen={showDeleteAccountConfirm}
          onClose={() => {
            setShowDeleteAccountConfirm(false);
            setDeleteAccountInput("");
          }}
          title="Excluir minha conta"
          message={
            <>
              Esta ação é <strong>irreversível</strong>. Sua conta e todos os dados associados serão permanentemente removidos.
              <br />
              <br />
              <span className="text-xs">
                Para confirmar, digite <strong>EXCLUIR</strong> abaixo:
              </span>
            </>
          }
          confirmText="Excluir minha conta permanentemente"
          variant="destructive"
          onConfirm={handleDeleteAccount}
          isLoading={isDeletingAccount}
          loadingText="Excluindo conta..."
          confirmIcon={<IconTrash className="h-4 w-4" />}
        >
          <Input value={deleteAccountInput} onChange={(e) => setDeleteAccountInput(e.target.value)} placeholder='Digite "EXCLUIR" para confirmar' className="mt-2" />
          {deleteAccountInput !== "EXCLUIR" && deleteAccountInput.length > 0 && <p className="text-xs text-destructive mt-1">Digite exatamente &quot;EXCLUIR&quot; para confirmar</p>}
        </ConfirmDialog>
      </header>
    </>
  );
}
