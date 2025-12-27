"use client";

import { useState, useEffect, useRef } from "react";
import { useClientAuth, useClientPacks } from "./useClientSession";
import { api } from "@/lib/api/endpoints";
import { showProgressToast, updateProgressToast, finishProgressToast, showError } from "@/lib/utils/toast";
import { getTodayLocal } from "@/lib/utils/dateFilters";
import { useInvalidatePackAds } from "@/lib/api/hooks";
import { AdsPack } from "@/lib/types";
import { useUpdatingPacksStore } from "@/lib/store/updatingPacks";

const STORAGE_KEY = "hookify_auto_refresh_checked";

/**
 * Calcula diferença em dias entre duas datas (YYYY-MM-DD)
 */
function calculateDaysBetween(startDate: string, endDate: string): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays + 1; // +1 para incluir o dia final
}

/**
 * Estima dia atual baseado no progresso (0-100) e total de dias
 */
function estimateCurrentDay(progress: number, totalDays: number): number {
  if (progress <= 0) return 1;
  if (progress >= 100) return totalDays;
  // Interpolar: progress 50% = aproximadamente metade dos dias
  const estimatedDay = Math.ceil((progress / 100) * totalDays);
  return Math.max(1, Math.min(estimatedDay, totalDays));
}

export function useAutoRefreshPacks() {
  const { isAuthenticated, isClient } = useClientAuth();
  const { updatePack } = useClientPacks();
  const { invalidatePackAds, invalidateAdPerformance } = useInvalidatePackAds();
  const { addUpdatingPack, removeUpdatingPack } = useUpdatingPacksStore();
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

    const checkAutoRefreshPacks = async () => {
      try {
        // Buscar todos os packs (sem ads para ser mais rápido)
        const response = await api.analytics.listPacks(false);
        
        if (response.success && response.packs) {
          const autoRefreshPacks = response.packs.filter(
            (pack: any) => pack.auto_refresh === true
          );
          
          if (autoRefreshPacks.length > 0) {
            setPackCount(autoRefreshPacks.length);
            setAutoRefreshPacks(autoRefreshPacks);
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

      // Atualizar cada pack sequencialmente
      for (const pack of packsToUpdate) {
        await refreshPackWithProgress(pack);
      }
    } catch (error) {
      console.error("Erro ao atualizar packs:", error);
      showError(error as any);
    }
  };

  /**
   * Atualiza um pack com feedback visual de progresso
   */
  const refreshPackWithProgress = async (pack: any) => {
    const toastId = `refresh-pack-${pack.id}`;
    
    // Adicionar pack ao store de atualização para feedback visual no card
    addUpdatingPack(pack.id);
    
    // Mostrar toast imediatamente para feedback visual instantâneo
    showProgressToast(toastId, pack.name, 0, 1, "Inicializando...");
    
    try {
      // Iniciar refresh (auto-refresh sempre usa "since_last_refresh")
      const refreshResult = await api.facebook.refreshPack(pack.id, getTodayLocal(), "since_last_refresh");
      
      if (!refreshResult.job_id) {
        finishProgressToast(toastId, false, `Erro ao iniciar atualização de "${pack.name}"`);
        removeUpdatingPack(pack.id);
        return;
      }

      // Calcular total de dias
      const dateRange = refreshResult.date_range;
      const totalDays = calculateDaysBetween(dateRange.since, dateRange.until);
      
      // Atualizar toast com informações reais
      updateProgressToast(toastId, pack.name, 1, totalDays);

      // Fazer polling do job (arquitetura "2 fases" - requests rápidos)
      let completed = false;
      let attempts = 0;
      const maxAttempts = 300; // 10 minutos máximo (300 * 2s = 600s)

      while (!completed && attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000)); // Aguardar 2 segundos

        try {
          const progress = await api.facebook.getJobProgress(refreshResult.job_id);
          const details = (progress as any)?.details || {};
          
          // Estimar progresso baseado no estágio
          let stageProgress = progress.progress || 0;
          if (details.stage) {
            if (details.stage === "paginação") stageProgress = 30;
            else if (details.stage === "enriquecimento") stageProgress = 60;
            else if (details.stage === "formatação") stageProgress = 85;
            else if (details.stage === "persistência") stageProgress = 95;
            else if (details.stage === "completo") stageProgress = 100;
          }
          
          // Estimar dia atual baseado no progresso
          const currentDay = estimateCurrentDay(stageProgress, totalDays);
          
          // Atualizar toast com progresso
          updateProgressToast(
            toastId,
            pack.name,
            currentDay,
            totalDays,
            progress.message || undefined
          );

          if (progress.status === "completed") {
            const adsCount = (progress as any).result_count || 0;
            finishProgressToast(
              toastId,
              true,
              `"${pack.name}" atualizado com sucesso! ${adsCount > 0 ? `${adsCount} anúncios atualizados.` : ""}`
            );
            
            // ✅ ATUALIZAR STORE E INVALIDAR CACHE
            try {
              // Buscar pack atualizado do backend
              const response = await api.analytics.listPacks(false);
              if (response.success && response.packs) {
                const updatedPack = response.packs.find((p: any) => p.id === pack.id);
                if (updatedPack) {
                  // Atualizar pack no store Zustand (faz Topbar e Ads-loader reagirem)
                  updatePack(pack.id, {
                    stats: updatedPack.stats || {},
                    updated_at: updatedPack.updated_at || new Date().toISOString(),
                    auto_refresh: updatedPack.auto_refresh !== undefined ? updatedPack.auto_refresh : undefined,
                    date_stop: updatedPack.date_stop, // Atualizar date_stop para mostrar "HOJE" corretamente
                  } as Partial<AdsPack>);
                  
                  // Invalidar cache de ads (faz usePacksAds refazer a query)
                  await invalidatePackAds(pack.id);
                }
              }
              
              // Invalidar dados agregados (ad performance) para atualizar Rankings/Insights
              invalidateAdPerformance();
            } catch (error) {
              console.error("Erro ao recarregar pack após refresh:", error);
              // Não bloquear sucesso do refresh se falhar ao recarregar
            }
            
            completed = true;
            removeUpdatingPack(pack.id);
          } else if (progress.status === "failed" || progress.status === "error") {
            finishProgressToast(
              toastId,
              false,
              `Erro ao atualizar "${pack.name}": ${progress.message || "Erro desconhecido"}`
            );
            completed = true;
            removeUpdatingPack(pack.id);
          }
          // Status "running", "processing", "persisting" continuam o polling
        } catch (error) {
          console.error(`Erro ao verificar progresso do pack ${pack.id}:`, error);
          // Continuar tentando, mas atualizar toast com mensagem de erro
          // Usar último dia conhecido ou totalDays como fallback
          const lastKnownDay = attempts > 0 ? Math.min(attempts, totalDays) : 1;
          updateProgressToast(
            toastId,
            pack.name,
            lastKnownDay,
            totalDays,
            "Erro ao verificar progresso, tentando novamente..."
          );
        }

        attempts++;
      }

      if (!completed) {
        finishProgressToast(toastId, false, `Timeout ao atualizar "${pack.name}" (demorou mais de 10 minutos)`);
        removeUpdatingPack(pack.id);
      }
    } catch (error) {
      console.error(`Erro ao atualizar pack ${pack.id}:`, error);
      finishProgressToast(toastId, false, `Erro ao atualizar "${pack.name}": ${error instanceof Error ? error.message : "Erro desconhecido"}`);
      removeUpdatingPack(pack.id);
    }
  };

  const handleCancel = () => {
    sessionStorage.setItem(STORAGE_KEY, "true");
    setShowModal(false);
  };

  return { showModal, packCount, autoRefreshPacks, handleConfirm, handleCancel };
}
