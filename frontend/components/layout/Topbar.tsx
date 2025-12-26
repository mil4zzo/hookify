"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useClientAuth, useClientPacks } from "@/lib/hooks/useClientSession";
import { useAuthManager } from "@/lib/hooks/useAuthManager";
import { useFacebookAccountConnection } from "@/lib/hooks/useFacebookAccountConnection";
import { useFacebookConnectionVerification } from "@/lib/hooks/useFacebookConnectionVerification";
import { FacebookConnectionCard } from "@/components/facebook/FacebookConnectionCard";
import { showError } from "@/lib/utils/toast";
import { getAggregatedPackStatistics } from "@/lib/utils/adCounting";
import { IconChartBar, IconMenu2, IconX, IconLogout, IconUser, IconUsers, IconBell, IconPlus, IconSettings, IconBrandFacebook, IconLoader2, IconBrandFacebookFilled, IconMoon, IconSun, IconCheck, IconAlertCircle, IconTableExport, IconTarget, IconDotsVertical, IconTrash, IconRefresh } from "@tabler/icons-react";
import { Modal } from "@/components/common/Modal";
import { useSettings } from "@/lib/store/settings";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { pageTitles } from "@/lib/config/pageConfig";
import { DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuItem } from "@/components/ui/dropdown-menu";
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
import { GoogleSheetIntegrationDialog } from "@/components/ads/GoogleSheetIntegrationDialog";
import { showSuccess } from "@/lib/utils/toast";
import { api } from "@/lib/api/endpoints";
import { clearAllPacks } from "@/lib/storage/indexedDB";
import { useInvalidatePackAds } from "@/lib/api/hooks";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useSupabaseAuth } from "@/lib/hooks/useSupabaseAuth";
import { useQueryClient } from "@tanstack/react-query";

