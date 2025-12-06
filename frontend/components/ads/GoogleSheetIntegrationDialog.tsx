"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Modal } from "@/components/common/Modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api/endpoints";
import { env } from "@/lib/config/env";
import { SheetIntegrationRequest, SheetColumnsResponse, SheetSyncResponse, GoogleConnection } from "@/lib/api/schemas";
import { showError, showSuccess } from "@/lib/utils/toast";
import { IconBrandGoogle, IconRefresh, IconTableExport, IconCheck, IconCircle, IconTrash, IconPlus, IconChevronLeft, IconLoader2, IconAlertCircle } from "@tabler/icons-react";
import { Progress } from "@/components/ui/progress";
import { SpreadsheetCombobox } from "./SpreadsheetCombobox";
import { WorksheetCombobox } from "./WorksheetCombobox";
import { openAuthPopup, AuthPopupError } from "@/lib/utils/authPopup";
import { MultiStepBreadcrumb, Step } from "@/components/common/MultiStepBreadcrumb";

export interface GoogleSheetIntegrationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Quando informado, a integração será salva e sincronizada como um "booster"
   * específico daquele pack. Caso não seja informado, a integração é global (modo legado).
   */
  packId?: string | null;
}

type DialogStep = "connect" | "select-sheet" | "select-columns" | "summary";

