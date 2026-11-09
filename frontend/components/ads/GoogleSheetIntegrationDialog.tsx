"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { translate } from "@/lib/i18n/translate";
import { AppDialog } from "@/components/common/AppDialog";
import { BulkApplyReviewDialog } from "@/components/common/BulkApplyReviewDialog";
import { reviewBulkSheet, type BulkReview } from "@/lib/utils/bulkApplyReview";
import { api } from "@/lib/api/endpoints";
import { env } from "@/lib/config/env";
import { SheetIntegrationRequest, SheetColumnsResponse } from "@/lib/api/schemas";
import { showError, showSuccess } from "@/lib/utils/toast";
import { IconTableExport } from "@tabler/icons-react";
import { MultiStepBreadcrumb } from "@/components/common/MultiStepBreadcrumb";
import { cn } from "@/lib/utils/cn";
import { openAuthPopup, AuthPopupError } from "@/lib/utils/authPopup";
import { guessColumnMappings } from "@/lib/utils/guessSheetColumns";
import { useQueryClient } from "@tanstack/react-query";
import { logger } from "@/lib/utils/logger";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { useGoogleConnections } from "./googleSheetsDialog/hooks/useGoogleConnections";
import { useGoogleSyncJob } from "./googleSheetsDialog/hooks/useGoogleSyncJob";
import { useBulkSheetSync } from "./googleSheetsDialog/hooks/useBulkSheetSync";
import { ConnectStep } from "./googleSheetsDialog/steps/ConnectStep";
import { SelectSheetStep } from "./googleSheetsDialog/steps/SelectSheetStep";
import { SelectColumnsStep, ColumnWithIndex, extraColumnProblem, resolveColumnIndex, type ExtraColumnDraft } from "./googleSheetsDialog/steps/SelectColumnsStep";
import { useDateColumnProbe } from "./googleSheetsDialog/hooks/useDateColumnProbe";
import type { SheetColumnKind, SheetColumnMapping } from "@/lib/api/schemas";
import { SummaryStep } from "./googleSheetsDialog/steps/SummaryStep";

export interface GoogleSheetIntegrationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  packId?: string | null;
  /**
   * Configuração em MASSA: a mesma planilha, aba, colunas e corte de MQL aplicados a
   * todos estes packs (só os do próprio usuário — quem abre já filtrou). Cria o vínculo
   * onde o pack não tem e substitui onde tem. Ignora `packId`.
   */
  bulkPackIds?: string[] | null;
}

type DialogStep = "connect" | "select-sheet" | "select-columns" | "summary";

