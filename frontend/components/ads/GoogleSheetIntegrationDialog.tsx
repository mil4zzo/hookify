"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { Modal } from "@/components/common/Modal";
import { api } from "@/lib/api/endpoints";
import { env } from "@/lib/config/env";
import { SheetIntegrationRequest, SheetColumnsResponse, GoogleConnection } from "@/lib/api/schemas";
import { showError, showSuccess } from "@/lib/utils/toast";
import { IconTableExport } from "@tabler/icons-react";
import { MultiStepBreadcrumb } from "@/components/common/MultiStepBreadcrumb";
import { cn } from "@/lib/utils/cn";
import { openAuthPopup, AuthPopupError } from "@/lib/utils/authPopup";
import { useQueryClient } from "@tanstack/react-query";
import { useGoogleConnections } from "./googleSheetsDialog/hooks/useGoogleConnections";
import { useGoogleSyncJob } from "./googleSheetsDialog/hooks/useGoogleSyncJob";
import { ConnectStep } from "./googleSheetsDialog/steps/ConnectStep";
import { SelectSheetStep } from "./googleSheetsDialog/steps/SelectSheetStep";
import { SelectColumnsStep } from "./googleSheetsDialog/steps/SelectColumnsStep";
import { SummaryStep } from "./googleSheetsDialog/steps/SummaryStep";

export interface GoogleSheetIntegrationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  packId?: string | null;
}

type DialogStep = "connect" | "select-sheet" | "select-columns" | "summary";