export default function Topbar() {
  // TODOS OS HOOKS DEVEM SER CHAMADOS ANTES DE QUALQUER EARLY RETURN
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<"general" | "accounts" | "validation" | "integrations" | "leadscore">("general");
  const [isSheetsDialogOpen, setIsSheetsDialogOpen] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const { criteria: validationCriteria, updateCriteria: setValidationCriteria, isLoading: isLoadingCriteria, isSaving: isSavingCriteria, saveCriteria } = useValidationCriteria();
  const { mqlLeadscoreMin, isLoading: isLoadingMql, isSaving: isSavingMql, updateMqlLeadscoreMin, saveMqlLeadscoreMin } = useMqlLeadscore();
  const { currency: userCurrency, isLoading: isLoadingCurrency, isSaving: isSavingCurrency, saveCurrency } = useCurrency();
  const { language: userLanguage, isLoading: isLoadingLanguage, isSaving: isSavingLanguage, saveLanguage } = useLanguage();
  const { niche: userNiche, isLoading: isLoadingNiche, isSaving: isSavingNiche, updateNiche, saveNiche } = useNiche();
  const { isAuthenticated, user, isClient } = useClientAuth();
  const { packs, removePack } = useClientPacks();
  const { handleLogout } = useAuthManager();
  const { settings, setLanguage, setNiche, updateSettings } = useSettings();
  const { connections, connect, disconnect, activeConnections, expiredConnections, hasActiveConnection, hasExpiredConnections } = useFacebookAccountConnection();
  const { verifyConnections, clearConnectionCache } = useFacebookConnectionVerification();
  const { invalidateAllPacksAds, invalidateAdPerformance } = useInvalidatePackAds();
  const { user: supabaseUser } = useSupabaseAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const [isClearingPacks, setIsClearingPacks] = useState(false);
  const [isResettingPreferences, setIsResettingPreferences] = useState(false);

  // Verificar conexões quando carregarem na aba de contas
  useEffect(() => {
    if (isSettingsOpen && activeSettingsTab === "accounts" && connections.data && connections.data.length > 0) {
      const connectionIds = connections.data.map((c: any) => c.id);
      verifyConnections(connectionIds);
    }
  }, [isSettingsOpen, activeSettingsTab, connections.data, verifyConnections]);
  const { showModal, packCount, handleConfirm, handleCancel } = useAutoRefreshPacks();

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
  // Só mostra botão de conectar quando carregamento terminou E não há conexões ativas
  const shouldShowConnectButton = !connections.isLoading && !hasActiveConnection;

  const handleConnectFacebook = async () => {
    try {
      await connect.mutateAsync();
    } catch (error) {
      showError(error as any);
    }
  };

  // Função para limpar todos os packs
  const handleClearAllPacks = async () => {
    if (packs.length === 0) {
      showSuccess("Não há packs para limpar");
      return;
    }

    if (!confirm(`Tem certeza que deseja limpar todos os ${packs.length} pack(s)? Esta ação não pode ser desfeita.`)) {
      return;
    }

    setIsClearingPacks(true);
    try {
      // Deletar todos os packs do backend
      const deletePromises = packs.map((pack) => 
        api.analytics.deletePack(pack.id, []).catch((error) => {
          console.error(`Erro ao deletar pack ${pack.id}:`, error);
          // Continuar mesmo se algum falhar
          return null;
        })
      );
      await Promise.all(deletePromises);

      // Remover do estado local
      packs.forEach((pack) => {
        removePack(pack.id);
      });

      // Limpar IndexedDB
      const clearResult = await clearAllPacks();
      if (!clearResult.success) {
        console.warn("Erro ao limpar IndexedDB:", clearResult.error);
      }

      // Limpar cache de ads
      await invalidateAllPacksAds();

      // Invalidar dados agregados
      invalidateAdPerformance();

      // Limpar cache de ads do IndexedDB também
      const { clearAllAdsCache } = await import("@/lib/storage/adsCache");
      await clearAllAdsCache();

      showSuccess("Todos os packs foram limpos com sucesso!");
    } catch (error) {
      console.error("Erro ao limpar packs:", error);
      showError({ message: `Erro ao limpar packs: ${error}` });
    } finally {
      setIsClearingPacks(false);
    }
  };

  // Função para resetar preferências
  const handleResetPreferences = async () => {
    if (!confirm("Tem certeza que deseja resetar todas as preferências? Esta ação não pode ser desfeita.")) {
      return;
    }

    setIsResettingPreferences(true);
    try {
      // Resetar settings store
      const defaultSettings = {
        language: 'pt-BR',
        niche: '',
        currency: 'BRL',
      };
      updateSettings(defaultSettings);

      // Limpar preferências de packs do localStorage
      const packPreferenceKeys = [
        'hookify-selected-packs',
        'hookify-insights-selected-packs',
        'hookify-rankings-selected-packs',
        'hookify-insights-date-range',
        'hookify-rankings-date-range',
        'hookify-packs-date-range',
        'hookify-insights-gems-columns',
        'hookify-insights-action-type',
        'hookify-insights-group-by-packs',
        'hookify-insights-use-pack-dates',
        'hookify-insights-pack-action-types',
        'hookify-insights-active-tab',
        'hookify-rankings-action-type',
        'hookify-rankings-show-trends',
        'hookify-rankings-use-pack-dates',
      ];

      packPreferenceKeys.forEach((key) => {
        localStorage.removeItem(key);
      });

      // Resetar estado do onboarding no Supabase
      if (supabaseUser?.id) {
        try {
          const supabase = getSupabaseClient();
          const { error: upsertError } = await supabase
            .from("user_preferences")
            .upsert(
              {
                user_id: supabaseUser.id,
                has_completed_onboarding: false,
                updated_at: new Date().toISOString(),
              } as any,
              {
                onConflict: "user_id",
              }
            );

          if (upsertError) {
            console.warn("Erro ao resetar onboarding no Supabase:", upsertError);
            // Não falhar a operação inteira se apenas o onboarding falhar
          } else {
            // Invalidar cache do React Query para forçar refetch do status de onboarding
            queryClient.invalidateQueries({ queryKey: ["onboarding", "status"] });
          }
        } catch (error) {
          console.warn("Erro ao resetar onboarding:", error);
          // Não falhar a operação inteira se apenas o onboarding falhar
        }
      }

      showSuccess("Preferências resetadas com sucesso!");
    } catch (error) {
      console.error("Erro ao resetar preferências:", error);
      showError({ message: `Erro ao resetar preferências: ${error}` });
    } finally {
      setIsResettingPreferences(false);
    }
  };

  // Função para renderizar o menu de reset
  const renderResetMenu = () => {
    if (!isAuthenticated) return null;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button 
            className="relative flex items-center justify-center w-10 h-10 rounded-full hover:bg-accent transition-all focus:outline-none focus:ring-2 focus:ring-info" 
            aria-label="Menu de reset"
          >
            <IconDotsVertical className="h-5 w-5 text-text" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            onClick={handleClearAllPacks}
            disabled={isClearingPacks || packs.length === 0}
            className="flex items-center gap-2 text-destructive focus:text-destructive"
          >
            {isClearingPacks ? (
              <IconLoader2 className="h-4 w-4 animate-spin" />
            ) : (
              <IconTrash className="h-4 w-4" />
            )}
            <span>Limpar todos os packs</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleResetPreferences}
            disabled={isResettingPreferences}
            className="flex items-center gap-2 text-destructive focus:text-destructive"
          >
            {isResettingPreferences ? (
              <IconLoader2 className="h-4 w-4 animate-spin" />
            ) : (
              <IconRefresh className="h-4 w-4" />
            )}
            <span>Resetar preferências</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // Função para renderizar o menu dropdown do perfil com Radix
  const renderProfileMenu = () => {
    if (!isAuthenticated || !user) return null;

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="relative flex items-center justify-center w-10 h-10 rounded-full overflow-hidden hover:ring-2 hover:ring-border transition-all focus:outline-none focus:ring-2 focus:ring-info" aria-label="Perfil do usuário">
            {user.user_metadata?.avatar_url ? (
              <img src={user.user_metadata.avatar_url} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-brand flex items-center justify-center">
                <IconUser className="h-5 w-5 text-white" />
              </div>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {/* User Info */}
          <div className="p-4">
            <div className="flex items-center gap-3">
              {user.user_metadata?.avatar_url ? (
                <img src={user.user_metadata.avatar_url} alt="Profile" className="w-12 h-12 rounded-full" />
              ) : (
                <div className="w-12 h-12 bg-brand rounded-full flex items-center justify-center">
                  <IconUser className="h-6 w-6 text-white" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-text truncate">{formatToTitleCase(user.user_metadata?.name || user.user_metadata?.full_name) || user.email?.split("@")[0] || "Usuário"}</p>
                <p className="text-sm text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>
          </div>

          <DropdownMenuSeparator />

          {/* Notifications Button */}
          <div className="p-2">
            <Button variant="outline" className="w-full flex items-center gap-2 justify-start" onClick={() => {}}>
              <IconBell className="h-4 w-4" />
              Notificações
            </Button>
          </div>

          {/* Theme Toggle Button */}
          <div className="p-2">
            <Button
              variant="outline"
              className="w-full flex items-center gap-2 justify-start"
              onClick={() => {
                toggleTheme();
              }}
            >
              {theme === "dark" ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
              {theme === "dark" ? "Modo Claro" : "Modo Escuro"}
            </Button>
          </div>

          {/* Settings Button */}
          <div className="p-2">
            <Button
              variant="outline"
              className="w-full flex items-center gap-2 justify-start"
              onClick={() => {
                setIsSettingsOpen(true);
              }}
            >
              <IconSettings className="h-4 w-4" />
              Configurações
            </Button>
          </div>

          {/* Logout Button */}
          <div className="p-2">
            <Button variant="outline" className="w-full flex items-center gap-2 justify-start" onClick={handleLogoutClick}>
              <IconLogout className="h-4 w-4" />
              Sair
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  // Função para renderizar o botão de Carregar Packs
  const renderLoadPackButton = () => {
    if (!isAuthenticated || !hasFacebookConnection) return null;

    const buttonProps = {
      variant: "outline" as const,
      size: "sm" as const,
      className: "flex items-center gap-2",
    };

    if (pathname === "/packs") {
      return (
        <Button
          {...buttonProps}
          onClick={() => {
            window.dispatchEvent(new CustomEvent("openLoadPackDialog"));
          }}
        >
          <IconPlus className="h-4 w-4" />
          Carregar Packs
        </Button>
      );
    }

    return (
      <Button {...buttonProps} onClick={() => router.push("/packs?openDialog=true")}>
        <IconPlus className="h-4 w-4" />
        Carregar Packs
      </Button>
    );
  };

  if (!isClient) {
    return (
      <>
        <ServerStatusBanner />
        <header className="z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="container mx-auto flex h-16 items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-text">Hookify</h1>
            </div>
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
                    <Button variant="outline" size="sm" onClick={() => router.push("/packs?openDialog=true")} className="flex items-center gap-2">
                      <IconPlus className="h-4 w-4" />
                      Carregar Packs
                    </Button>
                  ) : null}

                  {/* Reset Menu - only show when authenticated */}
                  {renderResetMenu()}

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
      <header className="z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        {/* Desktop Layout */}
        <div className="hidden md:flex container mx-auto h-16 items-center justify-between px-8">
          {/* Page Title - Left Side */}
          <div className="flex items-center gap-3">
            {Icon && <Icon className="h-6 w-6 text-brand" />}
            <h1 className="text-2xl font-bold text-text">{title}</h1>
          </div>

          {/* User Section - Right Side */}
          <div className="flex items-center gap-3">
            {/* Conectar Facebook ou Carregar Packs Button - only show when authenticated */}
            {isAuthenticated && (
              <>
                {/* Stats Info - only show when authenticated and has packs */}
                {isClient && packs.length > 0 && (
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
                  renderLoadPackButton()
                ) : null}
              </>
            )}

            {/* Reset Menu - only show when authenticated */}
            {isAuthenticated && renderResetMenu()}

            {/* Profile Avatar with Dropdown */}
            {isAuthenticated && user ? (
              renderProfileMenu()
            ) : (
              <Button asChild>
                <Link href="/login">Entrar</Link>
              </Button>
            )}
          </div>
        </div>

        {/* Mobile Layout */}
        <div className="md:hidden container mx-auto flex h-16 items-center justify-between px-4 gap-3">
          {/* Logo - Left */}
          <Link href="/" className="flex items-center hover:opacity-80 transition-opacity flex-shrink-0">
            <Image src="/logo-hookify-alpha.png" alt="Hookify" width={80} height={21} className="h-[21px] w-[80px]" priority />
          </Link>

          {/* Right Side: Carregar Pack Button + Reset Menu + Profile Avatar */}
          <div className="flex items-center gap-3">
            {isAuthenticated && (
              <>
                {connections.isLoading ? (
                  <Skeleton className="h-9 w-[140px] rounded-md" />
                ) : shouldShowConnectButton ? (
                  <Button variant="default" size="sm" onClick={handleConnectFacebook} disabled={connect.isPending} className="flex items-center gap-2">
                    {connect.isPending ? <IconLoader2 className="h-4 w-4 animate-spin" /> : <IconBrandFacebook className="h-4 w-4" />}
                    {connect.isPending ? "Conectando..." : "Conectar Facebook"}
                  </Button>
                ) : hasFacebookConnection ? (
                  renderLoadPackButton()
                ) : null}
              </>
            )}

            {/* Reset Menu - only show when authenticated */}
            {isAuthenticated && renderResetMenu()}

            {/* Profile Avatar - Right */}
            {isAuthenticated && user ? (
              renderProfileMenu()
            ) : (
              <Button asChild size="sm">
                <Link href="/login">Entrar</Link>
              </Button>
            )}
          </div>
        </div>

        {/* Settings Modal - Shared between mobile and desktop */}
        {isAuthenticated && (
          <Modal
            isOpen={isSettingsOpen}
            onClose={() => {
              setIsSettingsOpen(false);
              setActiveSettingsTab("general");
              setIsSheetsDialogOpen(false);
            }}
            size="4xl"
            padding="none"
          >
            <div className="flex flex-col md:flex-row h-[calc(90vh-2rem)] md:h-[600px] min-h-[400px] max-h-[90vh]">
              {/* Mobile: Header with Title and Tabs */}
              <div className="md:hidden border-b border-border bg-secondary">
                <div className="p-4 border-b border-border">
                  <h2 className="text-lg font-semibold text-text">Configurações</h2>
                </div>
                <nav className="flex p-2 space-x-1 overflow-x-auto">
                  <button onClick={() => setActiveSettingsTab("general")} className={`flex-shrink-0 flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${activeSettingsTab === "general" ? "bg-background text-text" : "text-text/70 hover:bg-accent-hover hover:text-text"}`}>
                    <IconSettings className="h-5 w-5" />
                    <span className="text-sm font-medium">Preferências</span>
                  </button>
                  <button onClick={() => setActiveSettingsTab("accounts")} className={`flex-shrink-0 flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${activeSettingsTab === "accounts" ? "bg-background text-text" : "text-text/70 hover:bg-accent-hover hover:text-text"}`}>
                    <IconUsers className="h-5 w-5" />
                    <span className="text-sm font-medium">Contas</span>
                  </button>
                  <button onClick={() => setActiveSettingsTab("validation")} className={`flex-shrink-0 flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${activeSettingsTab === "validation" ? "bg-background text-text" : "text-text/70 hover:bg-accent-hover hover:text-text"}`}>
                    <IconCheck className="h-5 w-5" />
                    <span className="text-sm font-medium">Critério de validação</span>
                  </button>
                  <button onClick={() => setActiveSettingsTab("integrations")} className={`flex-shrink-0 flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${activeSettingsTab === "integrations" ? "bg-background text-text" : "text-text/70 hover:bg-accent-hover hover:text-text"}`}>
                    <IconTableExport className="h-5 w-5" />
                    <span className="text-sm font-medium">Integrações</span>
                  </button>
                  <button onClick={() => setActiveSettingsTab("leadscore")} className={`flex-shrink-0 flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${activeSettingsTab === "leadscore" ? "bg-background text-text" : "text-text/70 hover:bg-accent-hover hover:text-text"}`}>
                    <IconTarget className="h-5 w-5" />
                    <span className="text-sm font-medium">Leadscore</span>
                  </button>
                </nav>
              </div>

              {/* Desktop: Sidebar de Navegação */}
              <div className="hidden md:flex w-64 border-r border-border bg-secondary flex-col shrink-0">
                <div className="p-4 border-b border-border">
                  <h2 className="text-lg font-semibold text-text">Configurações</h2>
                </div>
                <nav className="flex-1 p-2 space-y-1">
                  <button onClick={() => setActiveSettingsTab("general")} className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${activeSettingsTab === "general" ? "bg-background text-text" : "text-text/70 hover:bg-accent-hover hover:text-text"}`}>
                    <IconSettings className="h-5 w-5" />
                    <span className="text-sm font-medium">Preferências</span>
                  </button>
                  <button onClick={() => setActiveSettingsTab("accounts")} className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${activeSettingsTab === "accounts" ? "bg-background text-text" : "text-text/70 hover:bg-accent-hover hover:text-text"}`}>
                    <IconUsers className="h-5 w-5" />
                    <span className="text-sm font-medium">Contas</span>
                  </button>
                  <button onClick={() => setActiveSettingsTab("validation")} className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${activeSettingsTab === "validation" ? "bg-background text-text" : "text-text/70 hover:bg-accent-hover hover:text-text"}`}>
                    <IconCheck className="h-5 w-5" />
                    <span className="text-sm font-medium">Critério de validação</span>
                  </button>
                  <button onClick={() => setActiveSettingsTab("integrations")} className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${activeSettingsTab === "integrations" ? "bg-background text-text" : "text-text/70 hover:bg-accent-hover hover:text-text"}`}>
                    <IconTableExport className="h-5 w-5" />
                    <span className="text-sm font-medium">Integrações</span>
                  </button>
                  <button onClick={() => setActiveSettingsTab("leadscore")} className={`w-full flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${activeSettingsTab === "leadscore" ? "bg-background text-text" : "text-text/70 hover:bg-accent-hover hover:text-text"}`}>
                    <IconTarget className="h-5 w-5" />
                    <span className="text-sm font-medium">Leadscore</span>
                  </button>
                </nav>
              </div>

              {/* Conteúdo da Aba Ativa */}
              <div className="flex-1 overflow-y-auto w-full max-w-3xl">
                <div className="p-4 md:p-6">
                  {activeSettingsTab === "general" && (
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
                              <SelectItem value="en-US" disabled>Inglês</SelectItem>
                              <SelectItem value="es-ES" disabled>Espanhol</SelectItem>
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
                              // Atualizar estado local imediatamente para feedback visual
                              updateNiche(e.target.value);
                            }}
                            onBlur={async (e) => {
                              // Salvar quando o usuário sair do campo
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
                            className={isLoadingNiche || isSavingNiche ? "bg-border/50" : ""}
                          />
                          <p className="text-xs text-muted-foreground">
                            {isSavingNiche ? "Salvando..." : "Digite o nicho do seu negócio (ex: E-commerce, SaaS, etc.)"}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {activeSettingsTab === "accounts" && (
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
                              onReconnect={handleConnectFacebook}
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
                    </div>
                  )}

                  {activeSettingsTab === "validation" && (
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
                  )}

                  {activeSettingsTab === "leadscore" && (
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
                                className="w-full"
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
                  )}

                  {activeSettingsTab === "integrations" && (
                    <div className="space-y-6">
                      <div>
                        <h3 className="text-lg font-semibold text-text mb-2">Integrações</h3>
                        <p className="text-sm text-muted-foreground mb-4">Conecte planilhas do Google Sheets para enriquecer seus dados de anúncios com informações complementares como Leadscore e CPR max.</p>
                      </div>

                      <div className="space-y-4">
                        <div className="border border-border rounded-lg p-6 bg-secondary-30">
                          <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-3">
                              <IconTableExport className="h-6 w-6 text-brand" />
                              <div>
                                <h4 className="font-semibold text-text">Google Sheets</h4>
                                <p className="text-sm text-muted-foreground">Importe dados complementares (Leadscore, CPR max) de planilhas do Google Sheets</p>
                              </div>
                            </div>
                            <Button variant="default" onClick={() => setIsSheetsDialogOpen(true)} className="flex items-center gap-2">
                              <IconTableExport className="h-4 w-4" />
                              Integrar planilha
                            </Button>
                          </div>
                          <div className="mt-4 pt-4 border-t border-border">
                            <p className="text-xs text-muted-foreground">
                              <strong>Como funciona:</strong> Conecte uma planilha do Google Sheets com colunas de Ad ID, Data, Leadscore e/ou CPR max. Os dados serão importados e aplicados diretamente nas métricas dos seus anúncios no Supabase.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Modal>
        )}

        <AutoRefreshConfirmModal isOpen={showModal} packCount={packCount} onConfirm={handleConfirm} onCancel={handleCancel} />

        {/* Modal de integração Google Sheets */}
        <GoogleSheetIntegrationDialog isOpen={isSheetsDialogOpen} onClose={() => setIsSheetsDialogOpen(false)} />
      </header>
    </>
  );
}