export function GoogleSheetIntegrationDialog({ isOpen, onClose, packId: singlePackId, bulkPackIds }: GoogleSheetIntegrationDialogProps) {
  const t = useTranslations("ads.sheetDialog");
  const isBulk = !!bulkPackIds && bulkPackIds.length > 0;
  // No modo em massa não há "o" pack: `packId` vira null e a semente da configuração sai
  // do primeiro pack selecionado que já tem planilha (`seedPackId`).
  const packId = isBulk ? null : singlePackId;
  const queryClient = useQueryClient();
  const [step, setStep] = useState<DialogStep>("connect");
  const [isGoogleConnected, setIsGoogleConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isLoadingColumns, setIsLoadingColumns] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [selectedSpreadsheetId, setSelectedSpreadsheetId] = useState("");
  const [selectedSpreadsheetName, setSelectedSpreadsheetName] = useState("");
  const [worksheetTitle, setWorksheetTitle] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [columnsWithIndices, setColumnsWithIndices] = useState<ColumnWithIndex[]>([]);
  const [duplicates, setDuplicates] = useState<Record<string, number[]>>({});
  const [sampleRows, setSampleRows] = useState<string[][]>([]);

  const [adIdColumn, setAdIdColumn] = useState("");
  const [dateColumn, setDateColumn] = useState("");
  // "" = neutro. Antes nascia em DD/MM/YYYY: um default silencioso é exatamente o
  // que faz ninguém conferir, e o formato errado não dá erro — desloca o dia.
  const [dateFormat, setDateFormat] = useState<"DD/MM/YYYY" | "MM/DD/YYYY" | "">("");
  const [leadscoreColumn, setLeadscoreColumn] = useState("");
  // O corte de MQL e definido AQUI, junto da planilha: e ela que da a escala do
  // leadscore. Definir isso fora deste contexto seria adivinhar.
  const [mqlLeadscoreMin, setMqlLeadscoreMin] = useState("");
  // 140: colunas adicionais vinculadas. `extraColumnsReady` = a lista reflete o servidor
  // (integração nova, ou vínculos existentes carregados): só então o save manda
  // `column_mappings` — mandar [] sem ter carregado apagaria vínculos existentes.
  const [extraColumns, setExtraColumns] = useState<ExtraColumnDraft[]>([]);
  const [extraColumnsReady, setExtraColumnsReady] = useState(true);

  const [integrationId, setIntegrationId] = useState<string | null>(null);
  // Em massa, quando o save sobrescreve algo: o resumo por cima, com o payload pronto.
  const [pendingBulk, setPendingBulk] = useState<{ payload: SheetIntegrationRequest; review: BulkReview } | null>(null);
  useEffect(() => {
    if (!isOpen) setPendingBulk(null);
  }, [isOpen]);
  const [, setLoadedIntegrationData] = useState<{ spreadsheetId: string; worksheetTitle: string } | null>(null);

  /** Número de efeitos que ainda devem ignorar limpeza (selectedSpreadsheetId + worksheetTitle) ao carregar integração existente */
  const skipClearCountRef = useRef(0);

  const { packs, updatePack } = useClientPacks();
  // Ref para NAO reagir a mudancas do array de packs: semear so na abertura,
  // senao qualquer atualizacao do store apagaria o que o usuario acabou de digitar.
  const packsRef = useRef(packs);
  packsRef.current = packs;

  // Pack de onde a configuração inicial é lida: o próprio, ou (em massa) o primeiro
  // selecionado que já tem planilha — o caso comum é todos no mesmo arquivo.
  const seedPackId = useMemo(() => {
    if (!isBulk) return packId ?? null;
    return bulkPackIds!.find((id) => packsRef.current.find((pk) => pk.id === id)?.sheet_integration) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- semear só na abertura (packsRef)
  }, [isBulk, packId, bulkPackIds, isOpen]);

  // Dono único do critério: pack sob pasta que define critério não tem corte próprio.
  // {pack_id: nome da pasta}; o campo do corte aparece travado, com o valor da pasta.
  const [mqlGovernors, setMqlGovernors] = useState<Record<string, string | null>>({});
  const scopePackIds = useMemo(() => (isBulk ? bulkPackIds ?? [] : packId ? [packId] : []), [isBulk, bulkPackIds, packId]);
  useEffect(() => {
    setMqlGovernors({});
    if (!isOpen || scopePackIds.length === 0) return;
    let cancelled = false;
    api.analytics
      .getJudgmentGovernors(scopePackIds)
      .then((res) => {
        if (!cancelled) setMqlGovernors(res.governors ?? {});
      })
      .catch((e) => logger.warn("Não deu para saber se uma pasta define o corte de MQL:", e));
    return () => {
      cancelled = true;
    };
  }, [isOpen, scopePackIds]);
  const mqlGovernedIds = scopePackIds.filter((id) => id in mqlGovernors);
  const mqlAllGoverned = scopePackIds.length > 0 && mqlGovernedIds.length === scopePackIds.length;
  const mqlFolderNames = Array.from(new Set(mqlGovernedIds.map((id) => mqlGovernors[id]).filter((n): n is string => !!n)));
  const mqlLockNote = mqlGovernedIds.length === 0
    ? null
    : mqlAllGoverned
      ? mqlFolderNames.length === 1
        ? translate("ads.selectColumns.mqlLockedByFolder", { folder: mqlFolderNames[0] })
        : translate("ads.selectColumns.mqlLockedByFolders")
      : translate("ads.selectColumns.mqlPartiallyLocked", { count: mqlGovernedIds.length });

  useEffect(() => {
    if (!isOpen) return;
    if (isBulk) {
      // Corte em massa: pré-preenche só quando todos os packs concordam; senão começa vazio.
      // Packs travados pela pasta não entram na conta, a menos que sejam todos (aí é o valor deles).
      const seedIds = mqlAllGoverned ? bulkPackIds! : bulkPackIds!.filter((id) => !(id in mqlGovernors));
      const cuts = new Set(seedIds.map((id) => packsRef.current.find((pk) => pk.id === id)?.mql_leadscore_min ?? null));
      const only = cuts.size === 1 ? Array.from(cuts)[0] : null;
      setMqlLeadscoreMin(only !== null && only !== undefined ? String(only) : "");
      return;
    }
    if (!packId) return;
    const current = packsRef.current.find((pk) => pk.id === packId)?.mql_leadscore_min;
    setMqlLeadscoreMin(current !== null && current !== undefined ? String(current) : "");
  }, [isOpen, packId, isBulk, bulkPackIds, mqlGovernors, mqlAllGoverned]);

  // Hooks
  const { connections, selectedConnectionId, setSelectedConnectionId, isLoadingConnections, isDeletingConnection, expiredConnections, testingConnections, loadConnections, handleRetestConnection, handleDeleteConnection, clearVerificationCache } = useGoogleConnections(isOpen);

  const { isImporting, importStep, importProgress, lastSyncStats, startSync, startSyncWithToast, reset: resetSync } = useGoogleSyncJob();
  const startBulkSync = useBulkSheetSync();

  // Atualizar isGoogleConnected quando selectedConnectionId mudar
  useEffect(() => {
    setIsGoogleConnected(!!selectedConnectionId && !expiredConnections.has(selectedConnectionId));
  }, [selectedConnectionId, expiredConnections]);

  // Carregar integração existente quando packId for fornecido (em massa: a do seedPackId)
  useEffect(() => {
    if (isOpen && seedPackId) {
      const loadExistingIntegration = async () => {
        skipClearCountRef.current = 2;
        setExtraColumnsReady(false);
        try {
          const res = await api.integrations.google.listSheetIntegrations(seedPackId);
          if (res.integrations && res.integrations.length > 0) {
            const integration = res.integrations[0];
            // 140: vínculos existentes entram travados (tipo e coluna de mão única)
            const mappings = Array.isArray(integration.column_mappings) ? (integration.column_mappings as SheetColumnMapping[]) : [];
            setExtraColumns(
              mappings.map((m) => ({
                key: `server_${m.id}`,
                // Em massa o vínculo é por pack: o servidor reaproveita o id de cada pack
                // pela mesma coluna (arquivo + cabeçalho). Aqui a coluna fica editável.
                serverId: isBulk ? undefined : m.id,
                columnValue: m.column_name || "",
                columnIndex: m.column_index,
                label: m.label,
                kind: m.kind,
                mqlMin: m.config?.mql_min != null ? String(m.config.mql_min) : "",
              })),
            );
            setExtraColumnsReady(true);
          } else {
            setExtraColumns([]);
            setExtraColumnsReady(true);
          }
          if (res.integrations && res.integrations.length > 0) {
            const integration = res.integrations[0];
            const integrationWithConnection = integration as {
              connection_id?: string | null;
              ad_id_column_index?: number | null;
              date_column_index?: number | null;
              leadscore_column_index?: number | null;
            };
            const fmt = (name: string, idx: number | null | undefined) =>
              name && idx != null ? `${name}|${idx}` : name || "";
            setSelectedSpreadsheetId(integration.spreadsheet_id || "");
            setSelectedSpreadsheetName(integration.spreadsheet_name || "");
            setWorksheetTitle(integration.worksheet_title || "");
            setAdIdColumn(fmt(integration.ad_id_column, integrationWithConnection.ad_id_column_index) || integration.ad_id_column || "");
            setDateColumn(fmt(integration.date_column, integrationWithConnection.date_column_index) || integration.date_column || "");
            setDateFormat((integration.date_format as "DD/MM/YYYY" | "MM/DD/YYYY") || "");
            setLeadscoreColumn(fmt(integration.leadscore_column, integrationWithConnection.leadscore_column_index) || integration.leadscore_column || "");
            if (!isBulk) setIntegrationId(integration.id);

            if (integrationWithConnection.connection_id) {
              setSelectedConnectionId(integrationWithConnection.connection_id);
            }
          }
        } catch (error) {
          logger.error("Erro ao carregar integração existente:", error);
        }
      };
      loadExistingIntegration();
    } else if (isOpen) {
      setStep("connect");
      setSelectedSpreadsheetId("");
      setSelectedSpreadsheetName("");
      setWorksheetTitle("");
      setColumns([]);
      setColumnsWithIndices([]);
      setDuplicates({});
      setSampleRows([]);
      setAdIdColumn("");
      setDateColumn("");
      setLeadscoreColumn("");
      setIntegrationId("");
      setLoadedIntegrationData(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isBulk acompanha seedPackId
  }, [isOpen, seedPackId]);

  // Listener para detectar quando token expira
  useEffect(() => {
    const handleTokenExpired = (event: CustomEvent) => {
      if (!isOpen) return;

      const connectionId = event.detail?.connectionId;

      if (connectionId) {
        clearVerificationCache(connectionId);
      }

      logger.error("GoogleSheetIntegrationDialog: token Google expirado", { connectionId });
      showError(new Error(translate("ads.sheetDialog.tokenExpired")));

      if (connectionId && selectedConnectionId === connectionId) {
        setSelectedConnectionId("");
        setIsGoogleConnected(false);
        setSelectedSpreadsheetId("");
        setWorksheetTitle("");
      setColumns([]);
      setColumnsWithIndices([]);
      setDuplicates({});
      setSampleRows([]);
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
      skipClearCountRef.current = 0;
      setStep("connect");
      setIsGoogleConnected(false);
      setIsConnecting(false);
      setIsLoadingColumns(false);
      setIsSaving(false);
      setSelectedSpreadsheetId("");
      setSelectedSpreadsheetName("");
      setWorksheetTitle("");
      setColumns([]);
      setColumnsWithIndices([]);
      setDuplicates({});
      setSampleRows([]);
      setAdIdColumn("");
      setDateColumn("");
      setDateFormat("");
      setLeadscoreColumn("");
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
      showError(error instanceof Error ? error : new Error(translate("ads.sheetDialog.reconnectError")));
    }
  };

  // Limpar aba e colunas quando a planilha mudar (não quando vier do carregamento da integração existente)
  useEffect(() => {
    if (skipClearCountRef.current > 0) {
      skipClearCountRef.current -= 1;
      return;
    }
    setWorksheetTitle("");
    // Mantemos selectedSpreadsheetName: ela será atualizada no onSpreadsheetNameChange
    setColumns([]);
    setColumnsWithIndices([]);
    setDuplicates({});
    setSampleRows([]);
    setAdIdColumn("");
    setDateColumn("");
    setLeadscoreColumn("");
    // 140: outra planilha/aba = outras colunas; os vínculos gravados são excluídos no save
    setExtraColumns([]);
  }, [selectedSpreadsheetId]);

  // Limpar colunas quando a aba mudar (não quando vier do carregamento da integração existente)
  useEffect(() => {
    if (skipClearCountRef.current > 0) {
      skipClearCountRef.current -= 1;
      return;
    }
    setColumns([]);
    setColumnsWithIndices([]);
    setDuplicates({});
    setSampleRows([]);
    setAdIdColumn("");
    setDateColumn("");
    setLeadscoreColumn("");
    // 140: outra planilha/aba = outras colunas; os vínculos gravados são excluídos no save
    setExtraColumns([]);
  }, [worksheetTitle]);

  const canLoadColumns = useMemo(() => !!selectedSpreadsheetId && !!worksheetTitle, [selectedSpreadsheetId, worksheetTitle]);

  const parsedMqlLeadscoreMin = useMemo(() => {
    const trimmed = mqlLeadscoreMin.trim();
    if (!trimmed) return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }, [mqlLeadscoreMin]);

  // Integrar planilha sem definir o corte deixaria o pack com leadscore e sem
  // como qualificar — MQL e CPMQL nasceriam indisponiveis. Por isso e exigido.
  // 140: toda coluna adicional precisa estar completa (coluna, tipo aceito pela amostra,
  // rótulo, corte se leadscore) — a mesma validação do backend, antes de sair daqui.
  const extraColumnsValid = useMemo(() => {
    const reserved = new Set<number>();
    for (const value of [adIdColumn, dateColumn]) {
      const idx = resolveColumnIndex(value, columnsWithIndices);
      if (idx != null) reserved.add(idx);
    }
    return extraColumns.every((draft) => extraColumnProblem(draft, sampleRows, reserved) === null);
  }, [extraColumns, adIdColumn, dateColumn, columnsWithIndices, sampleRows]);

  // Janela do pack: a comparação com o período da planilha é feita aqui, no
  // cliente, que já tem esse dado — o endpoint de sondagem fala só da planilha.
  const packWindow = useMemo(() => {
    if (isBulk) {
      // Em massa: a união dos períodos (do início mais cedo ao fim mais tarde).
      let start: string | null = null;
      let stop: string | null = null;
      for (const id of bulkPackIds!) {
        const pk = packs.find((p) => p.id === id);
        if (pk?.date_start && (!start || pk.date_start < start)) start = pk.date_start;
        if (pk?.date_stop && (!stop || pk.date_stop > stop)) stop = pk.date_stop;
      }
      return { start, stop };
    }
    const pk = packId ? packs.find((p) => p.id === packId) : undefined;
    return { start: pk?.date_start ?? null, stop: pk?.date_stop ?? null };
  }, [isBulk, bulkPackIds, packId, packs]);

  // Prévia do que a configuração em massa faz em cada pack.
  const bulkPreview = useMemo(() => {
    if (!isBulk) return null;
    const selected = bulkPackIds!.map((id) => packs.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
    const withSheet = selected.filter((p) => !!p.sheet_integration);
    const otherFile = selectedSpreadsheetId
      ? withSheet.filter((p) => p.sheet_integration?.spreadsheet_id && p.sheet_integration.spreadsheet_id !== selectedSpreadsheetId)
      : [];
    return { total: selected.length, toConnect: selected.length - withSheet.length, toReplace: withSheet.length, otherFile: otherFile.length };
  }, [isBulk, bulkPackIds, packs, selectedSpreadsheetId]);

  const dateColumnIndex = useMemo(
    () => (dateColumn ? resolveColumnIndex(dateColumn, columnsWithIndices) : null),
    [dateColumn, columnsWithIndices],
  );

  const { probe: dateProbe, isProbing: isProbingDate, failed: dateProbeFailed } = useDateColumnProbe({
    spreadsheetId: selectedSpreadsheetId,
    worksheetTitle,
    columnIndex: dateColumnIndex,
    connectionId: selectedConnectionId || undefined,
    enabled: isOpen && step === "select-columns",
  });

  // A sonda preenche o seletor quando os dados PROVAM o formato (algum valor com
  // componente > 12, que só pode ser dia). Roda uma vez por sondagem — trocar a
  // escolha manualmente depois não dispara nova sonda, então nada é sobrescrito.
  useEffect(() => {
    if (dateProbe?.resolved_format) setDateFormat(dateProbe.resolved_format);
  }, [dateProbe]);

  const canImport = useMemo(
    () => !!selectedSpreadsheetId && !!worksheetTitle && !!adIdColumn && !!dateColumn && !!dateFormat && !!leadscoreColumn && (parsedMqlLeadscoreMin !== null || mqlAllGoverned) && extraColumnsValid,
    [selectedSpreadsheetId, worksheetTitle, adIdColumn, dateColumn, dateFormat, leadscoreColumn, parsedMqlLeadscoreMin, mqlAllGoverned, extraColumnsValid]
  );

  const handleConnectGoogle = async () => {
    try {
      setIsConnecting(true);
      const redirectUri = typeof window !== "undefined" ? `${window.location.origin}/callback` : env.FB_REDIRECT_URI;

      let res;
      try {
        res = await api.integrations.google.getAuthUrl("google_sheets", redirectUri);
      } catch (error: any) {
        logger.error("Erro ao obter URL de autenticação:", error);
        throw new Error(error?.message || translate("ads.sheetDialog.serverError"));
      }

      if (!res?.auth_url) {
        logger.error("GoogleSheetIntegrationDialog: URL de auth inválida retornada pelo backend", { res });
        throw new Error(translate("ads.googleConnect.invalidResponse"));
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
      });

      if (!messageData.code) {
        logger.error("GoogleSheetIntegrationDialog: auth code ausente na resposta do callback Google", { messageData });
        throw new Error(translate("ads.googleConnect.noCode"));
      }

      let connectionData: any;
      try {
        connectionData = await api.integrations.google.exchangeCode(messageData.code, redirectUri);
      } catch (e: any) {
        logger.error("Erro ao trocar código por token:", e);
        let errorMessage = translate("ads.sheetDialog.finishError");

        if (e?.message) {
          errorMessage = e.message;
        } else if (typeof e === "string") {
          errorMessage = e;
        } else if (e?.details) {
          errorMessage = String(e.details);
        }

        if (e?.code === "ERR_NETWORK" || e?.code === "ECONNREFUSED" || e?.code === "ENOTFOUND") {
          errorMessage = translate("ads.sheetDialog.network");
        } else if (e?.status === 401) {
          errorMessage = translate("ads.sheetDialog.unauthorized");
        } else if (e?.status === 500) {
          errorMessage = translate("ads.sheetDialog.internalError");
        } else if (e?.status) {
          errorMessage = translate("ads.sheetDialog.serverStatus", { status: e.status, message: errorMessage });
        }

        throw new Error(errorMessage);
      }

      showSuccess(translate("ads.sheetDialog.connected"));

      // Disparar evento de reconexão para retomar jobs pausados
      window.dispatchEvent(
        new CustomEvent("google-connected", {
          detail: { connectionId: connectionData?.connection?.id },
        }),
      );

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

      logger.error("Erro completo na conexão Google:", e);

      if (authError?.code === "AUTH_POPUP_TIMEOUT") {
        showError(new Error(translate("ads.sheetDialog.timeout")));
        return;
      }

      const errorMessage = e?.message || e?.toString() || translate("ads.sheetDialog.unknownError");
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
      const colsWithIndices = res.columnsWithIndices || [];
      const dups = res.duplicates || {};
      const samples = res.sampleRows || [];
      setColumns(loadedColumns);
      setColumnsWithIndices(colsWithIndices);
      setDuplicates(dups);
      setSampleRows(samples);

      if (loadedColumns.length > 0) {
        const guess = guessColumnMappings(loadedColumns);
        const toValue = (name: string | null): string => {
          if (!name) return "";
          if (dups[name]?.length) return `${name}|${dups[name][0]}`;
          return name;
        };
        setAdIdColumn((prev) => prev || toValue(guess.adIdColumn ?? null));
        setDateColumn((prev) => prev || toValue(guess.dateColumn ?? null));
        setLeadscoreColumn((prev) => prev || toValue(guess.leadscoreColumn ?? null));
      } else {
        showError(new Error(translate("ads.sheetDialog.noColumns")));
      }

      return loadedColumns;
    } catch (e: any) {
      showError(e);
      return [];
    } finally {
      setIsLoadingColumns(false);
    }
  };

  const parseColumnValue = (val: string): { name: string; index?: number } => {
    if (!val) return { name: "", index: undefined };
    const i = val.indexOf("|");
    if (i >= 0) {
      const name = val.slice(0, i);
      const idx = parseInt(val.slice(i + 1), 10);
      return { name, index: Number.isNaN(idx) ? undefined : idx };
    }
    return { name: val, index: undefined };
  };

  const handleImport = async () => {
    // `dateFormat` explícito no guard porque ele agora nasce vazio: sem isso o
    // backend recusaria a integração com "formato de data não configurado".
    if (!canImport || isSaving || !dateFormat) return;
    setIsSaving(true);
    try {
      const ad = parseColumnValue(adIdColumn);
      const dt = parseColumnValue(dateColumn);
      const ls = parseColumnValue(leadscoreColumn || "");
      const payload: SheetIntegrationRequest = {
        spreadsheet_id: selectedSpreadsheetId,
        worksheet_title: worksheetTitle,
        ad_id_column: ad.name,
        date_column: dt.name,
        date_format: dateFormat,
        leadscore_column: ls.name,
        ad_id_column_index: ad.index ?? null,
        date_column_index: dt.index ?? null,
        leadscore_column_index: ls.index ?? null,
        pack_id: packId || null,
        connection_id: selectedConnectionId || null,
        // 140: conjunto desejado de colunas adicionais (só quando a lista reflete o servidor)
        column_mappings: extraColumnsReady
          ? extraColumns.map((draft) => ({
              id: draft.serverId ?? null,
              column_index: draft.columnIndex ?? resolveColumnIndex(draft.columnValue, columnsWithIndices) ?? -1,
              column_name: draft.columnValue.includes("|") ? draft.columnValue.slice(0, draft.columnValue.lastIndexOf("|")) : draft.columnValue,
              label: draft.label.trim(),
              kind: (draft.kind || "number") as SheetColumnKind,
              mql_min: draft.kind === "leadscore" ? Number(draft.mqlMin) : null,
            }))
          : null,
      };

      if (isBulk) {
        const { pack_id: _ignored, ...config } = payload;
        const targets = bulkPackIds!.map((id) => packs.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
        const review = reviewBulkSheet(targets, config, mqlAllGoverned ? null : parsedMqlLeadscoreMin, selectedSpreadsheetName);
        if (review.needsConfirm) {
          setPendingBulk({ payload, review });
          return;
        }
        await handleBulkSave(payload);
        return;
      }

      const saveRes = await api.integrations.google.saveSheetIntegration(payload);
      const id = saveRes.integration.id;
      setIntegrationId(id);

      // O corte pertence ao pack, nao a integracao — gravado logo apos, para que
      // o pack ja nasca capaz de qualificar. Falha aqui nao aborta a importacao:
      // os dados entram e o corte pode ser ajustado na configuracao do pack.
      if (packId && parsedMqlLeadscoreMin !== null && !mqlAllGoverned) {
        try {
          await api.analytics.updatePackJudgment(packId, { mql_leadscore_min: parsedMqlLeadscoreMin });
          updatePack(packId, { mql_leadscore_min: parsedMqlLeadscoreMin });
        } catch (e) {
          logger.warn("Falha ao salvar o leadscore mínimo do pack:", e);
        }
      }

      onClose();
      startSyncWithToast({
        integrationId: id,
        title: selectedSpreadsheetName || translate("ads.syncJob.sheet"),
        packId: packId ?? null,
      }).catch((e) => showError(e));
    } catch (e: any) {
      showError(e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleBulkSave = async (payload: SheetIntegrationRequest) => {
    const { pack_id: _ignored, ...config } = payload;
    const res = await api.integrations.google.saveSheetIntegrationsBulk({
      pack_ids: bulkPackIds!,
      config,
      // O corte é exigido para salvar (canImport): vai para todos os packs.
      ...(parsedMqlLeadscoreMin !== null && !mqlAllGoverned ? { mql_leadscore_min: parsedMqlLeadscoreMin } : {}),
    });
    const done = res.results.filter((r) => r.status === "created" || r.status === "updated");
    for (const r of done) {
      const integration = res.integrations[r.pack_id];
      updatePack(r.pack_id, {
        ...(integration ? { sheet_integration: integration } : {}),
        // Pack travado pela pasta recebe a planilha, mas o corte é da pasta (o servidor não o grava).
        ...(parsedMqlLeadscoreMin !== null && !r.mql_skipped ? { mql_leadscore_min: parsedMqlLeadscoreMin } : {}),
      });
    }
    const failed = res.results.filter((r) => r.status === "failed");
    const skipped = res.results.filter((r) => r.status === "skipped");
    const nameOf = (id: string) => packs.find((p) => p.id === id)?.name || translate("ads.bulkSheetSync.packFallback");
    if (failed.length) {
      showError(new Error(translate("ads.sheetDialog.bulkFailed", { list: failed.map((r) => `${nameOf(r.pack_id)} (${r.error})`).join("; ") })));
    }
    if (skipped.length) {
      showError(new Error(translate("ads.sheetDialog.bulkSkipped", { list: skipped.map((r) => nameOf(r.pack_id)).join(", ") })));
    }
    onClose();
    if (done.length === 0) return;
    const packNames = Object.fromEntries(done.map((r) => [r.pack_id, nameOf(r.pack_id)]));
    startBulkSync({
      integrationIds: done.map((r) => r.integration_id).filter((id): id is string => !!id),
      packNames,
      title: translate("ads.sheetDialog.bulkTitle", { name: selectedSpreadsheetName || translate("ads.syncJob.sheet"), count: done.length }),
    }).catch((e) => showError(e));
  };

  const confirmPendingBulk = async () => {
    const payload = pendingBulk?.payload;
    setPendingBulk(null);
    if (!payload) return;
    setIsSaving(true);
    try {
      await handleBulkSave(payload);
    } catch (e: any) {
      showError(e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSyncAgain = async () => {
    if (!integrationId) return;
    try {
      await startSync(integrationId, packId ?? null);
      const stats = lastSyncStats || { updated_rows: 0 };
      showSuccess(translate("ads.sheetDialog.syncedAgain", { rows: stats.updated_rows }));
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
    <AppDialog isOpen={isOpen} onClose={handleClose} title={t("title")} size="xl" padding="lg" closeOnOverlayClick={!isImporting} closeOnEscape={!isImporting} showCloseButton={!isImporting}>
      <div className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <IconTableExport className="w-5 h-5" />
            {t("title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t.rich("description", { b: (c) => <strong>{c}</strong> })}
          </p>
          {bulkPreview && (
            <p className="text-sm text-muted-foreground">
              {t.rich("bulkIntro", { total: bulkPreview.total, b: (c) => <strong className="text-foreground">{c}</strong> })}
              {bulkPreview.toConnect > 0 && <> · {t("bulkToConnect", { count: bulkPreview.toConnect })}</>}
              {bulkPreview.toReplace > 0 && <> · {t("bulkToReplace", { count: bulkPreview.toReplace })}</>}
              {bulkPreview.otherFile > 0 && <> {t("bulkOtherFile", { count: bulkPreview.otherFile })}</>}
              {t("bulkMqlNote")}
            </p>
          )}
        </div>

        {/* Indicador de Steps */}
        <MultiStepBreadcrumb
          steps={[
            {
              id: "connect",
              label: t("stepConnect"),
              description: isGoogleConnected ? (selectedConnectionId ? connections.find((c) => c.id === selectedConnectionId)?.google_name || connections.find((c) => c.id === selectedConnectionId)?.google_email || t("googleAccount") : t("stepConnected")) : undefined,
              status: step !== "connect" ? "completed" : step === "connect" ? "active" : "pending",
            },
            {
              id: "select-sheet",
              label: t("stepSheet"),
              status: step === "select-columns" || step === "summary" ? "completed" : step === "select-sheet" ? "active" : "pending",
              disabled: !isGoogleConnected,
            },
            {
              id: "select-columns",
              label: t("stepColumns"),
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
            {step === "summary" && lastSyncStats ? <SummaryStep stats={lastSyncStats} isImporting={isImporting} onSyncAgain={handleSyncAgain} onClose={handleClose} /> : <SelectColumnsStep columns={columns} columnsWithIndices={columnsWithIndices} duplicates={duplicates} sampleRows={sampleRows} adIdColumn={adIdColumn} dateColumn={dateColumn} dateFormat={dateFormat} dateProbe={dateProbe} isProbingDate={isProbingDate} dateProbeFailed={dateProbeFailed} packDateStart={packWindow.start} packDateStop={packWindow.stop} leadscoreColumn={leadscoreColumn} mqlLeadscoreMin={mqlLeadscoreMin} isSaving={isSaving} isImporting={isImporting} importStep={importStep} importProgress={importProgress} canImport={canImport} onAdIdColumnChange={setAdIdColumn} onDateColumnChange={setDateColumn} onDateFormatChange={setDateFormat} onLeadscoreColumnChange={setLeadscoreColumn} onMqlLeadscoreMinChange={setMqlLeadscoreMin} mqlLockNote={mqlLockNote} mqlLocked={mqlAllGoverned} extraColumns={extraColumns} onExtraColumnsChange={setExtraColumns} onBack={() => setStep("select-sheet")} onImport={handleImport} />}
          </section>
        )}
      </div>
      <BulkApplyReviewDialog
        review={pendingBulk?.review ?? null}
        packCount={bulkPackIds?.length ?? 0}
        onCancel={() => setPendingBulk(null)}
        onConfirm={() => void confirmPendingBulk()}
      />
    </AppDialog>
  );
}