export function GoogleSheetIntegrationDialog({ isOpen, onClose, packId }: GoogleSheetIntegrationDialogProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<DialogStep>("connect");
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoadingColumns, setIsLoadingColumns] = useState(false);

  const [selectedSpreadsheetId, setSelectedSpreadsheetId] = useState("");
  const [selectedSpreadsheetName, setSelectedSpreadsheetName] = useState("");
  const [worksheetTitle, setWorksheetTitle] = useState("");
  const [columns, setColumns] = useState<string[]>([]);

  const [adIdColumn, setAdIdColumn] = useState("");
  const [dateColumn, setDateColumn] = useState("");
  const [dateFormat, setDateFormat] = useState<"DD/MM/YYYY" | "MM/DD/YYYY">("DD/MM/YYYY");
  const [leadscoreColumn, setLeadscoreColumn] = useState("");
  const [cprMaxColumn, setCprMaxColumn] = useState("");

  const [integrationId, setIntegrationId] = useState<string | null>(null);
  const [loadedIntegrationData, setLoadedIntegrationData] = useState<{ spreadsheetId: string; worksheetTitle: string } | null>(null);

  // Hooks
  const { connections, selectedConnectionId, setSelectedConnectionId, isLoadingConnections, isDeletingConnection, expiredConnections, testingConnections, loadConnections, handleRetestConnection, handleDeleteConnection, clearVerificationCache } = useGoogleConnections(isOpen);

  const { isImporting, importStep, importProgress, lastSyncStats, setLastSyncStats, startSync, reset: resetSync } = useGoogleSyncJob();

  // Atualizar isGoogleConnected quando selectedConnectionId mudar
  useEffect(() => {
    setIsGoogleConnected(!!selectedConnectionId && !expiredConnections.has(selectedConnectionId));
  }, [selectedConnectionId, expiredConnections]);

  // Carregar integração existente quando packId for fornecido
  useEffect(() => {
    if (isOpen && packId) {
      const loadExistingIntegration = async () => {
        try {
          const res = await api.integrations.google.listSheetIntegrations(packId);
          if (res.integrations && res.integrations.length > 0) {
            const integration = res.integrations[0];
            setSelectedSpreadsheetId(integration.spreadsheet_id || "");
            setSelectedSpreadsheetName(integration.spreadsheet_name || "");
            setWorksheetTitle(integration.worksheet_title || "");
            setAdIdColumn(integration.ad_id_column || "");
            setDateColumn(integration.date_column || "");
            setDateFormat((integration.date_format as "DD/MM/YYYY" | "MM/DD/YYYY") || "DD/MM/YYYY");
            setLeadscoreColumn(integration.leadscore_column || "");
            setCprMaxColumn(integration.cpr_max_column || "");
            setIntegrationId(integration.id);

            if (integration.spreadsheet_id && integration.worksheet_title) {
              setLoadedIntegrationData({
                spreadsheetId: integration.spreadsheet_id,
                worksheetTitle: integration.worksheet_title,
              });
            }
          }
        } catch (error) {
          console.error("Erro ao carregar integração existente:", error);
        }
      };
      loadExistingIntegration();
    } else if (isOpen && !packId) {
      setStep("connect");
      setSelectedSpreadsheetId("");
      setSelectedSpreadsheetName("");
      setWorksheetTitle("");
      setColumns([]);
      setAdIdColumn("");
      setDateColumn("");
      setLeadscoreColumn("");
      setCprMaxColumn("");
      setIntegrationId("");
      setLoadedIntegrationData(null);
    }
  }, [isOpen, packId]);

  // Tentar carregar colunas quando conexões estiverem disponíveis
  useEffect(() => {
    if (loadedIntegrationData && connections.length > 0 && !isLoadingConnections) {
      const loadColumnsForIntegration = async () => {
        const firstConn = connections[0];
        try {
          setSelectedConnectionId(firstConn.id);
          setIsGoogleConnected(true);
          const columnsRes = await api.integrations.google.listColumns(loadedIntegrationData.spreadsheetId, loadedIntegrationData.worksheetTitle, firstConn.id);
          setColumns(columnsRes.columns || []);
          setStep("select-columns");
          setLoadedIntegrationData(null);
        } catch (error) {
          console.error("Erro ao carregar colunas:", error);
          setLoadedIntegrationData(null);
        }
      };
      loadColumnsForIntegration();
    }
  }, [loadedIntegrationData, connections, isLoadingConnections, setSelectedConnectionId]);

  // Listener para detectar quando token expira
  useEffect(() => {
    const handleTokenExpired = (event: CustomEvent) => {
      if (!isOpen) return;

      const connectionId = event.detail?.connectionId;

      if (connectionId) {
        clearVerificationCache(connectionId);
      }

      showError(new Error("Sua conexão com o Google Sheets expirou. Por favor, reconecte sua conta para continuar."));

      if (connectionId && selectedConnectionId === connectionId) {
        setSelectedConnectionId("");
        setIsGoogleConnected(false);
        setSelectedSpreadsheetId("");
        setWorksheetTitle("");
        setColumns([]);
        setStep("connect");
      }

      loadConnections();
    };

    window.addEventListener("google-token-expired", handleTokenExpired as EventListener);

    return () => {
      window.removeEventListener("google-token-expired", handleTokenExpired as EventListener);
    };
  }, [isOpen, loadConnections, selectedConnectionId, clearVerificationCache, setSelectedConnectionId]);

  // Resetar estado ao abrir/fechar
  useEffect(() => {
    if (!isOpen) {
      setStep("connect");
      setIsGoogleConnected(false);
      setIsConnecting(false);
      setIsLoadingColumns(false);
      setSelectedSpreadsheetId("");
      setSelectedSpreadsheetName("");
      setWorksheetTitle("");
      setColumns([]);
      setAdIdColumn("");
      setDateColumn("");
      setDateFormat("DD/MM/YYYY");
      setLeadscoreColumn("");
      setCprMaxColumn("");
      setIntegrationId(null);
      setSelectedConnectionId("");
      resetSync();
      setLoadedIntegrationData(null);

      // Limpar caches do React Query quando o modal fecha
      queryClient.removeQueries({ queryKey: ["google-spreadsheets"] });
      queryClient.removeQueries({ queryKey: ["google-worksheets"] });
    }
  }, [isOpen, setSelectedConnectionId, resetSync, queryClient]);

  const handleSelectConnection = (connectionId: string) => {
    if (expiredConnections.has(connectionId)) {
      return;
    }
    setSelectedConnectionId(connectionId);
    setIsGoogleConnected(true);
  };

  const handleReconnect = async (connectionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.integrations.google.deleteConnection(connectionId);

      if (selectedConnectionId === connectionId) {
        setSelectedConnectionId("");
        setIsGoogleConnected(false);
      }

      await handleConnectGoogle();
    } catch (error) {
      showError(error instanceof Error ? error : new Error("Erro ao reconectar conta Google"));
    }
  };

  // Limpar aba e colunas quando a planilha mudar
  useEffect(() => {
    setWorksheetTitle("");
    // Mantemos selectedSpreadsheetName: ela será atualizada no onSpreadsheetNameChange
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

  const canImport = useMemo(() => !!selectedSpreadsheetId && !!worksheetTitle && !!adIdColumn && !!dateColumn && !!leadscoreColumn, [selectedSpreadsheetId, worksheetTitle, adIdColumn, dateColumn, leadscoreColumn]);

  const handleConnectGoogle = async () => {
    try {
      setIsConnecting(true);
      const redirectUri = typeof window !== "undefined" ? `${window.location.origin}/callback` : env.FB_REDIRECT_URI;

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
        let errorMessage = "Erro ao finalizar autenticação. Verifique sua conexão com a internet e tente novamente.";

        if (e?.message) {
          errorMessage = e.message;
        } else if (typeof e === "string") {
          errorMessage = e;
        } else if (e?.details) {
          errorMessage = String(e.details);
        }

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

      // Disparar evento de reconexão para retomar jobs pausados
      window.dispatchEvent(new CustomEvent("google-connected", {
        detail: { connectionId: connectionData?.connection?.id }
      }));

      await loadConnections();
      if (connectionData?.connection?.id) {
        setSelectedConnectionId(connectionData.connection.id);
        setIsGoogleConnected(true);
      }
    } catch (e: any) {
      const authError = e as AuthPopupError;
      if (authError?.code === "AUTH_POPUP_CLOSED") {
        return;
      }

      console.error("Erro completo na conexão Google:", e);

      if (authError?.code === "AUTH_POPUP_TIMEOUT") {
        showError(new Error("Tempo limite para autenticação com Google Sheets atingido."));
        return;
      }

      const errorMessage = e?.message || e?.toString() || "Erro desconhecido ao conectar com Google Sheets";
      showError(new Error(errorMessage));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleLoadColumns = async (): Promise<string[]> => {
    if (!canLoadColumns) return [];

    // Se já temos colunas carregadas, retornar imediatamente sem fazer requisição
    // Isso evita recarregar quando o usuário volta do step 3 para o step 2 e avança novamente
    if (columns.length > 0) {
      return columns;
    }

    try {
      setIsLoadingColumns(true);
      const res: SheetColumnsResponse = await api.integrations.google.listColumns(selectedSpreadsheetId, worksheetTitle, selectedConnectionId || undefined);
      const loadedColumns = res.columns || [];
      setColumns(loadedColumns);

      if (loadedColumns.length === 0) {
        showError(new Error("Não encontramos colunas na primeira linha da aba. Verifique se a planilha possui cabeçalhos."));
      }

      return loadedColumns;
    } catch (e: any) {
      showError(e);
      return [];
    } finally {
      setIsLoadingColumns(false);
    }
  };

  const handleImport = async () => {
    if (!canImport) return;
    try {
      const payload: SheetIntegrationRequest = {
        spreadsheet_id: selectedSpreadsheetId,
        worksheet_title: worksheetTitle,
        ad_id_column: adIdColumn,
        date_column: dateColumn,
        date_format: dateFormat,
        leadscore_column: leadscoreColumn || null,
        cpr_max_column: cprMaxColumn || null,
        pack_id: packId || null,
        connection_id: selectedConnectionId || null,
      };

      // Salvar configuração
      const saveRes = await api.integrations.google.saveSheetIntegration(payload);
      const id = saveRes.integration.id;
      setIntegrationId(id);

      // Iniciar sync
      await startSync(id);

      // Pequeno delay antes de mostrar o summary
      await new Promise((resolve) => setTimeout(resolve, 800));

      setStep("summary");

      const stats = lastSyncStats || { updated_rows: 0 };
      showSuccess(`Importação concluída! Atualizadas ${stats.updated_rows} linhas em ad_metrics.`);

      // Recarregar packs
      if (packId) {
        try {
          const response = await api.analytics.listPacks(false);
          if (response.success && response.packs) {
            const updatedPack = response.packs.find((p: any) => p.id === packId);
            if (updatedPack?.sheet_integration) {
              window.dispatchEvent(
                new CustomEvent("pack-integration-updated", {
                  detail: { packId, sheetIntegration: updatedPack.sheet_integration },
                })
              );
            }
          }
        } catch (error) {
          console.error("Erro ao recarregar pack após integração:", error);
        }
      }
    } catch (e: any) {
      showError(e);
    }
  };

  const handleSyncAgain = async () => {
    if (!integrationId) return;
    try {
      await startSync(integrationId);
      const stats = lastSyncStats || { updated_rows: 0 };
      showSuccess(`Dados atualizados! Atualizadas ${stats.updated_rows} linhas em ad_metrics.`);
    } catch (e: any) {
      showError(e);
    }
  };

  const handleClose = () => {
    if (isImporting) {
      return;
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
            Conecte uma planilha com colunas de <strong>ad_id</strong>, <strong>data</strong> e <strong>leadscore</strong> para habilitar métricas de Marketing Qualified Lead.
          </p>
        </div>

        {/* Indicador de Steps */}
        <MultiStepBreadcrumb
          steps={[
            {
              id: "connect",
              label: "Conectar Google",
              description: isGoogleConnected ? (selectedConnectionId ? connections.find((c) => c.id === selectedConnectionId)?.google_name || connections.find((c) => c.id === selectedConnectionId)?.google_email || "Conta Google" : "Conectado") : undefined,
              status: step !== "connect" ? "completed" : step === "connect" ? "active" : "pending",
            },
            {
              id: "select-sheet",
              label: "Selecionar planilha",
              status: step === "select-columns" || step === "summary" ? "completed" : step === "select-sheet" ? "active" : "pending",
              disabled: !isGoogleConnected,
            },
            {
              id: "select-columns",
              label: "Selecionar colunas",
              status: step === "summary" ? "completed" : step === "select-columns" ? "active" : "pending",
              disabled: !isGoogleConnected || !selectedSpreadsheetId || !worksheetTitle,
            },
          ]}
          currentStepId={step}
          variant="visual"
          onStepClick={(stepId) => setStep(stepId as DialogStep)}
        />

        {/* Step 1: Conectar Google (mantém montado; apenas oculta) */}
        <section className={cn(step !== "connect" && "hidden")}>
          <ConnectStep connections={connections} selectedConnectionId={selectedConnectionId} isLoadingConnections={isLoadingConnections} isConnecting={isConnecting} isDeletingConnection={isDeletingConnection} expiredConnections={expiredConnections} testingConnections={testingConnections} onSelectConnection={handleSelectConnection} onConnect={handleConnectGoogle} onRetest={handleRetestConnection} onReconnect={handleReconnect} onDelete={handleDeleteConnection} onNext={() => setStep("select-sheet")} />
        </section>

        {/* Step 2: Selecionar planilha e aba (mantém montado; apenas oculta) */}
        <section className={cn(step !== "select-sheet" && "hidden")}>
          <SelectSheetStep
            selectedSpreadsheetId={selectedSpreadsheetId}
            selectedSpreadsheetName={selectedSpreadsheetName}
            worksheetTitle={worksheetTitle}
            selectedConnectionId={selectedConnectionId || undefined}
            isLoadingColumns={isLoadingColumns}
            isActive={step === "select-sheet"}
            onSpreadsheetChange={(id) => {
              setSelectedSpreadsheetId(id);
              if (!id) {
                setSelectedSpreadsheetName("");
              }
            }}
            onSpreadsheetNameChange={(name) => setSelectedSpreadsheetName(name || "")}
            onWorksheetChange={setWorksheetTitle}
            onBack={() => setStep("connect")}
            onNext={async () => {
              if (!canLoadColumns) return;
              const loadedColumns = await handleLoadColumns();
              if (loadedColumns.length > 0) {
                setStep("select-columns");
              }
            }}
            canLoadColumns={canLoadColumns}
          />
        </section>

        {/* Step 3: Selecionar colunas ou Summary */}
        {isGoogleConnected && selectedSpreadsheetId && worksheetTitle && (
          <section className={cn("space-y-4", step !== "select-columns" && step !== "summary" && "hidden")}>
            {step === "summary" && lastSyncStats ? <SummaryStep stats={lastSyncStats} isImporting={isImporting} onSyncAgain={handleSyncAgain} onClose={handleClose} /> : <SelectColumnsStep columns={columns} adIdColumn={adIdColumn} dateColumn={dateColumn} dateFormat={dateFormat} leadscoreColumn={leadscoreColumn} cprMaxColumn={cprMaxColumn} isImporting={isImporting} importStep={importStep} importProgress={importProgress} canImport={canImport} onAdIdColumnChange={setAdIdColumn} onDateColumnChange={setDateColumn} onDateFormatChange={setDateFormat} onLeadscoreColumnChange={setLeadscoreColumn} onCprMaxColumnChange={setCprMaxColumn} onBack={() => setStep("select-sheet")} onImport={handleImport} />}
          </section>
        )}
      </div>
    </Modal>
  );
}
