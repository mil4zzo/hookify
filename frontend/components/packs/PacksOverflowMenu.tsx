"use client";

import { useState } from "react";
import { IconDotsVertical, IconLoader2, IconRefresh, IconTrash } from "@tabler/icons-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { useSettings } from "@/lib/store/settings";
import { useInvalidatePackAds } from "@/lib/api/hooks";
import { api } from "@/lib/api/endpoints";
import { clearAllPacks } from "@/lib/storage/indexedDB";
import { showError, showSuccess } from "@/lib/utils/toast";
import { useQueryClient } from "@tanstack/react-query";

const PACK_PREFERENCE_KEYS = [
  "hookify-selected-packs",
  "hookify-insights-selected-packs",
  "hookify-manager-selected-packs",
  "hookify-insights-date-range",
  "hookify-manager-date-range",
  "hookify-packs-date-range",
  "hookify-insights-gems-columns",
  "hookify-insights-action-type",
  "hookify-insights-group-by-packs",
  "hookify-insights-use-pack-dates",
  "hookify-insights-pack-action-types",
  "hookify-insights-active-tab",
  "hookify-manager-action-type",
  "hookify-manager-show-trends",
  "hookify-manager-use-pack-dates",
];

/**
 * Menu secundário da página Packs: limpar todos os packs e resetar preferências locais/onboarding.
 */
export function PacksOverflowMenu() {
  const { packs, removePack } = useClientPacks();
  const { updateSettings } = useSettings();
  const { invalidateAllPacksAds, invalidateAdPerformance } = useInvalidatePackAds();
  const queryClient = useQueryClient();
  const [isClearingPacks, setIsClearingPacks] = useState(false);
  const [isResettingPreferences, setIsResettingPreferences] = useState(false);

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
      const deletePromises = packs.map((pack) =>
        api.analytics.deletePack(pack.id, []).catch((error) => {
          console.error(`Erro ao deletar pack ${pack.id}:`, error);
          return null;
        }),
      );
      await Promise.all(deletePromises);

      packs.forEach((pack) => {
        removePack(pack.id);
      });

      const clearResult = await clearAllPacks();
      if (!clearResult.success) {
        console.warn("Erro ao limpar IndexedDB:", clearResult.error);
      }

      await invalidateAllPacksAds();
      invalidateAdPerformance();

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

  const handleResetPreferences = async () => {
    if (!confirm("Tem certeza que deseja resetar todas as preferências? Esta ação não pode ser desfeita.")) {
      return;
    }

    setIsResettingPreferences(true);
    try {
      const defaultSettings = {
        language: "pt-BR",
        niche: "",
        currency: "BRL",
      };
      updateSettings(defaultSettings);

      PACK_PREFERENCE_KEYS.forEach((key) => {
        localStorage.removeItem(key);
      });

      try {
        await api.onboarding.reset();
        queryClient.invalidateQueries({ queryKey: ["onboarding", "status"] });
      } catch (error) {
        console.warn("Erro ao resetar onboarding:", error);
      }

      showSuccess("Preferências resetadas com sucesso!");
    } catch (error) {
      console.error("Erro ao resetar preferências:", error);
      showError({ message: `Erro ao resetar preferências: ${error}` });
    } finally {
      setIsResettingPreferences(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-accent transition-all focus:outline-none focus:ring-2 focus:ring-info"
          aria-label="Mais opções de packs"
        >
          <IconDotsVertical className="h-5 w-5 text-text" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={handleClearAllPacks} disabled={isClearingPacks || packs.length === 0} className="flex items-center gap-2 text-destructive focus:text-destructive">
          {isClearingPacks ? <IconLoader2 className="h-4 w-4 animate-spin" /> : <IconTrash className="h-4 w-4" />}
          <span>Limpar todos os packs</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleResetPreferences} disabled={isResettingPreferences} className="flex items-center gap-2 text-destructive focus:text-destructive">
          {isResettingPreferences ? <IconLoader2 className="h-4 w-4 animate-spin" /> : <IconRefresh className="h-4 w-4" />}
          <span>Resetar preferências</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
