"use client";

/**
 * Hook para verificar e executar auto-refresh de packs no startup.
 *
 * Utiliza o hook centralizado usePackRefresh para a lógica de atualização.
 */

import { useState, useEffect, useRef } from "react";
import { useClientAuth } from "./useClientSession";
import { api } from "@/lib/api/endpoints";
import { showError } from "@/lib/utils/toast";
import { usePackRefresh } from "./usePackRefresh";

const STORAGE_KEY = "hookify_auto_refresh_checked";

export function useAutoRefreshPacks() {
  const { isAuthenticated, isClient } = useClientAuth();
  const { refreshPack } = usePackRefresh();
  const [showModal, setShowModal] = useState(false);
  const [packCount, setPackCount] = useState(0);
  const [autoRefreshPacks, setAutoRefreshPacks] = useState<any[]>([]);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!isClient || !isAuthenticated || checkedRef.current) return;

    // Verificar se já checamos nesta sessão
    const alreadyChecked = sessionStorage.getItem(STORAGE_KEY);
    if (alreadyChecked === "true") {
      checkedRef.current = true;
      return;
    }

    // Função auxiliar para verificar se o pack pode ser atualizado (último refresh há mais de 1 hora)
    const canRefreshPack = (pack: any): boolean => {
      if (!pack.last_refreshed_at) {
        // Se não tem last_refreshed_at, permite atualizar
        return true;
      }

      try {
        // last_refreshed_at está no formato YYYY-MM-DD (data lógica)
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

        // Se foi atualizado em um dia diferente de hoje, permite atualizar
        if (pack.last_refreshed_at !== today) {
          return true;
        }

        // Se foi atualizado hoje, verificar se updated_at foi há mais de 1 hora
        if (pack.updated_at) {
          const updatedAt = new Date(pack.updated_at);
          const now = new Date();
          const diffInMs = now.getTime() - updatedAt.getTime();
          const diffInHours = diffInMs / (1000 * 60 * 60);

          // Permite atualizar se passou mais de 1 hora desde updated_at
          return diffInHours > 1;
        }

        // Se não tem updated_at, permite atualizar (fallback)
        return true;
      } catch (error) {
        // Em caso de erro ao parsear a data, permite atualizar
        console.warn("Erro ao verificar last_refreshed_at:", error);
        return true;
      }
    };

    const checkAutoRefreshPacks = async () => {
      try {
        // Buscar todos os packs (sem ads para ser mais rápido)
        const response = await api.analytics.listPacks(false);

        if (response.success && response.packs) {
          // Filtrar packs com auto_refresh = true E que podem ser atualizados (último refresh há mais de 1 hora)
          const eligiblePacks = response.packs.filter(
            (pack: any) => pack.auto_refresh === true && canRefreshPack(pack)
          );

          if (eligiblePacks.length > 0) {
            setPackCount(eligiblePacks.length);
            setAutoRefreshPacks(eligiblePacks);
            setShowModal(true);
          }
        }
      } catch (error) {
        console.error("Erro ao verificar packs com auto_refresh:", error);
      } finally {
        checkedRef.current = true;
      }
    };

    // Aguardar um pouco após login para não sobrecarregar
    const timeout = setTimeout(checkAutoRefreshPacks, 1000);
    return () => clearTimeout(timeout);
  }, [isClient, isAuthenticated]);

  const handleConfirm = async (selectedPackIds: string[]) => {
    sessionStorage.setItem(STORAGE_KEY, "true");
    setShowModal(false);

    if (selectedPackIds.length === 0) {
      return;
    }

    try {
      // Filtrar apenas os packs selecionados
      const packsToUpdate = autoRefreshPacks.filter((pack: any) =>
        selectedPackIds.includes(pack.id)
      );

      if (packsToUpdate.length === 0) {
        return;
      }

      // Atualizar cada pack sequencialmente usando o hook centralizado
      for (const pack of packsToUpdate) {
        console.log(`[AUTO_REFRESH] Iniciando refresh do pack ${pack.id} (${pack.name})`);
        await refreshPack({
          packId: pack.id,
          packName: pack.name,
          refreshType: "since_last_refresh",
          sheetIntegrationId: pack.sheet_integration?.id,
        });
      }
    } catch (error) {
      console.error("Erro ao atualizar packs:", error);
      showError(error as any);
    }
  };

  const handleCancel = () => {
    sessionStorage.setItem(STORAGE_KEY, "true");
    setShowModal(false);
  };

  return { showModal, packCount, autoRefreshPacks, handleConfirm, handleCancel };
}
