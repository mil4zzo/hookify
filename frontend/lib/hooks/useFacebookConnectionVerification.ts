"use client";

import { useCallback, useState } from "react";
import { facebookConnectorApi } from "@/lib/api/facebookConnector";

// Constantes para cache de verificação
const VERIFICATION_CACHE_KEY = "facebook_connections_verification_cache";
const VERIFICATION_CACHE_TTL = 15 * 60 * 1000; // 15 minutos em milissegundos

interface VerificationCache {
  isValid: boolean;
  timestamp: number;
}

// Funções para gerenciar cache de verificação no localStorage
function getVerificationCache(): Record<string, VerificationCache> {
  if (typeof window === "undefined") return {};
  try {
    const cached = localStorage.getItem(VERIFICATION_CACHE_KEY);
    if (!cached) return {};
    const parsed = JSON.parse(cached);
    // Limpar entradas expiradas
    const now = Date.now();
    const valid: Record<string, VerificationCache> = {};
    for (const [id, data] of Object.entries(parsed)) {
      const entry = data as VerificationCache;
      if (now - entry.timestamp < VERIFICATION_CACHE_TTL) {
        valid[id] = entry;
      }
    }
    // Salvar de volta apenas as entradas válidas
    if (Object.keys(valid).length !== Object.keys(parsed).length) {
      localStorage.setItem(VERIFICATION_CACHE_KEY, JSON.stringify(valid));
    }
    return valid;
  } catch (error) {
    console.error("Erro ao ler cache de verificação:", error);
    return {};
  }
}

function saveVerificationCache(connectionId: string, isValid: boolean): void {
  if (typeof window === "undefined") return;
  try {
    const cache = getVerificationCache();
    cache[connectionId] = {
      isValid,
      timestamp: Date.now(),
    };
    localStorage.setItem(VERIFICATION_CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error("Erro ao salvar cache de verificação:", error);
  }
}

function clearVerificationCache(connectionId?: string): void {
  if (typeof window === "undefined") return;
  try {
    if (connectionId) {
      // Limpar cache de uma conexão específica
      const cache = getVerificationCache();
      delete cache[connectionId];
      localStorage.setItem(VERIFICATION_CACHE_KEY, JSON.stringify(cache));
    } else {
      // Limpar todo o cache
      localStorage.removeItem(VERIFICATION_CACHE_KEY);
    }
  } catch (error) {
    console.error("Erro ao limpar cache de verificação:", error);
  }
}

function isVerificationCached(connectionId: string): { isValid: boolean; cached: boolean } {
  const cache = getVerificationCache();
  const cached = cache[connectionId];
  if (cached) {
    return { isValid: cached.isValid, cached: true };
  }
  return { isValid: false, cached: false };
}

export function useFacebookConnectionVerification() {
  const [testingConnections, setTestingConnections] = useState<Set<string>>(new Set());
  const [expiredConnections, setExpiredConnections] = useState<Set<string>>(new Set());

  // Testar se uma conexão está válida
  const testConnection = useCallback(
    async (connectionId: string, forceRefresh: boolean = false): Promise<boolean> => {
      // Verificar cache se não for forçado
      if (!forceRefresh) {
        const cachedResult = isVerificationCached(connectionId);
        if (cachedResult && cachedResult.cached) {
          return cachedResult.isValid;
        }
      }

      try {
        // Usar o endpoint específico para testar a conexão individual
        const result = await facebookConnectorApi.testConnection(connectionId);
        const isValid = result.valid;
        // Salvar resultado no cache
        saveVerificationCache(connectionId, isValid);
        return isValid;
      } catch (error: any) {
        // Em caso de erro na requisição, considerar como inválida
        console.error(`Erro ao testar conexão ${connectionId}:`, error);
        saveVerificationCache(connectionId, false);
        return false;
      }
    },
    []
  );

  // Função para reteste manual de uma conexão específica
  const handleRetestConnection = useCallback(
    async (connectionId: string): Promise<boolean> => {
      // Limpar cache da conexão para forçar novo teste
      clearVerificationCache(connectionId);

      // Marcar como testando
      setTestingConnections((prev) => new Set(prev).add(connectionId));

      try {
        const isValid = await testConnection(connectionId, true); // forceRefresh = true

        // Atualizar estado de expiradas
        setExpiredConnections((prev) => {
          const next = new Set(prev);
          if (!isValid) {
            next.add(connectionId);
          } else {
            next.delete(connectionId);
          }
          return next;
        });

        return isValid;
      } catch (error) {
        console.error(`Erro ao retestar conexão ${connectionId}:`, error);
        setExpiredConnections((prev) => new Set(prev).add(connectionId));
        saveVerificationCache(connectionId, false);
        return false;
      } finally {
        setTestingConnections((prev) => {
          const next = new Set(prev);
          next.delete(connectionId);
          return next;
        });
      }
    },
    [testConnection]
  );

  // Verificar múltiplas conexões em background
  const verifyConnections = useCallback(
    async (connectionIds: string[], onProgress?: (connectionId: string, isValid: boolean) => void) => {
      // Primeiro, aplicar resultados do cache imediatamente
      const cache = getVerificationCache();
      const initialExpired = new Set<string>();
      for (const connId of connectionIds) {
        const cached = cache[connId];
        if (cached && !cached.isValid) {
          initialExpired.add(connId);
        }
      }
      setExpiredConnections(initialExpired);

      // Iniciar testes apenas para conexões sem cache válido
      const connectionsToTest = connectionIds.filter((connId) => {
        const cached = cache[connId];
        return !cached || !cached.isValid; // Testar apenas se não tiver cache válido ou se for inválido
      });

      // Se todas as conexões têm cache válido, pular os testes
      if (connectionsToTest.length === 0) {
        return;
      }

      // Iniciar testes de conexões sem cache em paralelo
      const testPromises = connectionsToTest.map(async (connId) => {
        // Marcar como testando
        setTestingConnections((prev) => new Set(prev).add(connId));

        try {
          const isValid = await testConnection(connId, false);

          // Atualizar estado de expiradas conforme cada teste termina
          setExpiredConnections((prev) => {
            const next = new Set(prev);
            if (!isValid) {
              next.add(connId);
            } else {
              next.delete(connId);
            }
            return next;
          });

          onProgress?.(connId, isValid);
          return { connectionId: connId, isValid };
        } catch (error) {
          console.error(`Erro ao testar conexão ${connId}:`, error);
          setExpiredConnections((prev) => new Set(prev).add(connId));
          saveVerificationCache(connId, false);
          onProgress?.(connId, false);
          return { connectionId: connId, isValid: false };
        } finally {
          // Remover do estado de testando
          setTestingConnections((prev) => {
            const next = new Set(prev);
            next.delete(connId);
            return next;
          });
        }
      });

      await Promise.all(testPromises);
    },
    [testConnection]
  );

  // Limpar cache quando uma conexão é deletada
  const clearConnectionCache = useCallback((connectionId: string) => {
    clearVerificationCache(connectionId);
    setExpiredConnections((prev) => {
      const next = new Set(prev);
      next.delete(connectionId);
      return next;
    });
  }, []);

  return {
    testConnection,
    handleRetestConnection,
    verifyConnections,
    clearConnectionCache,
    testingConnections,
    expiredConnections,
  };
}