export function GoogleSheetIntegrationDialog({ isOpen, onClose, packId }: GoogleSheetIntegrationDialogProps) {
  const [step, setStep] = useState<DialogStep>("connect");
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoadingColumns, setIsLoadingColumns] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importStep, setImportStep] = useState<"idle" | "saving" | "reading" | "processing" | "complete">("idle");
  const [importProgress, setImportProgress] = useState(0);
  const [connections, setConnections] = useState<GoogleConnection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>("");
  const [isLoadingConnections, setIsLoadingConnections] = useState(false);
  const [isDeletingConnection, setIsDeletingConnection] = useState(false);
  const [expiredConnections, setExpiredConnections] = useState<Set<string>>(new Set());
  const [testingConnections, setTestingConnections] = useState<Set<string>>(new Set());

  const [selectedSpreadsheetId, setSelectedSpreadsheetId] = useState("");
  const [worksheetTitle, setWorksheetTitle] = useState("");
  const [columns, setColumns] = useState<string[]>([]);

  const [adIdColumn, setAdIdColumn] = useState("");
  const [dateColumn, setDateColumn] = useState("");
  const [dateFormat, setDateFormat] = useState<"DD/MM/YYYY" | "MM/DD/YYYY">("DD/MM/YYYY");
  const [leadscoreColumn, setLeadscoreColumn] = useState("");
  const [cprMaxColumn, setCprMaxColumn] = useState("");

  const [lastSyncStats, setLastSyncStats] = useState<SheetSyncResponse["stats"] | null>(null);
  const [integrationId, setIntegrationId] = useState<string | null>(null);

  // Constantes para cache de verificação
  const VERIFICATION_CACHE_KEY = "google_connections_verification_cache";
  const VERIFICATION_CACHE_TTL = 15 * 60 * 1000; // 15 minutos em milissegundos

  // Funções para gerenciar cache de verificação no localStorage
  const getVerificationCache = useCallback((): Record<string, { isValid: boolean; timestamp: number }> => {
    if (typeof window === "undefined") return {};
    try {
      const cached = localStorage.getItem(VERIFICATION_CACHE_KEY);
      if (!cached) return {};
      const parsed = JSON.parse(cached);
      // Limpar entradas expiradas
      const now = Date.now();
      const valid: Record<string, { isValid: boolean; timestamp: number }> = {};
      for (const [id, data] of Object.entries(parsed)) {
        const entry = data as { isValid: boolean; timestamp: number };
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

  // Testar se uma conexão está válida usando o endpoint específico do backend
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
        const result = await api.integrations.google.testConnection(connectionId);
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
    [isVerificationCached, saveVerificationCache]
  );

  const loadConnections = useCallback(async () => {
    try {
      setIsLoadingConnections(true);

      // ETAPA 1: Carregar conexões do Supabase (requisição rápida)
      const res = await api.integrations.google.listConnections();
      const connectionsList = res.connections || [];

      // Debug: verificar dados recebidos
      console.log(
        "Conexões recebidas do backend:",
        connectionsList.map((c) => ({
          id: c.id,
          email: c.google_email,
          name: c.google_name,
          user_id: c.google_user_id,
          hasEmail: !!c.google_email,
          hasName: !!c.google_name,
        }))
      );

      // Exibir conexões imediatamente (otimiza percepção de velocidade)
      setConnections(connectionsList);
      setIsLoadingConnections(false);

      // ETAPA 2: Testar conexões em background (assíncrono, não bloqueia UI)
      // Isso permite que o usuário veja as conexões enquanto elas são testadas
      if (connectionsList.length > 0) {
        // Primeiro, aplicar resultados do cache imediatamente (sem mostrar "Verificando...")
        const cache = getVerificationCache();
        const initialExpired = new Set<string>();
        for (const conn of connectionsList) {
          const cached = cache[conn.id];
          if (cached && !cached.isValid) {
            initialExpired.add(conn.id);
          }
        }
        setExpiredConnections(initialExpired);

        // Iniciar testes apenas para conexões sem cache válido
        const connectionsToTest = connectionsList.filter((conn) => {
          const cached = cache[conn.id];
          return !cached || !cached.isValid; // Testar apenas se não tiver cache válido ou se for inválido
        });

        // Se todas as conexões têm cache válido, pular os testes
        if (connectionsToTest.length === 0) {
          // Aplicar seleção automática baseada no cache
          const expiredSet = initialExpired;
          setSelectedConnectionId((prevSelected) => {
            let newSelected = prevSelected;

            if (connectionsList.length > 0 && !prevSelected) {
              const validConnection = connectionsList.find((conn) => !expiredSet.has(conn.id));
              if (validConnection) {
                newSelected = validConnection.id;
                setIsGoogleConnected(true);
              }
            } else if (prevSelected && expiredSet.has(prevSelected)) {
              newSelected = "";
              setIsGoogleConnected(false);
            }

            return newSelected;
          });
          return;
        }

        // Iniciar testes de conexões sem cache em paralelo
        const testPromises = connectionsToTest.map(async (conn) => {
          // Marcar como testando
          setTestingConnections((prev) => new Set(prev).add(conn.id));

          try {
            const isValid = await testConnection(conn.id, false);

            // Atualizar estado de expiradas conforme cada teste termina
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
            // Em caso de erro, considerar como expirada
            setExpiredConnections((prev) => new Set(prev).add(conn.id));
            saveVerificationCache(conn.id, false);
            return { connectionId: conn.id, isValid: false };
          } finally {
            // Remover do estado de testando
            setTestingConnections((prev) => {
              const next = new Set(prev);
              next.delete(conn.id);
              return next;
            });
          }
        });

        // Aguardar todos os testes terminarem
        const results = await Promise.all(testPromises);
        const expiredSet = new Set(results.filter((r) => !r.isValid).map((r) => r.connectionId));

        // Selecionar primeira conexão válida (não expirada) apenas se não houver seleção atual
        // Usar função de atualização para evitar dependência circular no useCallback
        setSelectedConnectionId((prevSelected) => {
          let newSelected = prevSelected;

          if (connectionsList.length > 0 && !prevSelected) {
            const validConnection = connectionsList.find((conn) => !expiredSet.has(conn.id));
            if (validConnection) {
              newSelected = validConnection.id;
              setIsGoogleConnected(true);
            }
          } else if (prevSelected && expiredSet.has(prevSelected)) {
            // Se a conexão selecionada expirou, limpar seleção
            newSelected = "";
            setIsGoogleConnected(false);
          }

          return newSelected;
        });
      } else {
        // Se não há conexões, limpar seleção
        setSelectedConnectionId("");
        setIsGoogleConnected(false);
      }
    } catch (error) {
      console.error("Erro ao carregar conexões:", error);
      setIsLoadingConnections(false);
    }
  }, [testConnection, getVerificationCache, saveVerificationCache]);

  // Função para reteste manual de uma conexão específica
  const handleRetestConnection = useCallback(
    async (connectionId: string, e: React.MouseEvent) => {
      e.stopPropagation();

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

        // Se a conexão selecionada foi testada e é válida, garantir que está conectada
        if (selectedConnectionId === connectionId && isValid) {
          setIsGoogleConnected(true);
        } else if (selectedConnectionId === connectionId && !isValid) {
          setIsGoogleConnected(false);
        }
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
    [testConnection, clearVerificationCache, saveVerificationCache, selectedConnectionId]
  );

  // Carregar conexões existentes quando abrir
  useEffect(() => {
    if (isOpen) {
      loadConnections();
    }
  }, [isOpen, loadConnections]);

  // Listener para detectar quando token expira durante uso
  useEffect(() => {
    const handleTokenExpired = (event: CustomEvent) => {
      if (!isOpen) return;

      // Mostrar mensagem e solicitar reconexão
      showError(new Error("Sua conexão com o Google Sheets expirou. Por favor, reconecte sua conta para continuar."));

      // Voltar para o step de conexão e limpar seleção
      setStep("connect");
      setSelectedConnectionId("");
      setIsGoogleConnected(false);
      setSelectedSpreadsheetId("");
      setWorksheetTitle("");
      setColumns([]);

      // Recarregar conexões para atualizar status
      loadConnections();
    };

    window.addEventListener("google-token-expired", handleTokenExpired as EventListener);

    return () => {
      window.removeEventListener("google-token-expired", handleTokenExpired as EventListener);
    };
  }, [isOpen, loadConnections]);

  // Resetar estado ao abrir/fechar
  useEffect(() => {
    if (!isOpen) {
      setStep("connect");
      setIsGoogleConnected(false);
      setIsConnecting(false);
      setIsLoadingColumns(false);
      setIsImporting(false);
      setSelectedSpreadsheetId("");
      setWorksheetTitle("");
      setColumns([]);
      setAdIdColumn("");
      setDateColumn("");
      setDateFormat("DD/MM/YYYY");
      setLeadscoreColumn("");
      setCprMaxColumn("");
      setLastSyncStats(null);
      setIntegrationId(null);
      setSelectedConnectionId("");
      setConnections([]);
      setImportStep("idle");
      setImportProgress(0);
      setExpiredConnections(new Set());
      setTestingConnections(new Set());
    }
  }, [isOpen]);

  const handleSelectConnection = (connectionId: string) => {
    // Não permitir selecionar conexão expirada
    if (expiredConnections.has(connectionId)) {
      return;
    }
    setSelectedConnectionId(connectionId);
    setIsGoogleConnected(true);
    // Não avança automaticamente, usuário precisa clicar em "Avançar"
  };

  const handleReconnect = async (connectionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      // Deletar conexão expirada
      await api.integrations.google.deleteConnection(connectionId);

      // Limpar seleção se era a conexão selecionada
      if (selectedConnectionId === connectionId) {
        setSelectedConnectionId("");
        setIsGoogleConnected(false);
      }

      // Remover da lista de expiradas
      setExpiredConnections((prev) => {
        const next = new Set(prev);
        next.delete(connectionId);
        return next;
      });

      // Iniciar novo fluxo de conexão
      await handleConnectGoogle();
    } catch (error) {
      showError(error instanceof Error ? error : new Error("Erro ao reconectar conta Google"));
    }
  };

  const handleDeleteConnection = async (connectionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Tem certeza que deseja deletar esta conexão?")) {
      return;
    }
    try {
      setIsDeletingConnection(true);
      await api.integrations.google.deleteConnection(connectionId);
      // Limpar cache da conexão deletada
      clearVerificationCache(connectionId);
      showSuccess("Conexão deletada com sucesso!");
      await loadConnections();
      if (selectedConnectionId === connectionId) {
        setSelectedConnectionId("");
        setIsGoogleConnected(false);
        setStep("connect");
      }
    } catch (error) {
      showError(error instanceof Error ? error : new Error("Erro ao deletar conexão"));
    } finally {
      setIsDeletingConnection(false);
    }
  };

  // Limpar aba e colunas quando a planilha mudar
  useEffect(() => {
    setWorksheetTitle("");
    setColumns([]);
    setAdIdColumn("");
    setDateColumn("");
    setLeadscoreColumn("");
    setCprMaxColumn("");
  }, [selectedSpreadsheetId]);

  // Limpar colunas quando a aba mudar
  useEffect(() => {
    setColumns([]);
    setAdIdColumn("");
    setDateColumn("");
    setLeadscoreColumn("");
    setCprMaxColumn("");
  }, [worksheetTitle]);

  const canLoadColumns = useMemo(() => !!selectedSpreadsheetId && !!worksheetTitle, [selectedSpreadsheetId, worksheetTitle]);

  const canImport = useMemo(() => !!selectedSpreadsheetId && !!worksheetTitle && !!adIdColumn && !!dateColumn && (!!leadscoreColumn || !!cprMaxColumn), [selectedSpreadsheetId, worksheetTitle, adIdColumn, dateColumn, leadscoreColumn, cprMaxColumn]);

  const handleConnectGoogle = async () => {
    try {
      setIsConnecting(true);
      // Usar window.location.origin para garantir que o redirect_uri seja correto
      const redirectUri = typeof window !== "undefined" ? `${window.location.origin}/callback` : env.FB_REDIRECT_URI;

      // 1) Obter URL de auth do backend
      let res;
      try {
        res = await api.integrations.google.getAuthUrl("google_sheets", redirectUri);
      } catch (error: any) {
        console.error("Erro ao obter URL de autenticação:", error);
        throw new Error(error?.message || "Erro ao conectar com o servidor. Verifique se o backend está rodando e acessível.");
      }

      if (!res?.auth_url) {
        throw new Error("Resposta inválida do servidor ao obter URL de autenticação.");
      }

      const authUrl = res.auth_url;

      // 2) Abrir popup + aguardar retorno do callback via util genérico
      const messageData = await openAuthPopup<{
        type?: string;
        code?: string;
        error?: string;
        errorDescription?: string;
        state?: string;
      }>({
        url: authUrl,
        windowName: "hookify-google-sheets-auth",
        windowFeatures: "width=600,height=700",
        successType: "GOOGLE_SHEETS_AUTH_SUCCESS",
        errorType: "GOOGLE_SHEETS_AUTH_ERROR",
        expectedState: "google_sheets",
        timeoutMs: 5 * 60 * 1000,
      });

      if (!messageData.code) {
        throw new Error("Código de autorização não recebido do Google.");
      }

      let connectionData: any;
      try {
        connectionData = await api.integrations.google.exchangeCode(messageData.code, redirectUri);
      } catch (e: any) {
        console.error("Erro ao trocar código por token:", e);
        // O erro pode ser um AppError com estrutura { message, status, code, details }
        // ou um Error padrão com e.message
        let errorMessage = "Erro ao finalizar autenticação. Verifique sua conexão com a internet e tente novamente.";

        if (e?.message) {
          errorMessage = e.message;
        } else if (typeof e === "string") {
          errorMessage = e;
        } else if (e?.details) {
          errorMessage = String(e.details);
        } else if (e?.toString && e.toString() !== "[object Object]") {
          errorMessage = e.toString();
        }

        // Adicionar informações adicionais para debug
        console.error("Detalhes completos do erro:", {
          error: e,
          errorType: typeof e,
          errorString: String(e),
          code: e?.code,
          status: e?.status,
          message: e?.message,
          details: e?.details,
          response: e?.response,
          request: e?.request,
          config: e?.config,
        });

        // Verificar se é erro de rede
        if (e?.code === "ERR_NETWORK" || e?.code === "ECONNREFUSED" || e?.code === "ENOTFOUND") {
          errorMessage = "Não foi possível conectar ao servidor. Verifique se o backend está rodando e acessível.";
        } else if (e?.status === 401) {
          errorMessage = "Não autorizado. Sua sessão pode ter expirado. Por favor, faça login novamente.";
        } else if (e?.status === 500) {
          errorMessage = "Erro interno do servidor. Tente novamente mais tarde.";
        } else if (e?.status) {
          errorMessage = `Erro do servidor (${e.status}): ${errorMessage}`;
        }

        throw new Error(errorMessage);
      }

      showSuccess("Google Sheets conectado! Agora você pode configurar a planilha para enriquecer os anúncios.");
      await loadConnections();
      // Selecionar a conexão recém-criada
      if (connectionData?.connection?.id) {
        setSelectedConnectionId(connectionData.connection.id);
        setIsGoogleConnected(true);
        // Não avança automaticamente, usuário precisa clicar em "Avançar"
      }
    } catch (e: any) {
      console.error("Erro completo na conexão Google:", e);

      // Se o usuário apenas fechou o popup, não tratar como erro "vermelho"
      const authError = e as AuthPopupError;
      if (authError?.code === "AUTH_POPUP_CLOSED") {
        // Cancelamento explícito pelo usuário – opcionalmente poderíamos exibir um toast informativo.
        return;
      }

      // Ajustar mensagem específica para timeout no contexto de Google Sheets
      if (authError?.code === "AUTH_POPUP_TIMEOUT") {
        showError(new Error("Tempo limite para autenticação com Google Sheets atingido."));
        return;
      }

      // Melhorar mensagem de erro para o usuário
      const errorMessage = e?.message || e?.toString() || "Erro desconhecido ao conectar com Google Sheets";
      showError(new Error(errorMessage));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleLoadColumns = async () => {
    if (!canLoadColumns) return;
    try {
      setIsLoadingColumns(true);
      const res: SheetColumnsResponse = await api.integrations.google.listColumns(selectedSpreadsheetId, worksheetTitle);
      setColumns(res.columns || []);

      if (!res.columns || res.columns.length === 0) {
        showError(new Error("Não encontramos colunas na primeira linha da aba. Verifique se a planilha possui cabeçalhos."));
      }
    } catch (e: any) {
      showError(e);
    } finally {
      setIsLoadingColumns(false);
    }
  };

  const handleImport = async () => {
    if (!canImport) return;
    try {
      setIsImporting(true);

      const payload: SheetIntegrationRequest = {
        spreadsheet_id: selectedSpreadsheetId,
        worksheet_title: worksheetTitle,
        ad_id_column: adIdColumn,
        date_column: dateColumn,
        date_format: dateFormat,
        leadscore_column: leadscoreColumn || null,
        cpr_max_column: cprMaxColumn || null,
        pack_id: packId || null,
      };

      // Etapa 1: Salvar configuração
      setImportStep("saving");
      setImportProgress(15);
      const saveRes = await api.integrations.google.saveSheetIntegration(payload);
      const integration = saveRes.integration;
      const id = integration.id;
      setIntegrationId(id);

      // Pequeno delay para feedback visual
      await new Promise((resolve) => setTimeout(resolve, 200));
      setImportProgress(25);

      // Etapa 2: Ler planilha
      setImportStep("reading");
      setImportProgress(35);

      // Etapa 3: Processar e aplicar dados
      setImportStep("processing");
      setImportProgress(50);

      const syncRes: SheetSyncResponse = await api.integrations.google.syncSheetIntegration(id);

      // Concluído
      setImportStep("complete");
      setImportProgress(100);

      // Pequeno delay antes de mostrar o summary para o usuário ver o progresso completo
      await new Promise((resolve) => setTimeout(resolve, 800));

      setLastSyncStats(syncRes.stats);
      setStep("summary");

      showSuccess(`Importação concluída! Atualizadas ${syncRes.stats.updated_rows} linhas em ad_metrics.`);

      // Recarregar packs para atualizar dados de integração no card
      // Isso garante que o card mostre "Planilha conectada" imediatamente
      if (packId) {
        try {
          const response = await api.analytics.listPacks(false);
          if (response.success && response.packs) {
            const updatedPack = response.packs.find((p: any) => p.id === packId);
            if (updatedPack?.sheet_integration) {
              // Disparar evento customizado para que o PacksLoader recarregue
              window.dispatchEvent(
                new CustomEvent("pack-integration-updated", {
                  detail: { packId, sheetIntegration: updatedPack.sheet_integration },
                })
              );
            }
          }
        } catch (error) {
          console.error("Erro ao recarregar pack após integração:", error);
          // Não bloquear sucesso se falhar ao recarregar
        }
      }
    } catch (e: any) {
      setImportStep("idle");
      setImportProgress(0);
      showError(e);
    } finally {
      setIsImporting(false);
      // Resetar progresso após um delay para permitir visualização
      setTimeout(() => {
        if (step !== "summary") {
          setImportStep("idle");
          setImportProgress(0);
        }
      }, 2000);
    }
  };

  const handleSyncAgain = async () => {
    if (!integrationId) return;
    try {
      setIsImporting(true);
      const syncRes: SheetSyncResponse = await api.integrations.google.syncSheetIntegration(integrationId);
      setLastSyncStats(syncRes.stats);

      showSuccess(`Dados atualizados! Atualizadas ${syncRes.stats.updated_rows} linhas em ad_metrics.`);
    } catch (e: any) {
      showError(e);
    } finally {
      setIsImporting(false);
    }
  };

  // Prevenir fechamento durante importação
  const handleClose = () => {
    if (isImporting) {
      return; // Não permite fechar durante importação
    }
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} size="xl" padding="lg" closeOnOverlayClick={!isImporting} closeOnEscape={!isImporting} showCloseButton={!isImporting}>
      <div className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <IconTableExport className="w-5 h-5" />
            Enriquecer anúncios com Google Sheets
          </h2>
          <p className="text-sm text-muted-foreground">
            Conecte uma planilha com colunas de <strong>ad_id</strong>, <strong>Data</strong>, <strong>Leadscore</strong> e/ou <strong>CPR max</strong>. Os dados serão aplicados como patch direto na tabela <code>ad_metrics</code> do Supabase.
          </p>
        </div>

        {/* Indicador de Steps */}
        <MultiStepBreadcrumb
          steps={[
            {
              id: "connect",
              label: "Conectar Google",
              description: isGoogleConnected ? (selectedConnectionId ? connections.find((c) => c.id === selectedConnectionId)?.google_name || connections.find((c) => c.id === selectedConnectionId)?.google_email || "Conta Google" : "Conectado") : undefined,
              status: isGoogleConnected ? "completed" : step === "connect" ? "active" : "pending",
            },
            {
              id: "select-sheet",
              label: "Selecionar planilha",
              status: selectedSpreadsheetId && worksheetTitle ? "completed" : step === "select-sheet" && isGoogleConnected ? "active" : "pending",
            },
            {
              id: "select-columns",
              label: "Selecionar colunas",
              status: step === "summary" ? "completed" : step === "select-columns" && selectedSpreadsheetId && worksheetTitle ? "active" : "pending",
            },
          ]}
          currentStepId={step}
          variant="visual"
          onStepClick={(stepId) => setStep(stepId as DialogStep)}
        />

        {/* Step 1: Conectar Google */}
        {step === "connect" && (
          <section className="space-y-4">
            <h3 className="font-semibold text-lg flex items-center gap-2">Conectar conta Google</h3>
            <p className="text-sm text-muted-foreground">
              Selecione uma conexão existente ou crie uma nova para acessar as planilhas do Google Sheets. Usamos apenas permissão de leitura (<code>spreadsheets.readonly</code>) para importar os valores.
            </p>

            {/* Lista de conexões existentes */}
            {isLoadingConnections ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-sm text-muted-foreground">Carregando conexões...</div>
              </div>
            ) : connections.length > 0 ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">Conexões existentes</label>
                <div className="space-y-2">
                  {connections.map((conn) => {
                    const isExpired = expiredConnections.has(conn.id);
                    const isTesting = testingConnections.has(conn.id);
                    const isSelected = selectedConnectionId === conn.id;
                    const canSelect = !isExpired && !isTesting;

                    return (
                      <div key={conn.id} className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${isSelected && canSelect ? "border-primary bg-primary/5 cursor-pointer" : isExpired ? "border-destructive/50 bg-destructive/5 cursor-not-allowed opacity-75" : canSelect ? "border-border hover:bg-accent cursor-pointer" : "border-border cursor-not-allowed opacity-50"}`} onClick={() => canSelect && handleSelectConnection(conn.id)}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="font-medium text-sm truncate">{conn.google_email || conn.google_name || conn.google_user_id || "Conta Google"}</div>
                          </div>
                          {conn.google_name && conn.google_name !== conn.google_email && conn.google_email && <div className="text-xs text-muted-foreground truncate">{conn.google_name}</div>}
                          {!conn.google_email && !conn.google_name && conn.google_user_id && <div className="text-xs text-muted-foreground truncate">ID: {conn.google_user_id}</div>}
                        </div>
                        <div className="flex items-center gap-2">
                          {isTesting ? (
                            <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs" disabled>
                              <IconLoader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                              Verificando...
                            </Button>
                          ) : isExpired ? (
                            <Button type="button" variant="default" size="sm" className="h-8 text-xs" onClick={(e) => handleReconnect(conn.id, e)} disabled={isConnecting || isDeletingConnection}>
                              Reconectar
                            </Button>
                          ) : (
                            <>
                              <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs border-border" onClick={(e) => handleRetestConnection(conn.id, e)} disabled={isDeletingConnection} title="Verificar novamente">
                                <div className="flex items-center gap-1.5">
                                  <IconCheck className="w-3.5 h-3.5 text-green-500" />
                                  <span className="text-green-500 font-medium">Conectada</span>
                                  <span className="text-muted-foreground mx-1">|</span>
                                  <IconRefresh className="w-3.5 h-3.5 text-muted-foreground" />
                                </div>
                              </Button>
                              <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={(e) => handleDeleteConnection(conn.id, e)} disabled={isDeletingConnection}>
                                <IconTrash className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* Botão Avançar do Step 1 */}
                {selectedConnectionId && !expiredConnections.has(selectedConnectionId) && (
                  <div className="pt-4 border-t border-border">
                    <Button
                      type="button"
                      variant="default"
                      className="w-full"
                      onClick={() => {
                        setStep("select-sheet");
                      }}
                    >
                      Avançar
                    </Button>
                  </div>
                )}
              </div>
            ) : null}

            {/* Botão para criar nova conexão */}
            <div className="pt-4 border-t border-border">
              <Button type="button" variant="outline" size="lg" className="flex items-center gap-2 w-full" onClick={handleConnectGoogle} disabled={isConnecting}>
                <IconPlus className="w-5 h-5" />
                {isConnecting ? "Conectando..." : "Criar nova conexão"}
              </Button>
            </div>
          </section>
        )}

        {/* Step 2: Selecionar planilha e aba */}
        {step === "select-sheet" && isGoogleConnected && (
          <section className="space-y-4">
            <h3 className="font-semibold text-lg flex items-center gap-2">Selecionar planilha e aba</h3>

            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Selecione a planilha</label>
                <SpreadsheetCombobox value={selectedSpreadsheetId} onValueChange={setSelectedSpreadsheetId} placeholder="Busque e selecione uma planilha..." />
                <p className="text-xs text-muted-foreground">As planilhas são ordenadas por modificação recente. Role para carregar mais.</p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Nome da aba</label>
                <WorksheetCombobox spreadsheetId={selectedSpreadsheetId} value={worksheetTitle} onValueChange={setWorksheetTitle} placeholder="Selecione uma aba..." disabled={!selectedSpreadsheetId} />
                {!selectedSpreadsheetId && <p className="text-xs text-muted-foreground">Selecione uma planilha primeiro para carregar as abas disponíveis.</p>}
              </div>
            </div>

            {/* Ações do Step 2 */}
            <div className="space-y-3 pt-4 border-t border-border">
              <div className="flex items-center justify-between gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setStep("connect")} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                  <IconChevronLeft className="w-4 h-4" />
                  Voltar
                </Button>
                <Button
                  type="button"
                  variant="default"
                  onClick={async () => {
                    if (!canLoadColumns) return;
                    // Carregar colunas automaticamente ao avançar
                    try {
                      setIsLoadingColumns(true);
                      const res: SheetColumnsResponse = await api.integrations.google.listColumns(selectedSpreadsheetId, worksheetTitle);
                      setColumns(res.columns || []);

                      if (!res.columns || res.columns.length === 0) {
                        showError(new Error("Não encontramos colunas na primeira linha da aba. Verifique se a planilha possui cabeçalhos."));
                        return;
                      }
                      setStep("select-columns");
                    } catch (e: any) {
                      showError(e);
                    } finally {
                      setIsLoadingColumns(false);
                    }
                  }}
                  disabled={!canLoadColumns || isLoadingColumns}
                >
                  {isLoadingColumns ? "Carregando..." : "Avançar"}
                </Button>
              </div>
            </div>
          </section>
        )}

        {/* Step 3: Selecionar colunas */}
        {step === "select-columns" && isGoogleConnected && selectedSpreadsheetId && worksheetTitle && (
          <section className="space-y-4">
            <h3 className="font-semibold text-lg flex items-center gap-2">Selecionar colunas</h3>

            {columns.length === 0 ? (
              <div className="text-sm text-muted-foreground">Carregando colunas...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Coluna de Ad ID *</label>
                  <Select value={adIdColumn} onValueChange={setAdIdColumn}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a coluna de ad_id" />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Coluna de Data *</label>
                  <Select value={dateColumn} onValueChange={setDateColumn}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a coluna de data" />
                    </SelectTrigger>
                    <SelectContent>
                      {columns.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Formato de Data *</label>
                  <Select value={dateFormat} onValueChange={(val) => setDateFormat(val as "DD/MM/YYYY" | "MM/DD/YYYY")}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o formato de data" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DD/MM/YYYY">DD/MM/YYYY (ex: 15/01/2025)</SelectItem>
                      <SelectItem value="MM/DD/YYYY">MM/DD/YYYY (ex: 01/15/2025)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">A data na planilha pode conter hora (ex: "DD/MM/YYYY HH:mm"), mas apenas a data será extraída.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Coluna de Leadscore (opcional)</label>
                  <Select value={leadscoreColumn || "__none__"} onValueChange={(val) => setLeadscoreColumn(val === "__none__" ? "" : val)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a coluna de Leadscore" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nenhuma</SelectItem>
                      {columns.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Coluna de CPR max (opcional)</label>
                  <Select value={cprMaxColumn || "__none__"} onValueChange={(val) => setCprMaxColumn(val === "__none__" ? "" : val)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione a coluna de CPR max" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Nenhuma</SelectItem>
                      {columns
                        .filter((c) => c !== leadscoreColumn)
                        .map((c) => (
                          <SelectItem key={c} value={c}>
                            {c}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Progresso da importação */}
            {isImporting && (
              <div className="space-y-4 pt-4 border-t border-border">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">Progresso da importação</span>
                    <span className="text-muted-foreground">{importProgress}%</span>
                  </div>
                  <Progress value={importProgress} />
                </div>

                <div className="space-y-2">
                  <div className={`flex items-center gap-2 text-sm ${importStep === "saving" ? "text-primary" : importStep === "reading" || importStep === "processing" || importStep === "complete" ? "text-green-500" : "text-muted-foreground"}`}>
                    {importStep === "saving" ? <IconLoader2 className="w-4 h-4 animate-spin" /> : importStep === "reading" || importStep === "processing" || importStep === "complete" ? <IconCheck className="w-4 h-4" /> : <IconCircle className="w-4 h-4" />}
                    <span>Salvando configuração da integração...</span>
                  </div>

                  <div className={`flex items-center gap-2 text-sm ${importStep === "reading" ? "text-primary" : importStep === "processing" || importStep === "complete" ? "text-green-500" : "text-muted-foreground"}`}>
                    {importStep === "reading" ? <IconLoader2 className="w-4 h-4 animate-spin" /> : importStep === "processing" || importStep === "complete" ? <IconCheck className="w-4 h-4" /> : <IconCircle className="w-4 h-4" />}
                    <span>Lendo dados da planilha do Google Sheets...</span>
                  </div>

                  <div className={`flex items-center gap-2 text-sm ${importStep === "processing" ? "text-primary" : importStep === "complete" ? "text-green-500" : "text-muted-foreground"}`}>
                    {importStep === "processing" ? <IconLoader2 className="w-4 h-4 animate-spin" /> : importStep === "complete" ? <IconCheck className="w-4 h-4" /> : <IconCircle className="w-4 h-4" />}
                    <span>Processando e aplicando dados em ad_metrics...</span>
                  </div>

                  {importStep === "complete" && (
                    <div className="flex items-center gap-2 text-sm text-green-500">
                      <IconCheck className="w-4 h-4" />
                      <span>Importação concluída com sucesso!</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Ações do Step 3 */}
            <div className="space-y-3 pt-4 border-t border-border">
              <div className="flex items-center justify-between gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setStep("select-sheet")} className="flex items-center gap-1 text-muted-foreground hover:text-foreground" disabled={isImporting}>
                  <IconChevronLeft className="w-4 h-4" />
                  Voltar
                </Button>
                <Button type="button" onClick={handleImport} disabled={!canImport || isImporting}>
                  {isImporting ? (
                    <span className="flex items-center gap-2">
                      <IconLoader2 className="w-4 h-4 animate-spin" />
                      Aplicando...
                    </span>
                  ) : (
                    "Aplicar"
                  )}
                </Button>
              </div>
              {!isImporting && (
                <div className="text-xs text-muted-foreground">
                  Os valores serão aplicados apenas em linhas existentes em <code>ad_metrics</code> (match por <code>ad_id</code> + <code>date</code>). Linhas sem correspondência serão ignoradas.
                </div>
              )}
            </div>
          </section>
        )}

        {/* Step 3: Summary (opcional, após importação) */}
        {step === "summary" && lastSyncStats && (
          <section className="space-y-4">
            <div className="border border-green-500/30 bg-green-500/10 rounded-lg p-6">
              <h3 className="font-semibold text-lg flex items-center gap-2 text-green-500 mb-4">
                <IconCheck className="w-5 h-5" />
                Importação concluída com sucesso!
              </h3>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">Linhas processadas</div>
                    <div className="font-semibold text-lg">{lastSyncStats.processed_rows}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Linhas atualizadas</div>
                    <div className="font-semibold text-lg text-green-500">{lastSyncStats.updated_rows}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Sem correspondência</div>
                    <div className="font-semibold text-lg text-yellow-500">{lastSyncStats.skipped_no_match}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Inválidas/sem dados</div>
                    <div className="font-semibold text-lg text-red-500">{lastSyncStats.skipped_invalid}</div>
                  </div>
                </div>
                <div className="flex gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={handleSyncAgain} disabled={isImporting} className="flex items-center gap-2">
                    <IconRefresh className="w-4 h-4" />
                    Atualizar dados novamente
                  </Button>
                  <Button type="button" variant="default" onClick={handleClose} disabled={isImporting}>
                    Fechar
                  </Button>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
