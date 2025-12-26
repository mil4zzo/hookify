import { useState, useCallback, useEffect } from "react";
import { api } from "@/lib/api/endpoints";
import { GoogleConnection } from "@/lib/api/schemas";
import { showError } from "@/lib/utils/toast";

const VERIFICATION_CACHE_KEY = "google_connections_verification_cache";
const VERIFICATION_CACHE_TTL = 15 * 60 * 1000; // 15 minutos

interface VerificationCache {
  [connectionId: string]: { isValid: boolean; timestamp: number };
}

export function useGoogleConnections(isOpen: boolean) {
  const [connections, setConnections] = useState<GoogleConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [isLoadingConnections, setIsLoadingConnections] = useState(false);
  const [isDeletingConnection, setIsDeletingConnection] = useState(false);
  const [expiredConnections, setExpiredConnections] = useState<Set<string>>(new Set());
  const [testingConnections, setTestingConnections] = useState<Set<string>>(new Set());

  const getVerificationCache = useCallback((): VerificationCache => {
    if (typeof window === "undefined") return {};
    try {
      const cached = localStorage.getItem(VERIFICATION_CACHE_KEY);
      if (!cached) return {};
      const parsed = JSON.parse(cached);
      const now = Date.now();
      const valid: VerificationCache = {};
      for (const [id, data] of Object.entries(parsed)) {
        const entry = data as { isValid: boolean; timestamp: number };
        if (now - entry.timestamp < VERIFICATION_CACHE_TTL) {
          valid[id] = entry;
        }
      }
      if (Object.keys(valid).length !== Object.keys(parsed).length) {
        localStorage.setItem(VERIFICATION_CACHE_KEY, JSON.stringify(valid));
      }
      return valid;
    } catch (error) {
      console.error("Erro ao ler cache de verificação:", error);
      return {};
    }
  }, []);

  const saveVerificationCache = useCallback(
    (connectionId: string, isValid: boolean) => {
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
    },
    [getVerificationCache]
  );

  const clearVerificationCache = useCallback(
    (connectionId?: string) => {
      if (typeof window === "undefined") return;
      try {
        if (connectionId) {
          const cache = getVerificationCache();
          delete cache[connectionId];
          localStorage.setItem(VERIFICATION_CACHE_KEY, JSON.stringify(cache));
        } else {
          localStorage.removeItem(VERIFICATION_CACHE_KEY);
        }
      } catch (error) {
        console.error("Erro ao limpar cache de verificação:", error);
      }
    },
    [getVerificationCache]
  );

  const isVerificationCached = useCallback(
    (connectionId: string): { isValid: boolean; cached: boolean } => {
      const cache = getVerificationCache();
      const cached = cache[connectionId];
      if (cached) {
        return { isValid: cached.isValid, cached: true };
      }
      return { isValid: false, cached: false };
    },
    [getVerificationCache]
  );

  const testConnection = useCallback(
    async (connectionId: string, forceRefresh: boolean = false): Promise<boolean> => {
      if (!forceRefresh) {
        const cachedResult = isVerificationCached(connectionId);
        if (cachedResult.cached) {
          return cachedResult.isValid;
        }
      }

      try {
        const result = await api.integrations.google.testConnection(connectionId);
        const isValid = result.valid;
        saveVerificationCache(connectionId, isValid);

        if (result.expired || (result as any).code === "GOOGLE_TOKEN_EXPIRED") {
          setExpiredConnections((prev) => new Set(prev).add(connectionId));
        }

        return isValid;
      } catch (error: any) {
        console.error(`Erro ao testar conexão ${connectionId}:`, error);
        const appError = error as any;
        if (appError?.code === "GOOGLE_TOKEN_EXPIRED") {
          setExpiredConnections((prev) => new Set(prev).add(connectionId));
        }
        saveVerificationCache(connectionId, false);
        return false;
      }
    },
    [isVerificationCached, saveVerificationCache]
  );

  const loadConnections = useCallback(async () => {
    try {
      setIsLoadingConnections(true);
      const res = await api.integrations.google.listConnections();
      const connectionsList = res.connections || [];

      setConnections(connectionsList);
      setIsLoadingConnections(false);

      if (connectionsList.length > 0) {
        const cache = getVerificationCache();
        const initialExpired = new Set<string>();
        for (const conn of connectionsList) {
          const cached = cache[conn.id];
          if (cached && !cached.isValid) {
            initialExpired.add(conn.id);
          }
        }
        setExpiredConnections(initialExpired);

        const connectionsToTest = connectionsList.filter((conn) => {
          const cached = cache[conn.id];
          return !cached || !cached.isValid;
        });

        if (connectionsToTest.length === 0) {
          const expiredSet = initialExpired;
          setSelectedConnectionId((prevSelected) => {
            if (connectionsList.length > 0 && !prevSelected) {
              const validConnection = connectionsList.find((conn) => !expiredSet.has(conn.id));
              if (validConnection) {
                return validConnection.id;
              }
            } else if (prevSelected && expiredSet.has(prevSelected)) {
              return "";
            }
            return prevSelected;
          });
          return;
        }

        const testPromises = connectionsToTest.map(async (conn) => {
          setTestingConnections((prev) => new Set(prev).add(conn.id));

          try {
            const isValid = await testConnection(conn.id, false);
            setExpiredConnections((prev) => {
              const next = new Set(prev);
              if (!isValid) {
                next.add(conn.id);
              } else {
                next.delete(conn.id);
              }
              return next;
            });
            return { connectionId: conn.id, isValid };
          } catch (error) {
            console.error(`Erro ao testar conexão ${conn.id}:`, error);
            setExpiredConnections((prev) => new Set(prev).add(conn.id));
            saveVerificationCache(conn.id, false);
            return { connectionId: conn.id, isValid: false };
          } finally {
            setTestingConnections((prev) => {
              const next = new Set(prev);
              next.delete(conn.id);
              return next;
            });
          }
        });

        const results = await Promise.all(testPromises);
        const expiredSet = new Set(results.filter((r) => !r.isValid).map((r) => r.connectionId));

        setSelectedConnectionId((prevSelected) => {
          if (connectionsList.length > 0 && !prevSelected) {
            const validConnection = connectionsList.find((conn) => !expiredSet.has(conn.id));
            if (validConnection) {
              return validConnection.id;
            }
          } else if (prevSelected && expiredSet.has(prevSelected)) {
            return "";
          }
          return prevSelected;
        });
      } else {
        setSelectedConnectionId("");
      }
    } catch (error) {
      console.error("Erro ao carregar conexões:", error);
      setIsLoadingConnections(false);
    }
  }, [testConnection, getVerificationCache, saveVerificationCache]);

  const handleRetestConnection = useCallback(
    async (connectionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      clearVerificationCache(connectionId);
      setTestingConnections((prev) => new Set(prev).add(connectionId));

      try {
        const isValid = await testConnection(connectionId, true);
        setExpiredConnections((prev) => {
          const next = new Set(prev);
          if (!isValid) {
            next.add(connectionId);
          } else {
            next.delete(connectionId);
          }
          return next;
        });
      } catch (error) {
        console.error(`Erro ao retestar conexão ${connectionId}:`, error);
        setExpiredConnections((prev) => new Set(prev).add(connectionId));
        saveVerificationCache(connectionId, false);
      } finally {
        setTestingConnections((prev) => {
          const next = new Set(prev);
          next.delete(connectionId);
          return next;
        });
      }
    },
    [testConnection, clearVerificationCache, saveVerificationCache]
  );

  const handleDeleteConnection = useCallback(
    async (connectionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!confirm("Tem certeza que deseja deletar esta conexão?")) {
        return;
      }
      try {
        setIsDeletingConnection(true);
        await api.integrations.google.deleteConnection(connectionId);
        
        // Remover da lista local sem recarregar todas
        setConnections((prev) => prev.filter((conn) => conn.id !== connectionId));
        
        // Limpar cache
        clearVerificationCache(connectionId);
        
        // Remover dos estados relacionados
        setExpiredConnections((prev) => {
          const next = new Set(prev);
          next.delete(connectionId);
          return next;
        });
        
        setTestingConnections((prev) => {
          const next = new Set(prev);
          next.delete(connectionId);
          return next;
        });
        
        // Limpar seleção se era a conexão selecionada
        if (selectedConnectionId === connectionId) {
          setSelectedConnectionId("");
        }
      } catch (error) {
        showError(error instanceof Error ? error : new Error("Erro ao deletar conexão"));
        // Em caso de erro, recarregar para garantir sincronização
        await loadConnections();
      } finally {
        setIsDeletingConnection(false);
      }
    },
    [selectedConnectionId, clearVerificationCache, loadConnections]
  );

  useEffect(() => {
    if (isOpen) {
      loadConnections();
    }
  }, [isOpen, loadConnections]);

  return {
    connections,
    selectedConnectionId,
    setSelectedConnectionId,
    isLoadingConnections,
    isDeletingConnection,
    expiredConnections,
    testingConnections,
    loadConnections,
    handleRetestConnection,
    handleDeleteConnection,
    clearVerificationCache,
    testConnection,
  };
}

