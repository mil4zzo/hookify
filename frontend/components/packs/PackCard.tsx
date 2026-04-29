"use client";

import React, { useState, useRef, useEffect } from "react";
import { StandardCard } from "@/components/common/StandardCard";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { IconFilter, IconTrash, IconLoader2, IconRotateClockwise, IconPencil, IconTableExport, IconAlertTriangle, IconAlertCircle, IconMicrophone } from "@tabler/icons-react";
import { MetaIcon, GoogleSheetsIcon } from "@/components/icons";
import { FilterRule } from "@/lib/api/schemas";
import { AdsPack } from "@/lib/types";
import { api } from "@/lib/api/endpoints";
import { showSuccess, showError } from "@/lib/utils/toast";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { getTodayLocal } from "@/lib/utils/dateFilters";
import { UpdatedAtText } from "@/components/common/UpdatedAtText";

const FILTER_FIELDS = [
  { label: "Campaign Name", value: "campaign.name" },
  { label: "Adset Name", value: "adset.name" },
  { label: "Ad Name", value: "ad.name" },
];

const getFilterFieldLabel = (fieldValue: string) => {
  const field = FILTER_FIELDS.find((f) => f.value === fieldValue);
  return field ? field.label : fieldValue;
};

export interface PackCardProps {
  pack: AdsPack;
  formatCurrency: (value: number) => string;
  formatDate: (dateString: string) => string;
  // Handlers
  onRefresh: (packId: string) => void;
  onRemove: (packId: string) => void;
  onToggleAutoRefresh: (packId: string, checked: boolean) => void;
  onSetSheetIntegration: (pack: AdsPack) => void;
  onEditSheetIntegration?: (pack: AdsPack) => void;
  onDeleteSheetIntegration?: (pack: AdsPack) => void;
  /** Inicia apenas a transcrição dos vídeos do pack (sem refresh). Útil para testes. */
  onTranscribeAds?: (packId: string, packName: string) => void;
  // Estados de loading
  isUpdating: boolean;
  isTogglingAutoRefresh: string | null;
  packToDisableAutoRefresh: { id: string; name: string } | null;
}

/**
 * Componente de card para exibir informações de um pack de anúncios.
 *
 * Estrutura organizada conforme design:
 * - Nome do pack (com menu dropdown)
 * - Date range (com ícone de calendário e seta →)
 * - Filtros (formato: ícone + campo + operador + valor)
 * - Métricas: Campanhas, Adsets, Anúncios (grid de 3 colunas)
 * - Footer: Última atualização (esquerda) + Atualização automática (direita)
 */
export function PackCard({ pack, formatCurrency, formatDate, onRefresh, onRemove, onToggleAutoRefresh, onSetSheetIntegration, onEditSheetIntegration, onDeleteSheetIntegration, onTranscribeAds, isUpdating, isTogglingAutoRefresh, packToDisableAutoRefresh }: PackCardProps) {
  const stats = pack.stats;
  const { updatePack, packs } = useClientPacks();
  const [isEditingName, setIsEditingName] = useState(false);
  const [editingName, setEditingName] = useState(pack.name);
  const [isSavingName, setIsSavingName] = useState(false);
  const [hasNameError, setHasNameError] = useState(false);
  const nameInputRef = useRef<HTMLTextAreaElement>(null);
  const isSavingNameRef = useRef(false);

  const resizeNameTextarea = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    // Auto-resize para caber o conteúdo sem empurrar o layout com scroll interno
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  };

  // Focar no input quando começar a editar
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      // Colocar o cursor no final do texto em vez de selecionar tudo
      // Isso permite que o usuário clique em qualquer posição para editar parcialmente
      const length = nameInputRef.current.value.length;
      nameInputRef.current.setSelectionRange(length, length);
      resizeNameTextarea(nameInputRef.current);
    }
  }, [isEditingName]);

  const handleStartEditName = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation(); // Prevenir que o dropdown abra
    e.preventDefault(); // Prevenir comportamento padrão
    setIsEditingName(true);
    setEditingName(pack.name);
    setHasNameError(false); // Resetar erro ao iniciar edição
  };

  const handleNamePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation(); // Prevenir que o dropdown abra no pointerdown
    e.preventDefault(); // Prevenir comportamento padrão
  };

  const handleCancelEditName = () => {
    setIsEditingName(false);
    setEditingName(pack.name);
    setHasNameError(false); // Resetar erro ao cancelar
  };

  // Verificar se o nome é único em tempo real
  const checkNameUniqueness = (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName === pack.name) {
      setHasNameError(false);
      return true;
    }

    const existingPack = packs.find((p) => p.id !== pack.id && p.name.trim().toLowerCase() === trimmedName.toLowerCase());
    const isUnique = !existingPack;
    setHasNameError(!isUnique);
    return isUnique;
  };

  const handleSaveName = async () => {
    if (isSavingNameRef.current) return;

    const trimmedName = editingName.trim();

    if (!trimmedName) {
      showError({ message: "Nome do pack não pode ser vazio" });
      setEditingName(pack.name);
      setIsEditingName(false);
      return;
    }

    if (trimmedName === pack.name) {
      // Nome não mudou
      setIsEditingName(false);
      return;
    }

    // Verificar se já existe outro pack com o mesmo nome
    const isUnique = checkNameUniqueness(trimmedName);
    if (!isUnique) {
      showError({ message: `Já existe um pack com o nome "${trimmedName}"` });
      // Manter o input aberto com borda vermelha (não fechar)
      return;
    }

    isSavingNameRef.current = true;
    setIsSavingName(true);

    // Guardar nome anterior para reverter em caso de erro
    const previousName = pack.name;

    // Atualizar estado local imediatamente (optimistic update)
    updatePack(pack.id, {
      name: trimmedName,
    } as Partial<AdsPack>);

    try {
      await api.analytics.updatePackName(pack.id, trimmedName);
      showSuccess(`Pack renomeado para "${trimmedName}"`);
      // Sair do modo de edição apenas após sucesso
      setIsEditingName(false);
      setHasNameError(false); // Resetar erro ao salvar com sucesso
    } catch (error) {
      console.error("Erro ao renomear pack:", error);
      // REVERTER em caso de erro
      updatePack(pack.id, {
        name: previousName,
      } as Partial<AdsPack>);
      setEditingName(previousName);
      // Verificar se o erro é de nome duplicado
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes("já existe") || errorMessage.includes("already exists")) {
        setHasNameError(true);
        // Manter o input aberto (já está aberto)
      } else {
        // Para outros erros, também manter aberto
        setIsEditingName(true);
        setHasNameError(false);
      }
      showError({ message: `Erro ao renomear pack: ${errorMessage}` });
    } finally {
      setIsSavingName(false);
      isSavingNameRef.current = false;
    }
  };

  const handleInputBlur = () => {
    handleSaveName();
  };

  const handleNameKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveName();
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleCancelEditName();
    }
  };

  // Calcular duração em dias
  const calculateDays = (start: string, end: string): number => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays + 1; // +1 para incluir o dia final
  };

  // Verificar se a data final é hoje (usando comparação de strings para evitar problemas de fuso horário)
  const isToday = (dateString: string): boolean => {
    const today = getTodayLocal(); // Retorna "YYYY-MM-DD" no fuso local
    return dateString === today;
  };

  const daysCount = calculateDays(pack.date_start, pack.date_stop);
  const isSameDate = pack.date_start === pack.date_stop;
  const dateStartDisplay = isToday(pack.date_start) ? "HOJE" : formatDate(pack.date_start);
  const dateEndDisplay = isToday(pack.date_stop) ? "HOJE" : formatDate(pack.date_stop);
  const dateRangeDisplay = isSameDate ? dateStartDisplay : `${formatDate(pack.date_start)} → ${dateEndDisplay}`;
  const lastSuccessfulSyncAt = pack.sheet_integration?.last_successful_sync_at;
  const lastSyncAttemptAt = pack.sheet_integration?.last_synced_at;
  const leadscoreSyncFailed = pack.sheet_integration?.last_sync_status === "failed";
  const hasAnyLeadscoreSyncInfo = !!(lastSuccessfulSyncAt || lastSyncAttemptAt);
  const leadscoreDateForDisplay = leadscoreSyncFailed ? (lastSuccessfulSyncAt || "") : (lastSuccessfulSyncAt || lastSyncAttemptAt || "");

  return (
    <div className="relative inline-block w-full">
      {/* Cards decorativos atrás */}
      <div className="absolute inset-0 rounded-md bg-card rotate-2 pointer-events-none" />
      <div className="absolute inset-0 rounded-md bg-secondary rotate-1 pointer-events-none" />

      <DropdownMenu open={isEditingName ? false : undefined}>
        <DropdownMenuTrigger asChild disabled={isEditingName}>
          <StandardCard variant="default" padding="none" interactive={!isEditingName} className="relative flex flex-col cursor-pointer hover:opacity-90 transition-opacity z-10 w-full overflow-hidden">
            {/* Feedback visual de atualização */}
            {isUpdating && (
              <>
                {/* Overlay sutil com animação */}
                <div className="absolute inset-0 bg-primary-10 rounded-md pointer-events-none z-[15] animate-pulse" />

                {/* Borda animada */}
                <div className="absolute inset-0 rounded-md border-2 border-primary pointer-events-none z-[16] animate-pulse" />

                {/* Badge no topo direito */}
                <div className="absolute top-3 right-3 bg-primary text-primary-foreground px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 z-[20] shadow-lg">
                  <IconLoader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Atualizando...</span>
                </div>
              </>
            )}
            <div className="p-6 space-y-6 flex flex-col justify-between h-full relative z-10">
              <div className="flex flex-col items-center gap-2">
                {/* Header: Nome do pack */}
                <div className="flex items-start justify-center">
                  <div className="flex flex-col items-center justify-center min-w-0">
                    {isEditingName ? (
                      <div className="inline-flex items-center gap-2 relative z-20 max-w-full" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                        <textarea
                          ref={nameInputRef}
                          value={editingName}
                          onChange={(e) => {
                            setEditingName(e.target.value);
                            resizeNameTextarea(e.currentTarget);
                            // Validar em tempo real se o nome é único
                            checkNameUniqueness(e.target.value);
                          }}
                          onKeyDown={handleNameKeyDown}
                          onBlur={handleInputBlur}
                          disabled={isSavingName}
                          rows={1}
                          // `textarea` permite quebra de linha (ao contrário de `input`), evitando overflow e deslocamento do card.
                          // `fit-content` + `maxWidth: 100%` faz a borda acompanhar o conteúdo até o limite do card.
                          className={`text-xl font-semibold leading-tight px-0 text-center bg-transparent border-0 border-b-2 rounded-none outline-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 resize-none overflow-hidden max-w-full break-words [overflow-wrap:anywhere] transition-colors ${hasNameError ? "border-destructive" : "border-primary-foreground"}`}
                          style={{ width: "fit-content", maxWidth: "100%" }}
                          maxLength={100}
                          onClick={(e) => e.stopPropagation()}
                          onPointerDown={(e) => e.stopPropagation()}
                        />
                      </div>
                    ) : (
                      <div
                        className="relative z-20"
                        onClick={handleStartEditName}
                        onPointerDown={handleNamePointerDown}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                        }}
                      >
                        <h3 className="text-xl font-semibold cursor-text text-center whitespace-normal break-words [overflow-wrap:anywhere] leading-tight" title={`Clique para editar: ${pack.name}`}>
                          {pack.name}
                        </h3>
                      </div>
                    )}
                  </div>
                </div>
                {/* Filtros */}
                {pack.filters && pack.filters.length > 0 && (
                  <div className="flex justify-center flex-wrap gap-2">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-default">
                            <IconFilter className="w-3.5 h-3.5 flex-shrink-0" />
                            <span className="font-medium text-muted-foreground">
                              Ver {pack.filters.length} {pack.filters.length === 1 ? "filtro" : "filtros"}
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs">
                          <div className="flex flex-col gap-1">
                            {pack.filters.map((filter: FilterRule, index: number) => (
                              <div key={index} className="flex items-center gap-1.5 text-xs">
                                <span className="font-medium">{getFilterFieldLabel(filter.field)}</span>
                                <span className="opacity-60">{filter.operator.toLowerCase().replace("_", " ")}</span>
                                <span className="font-medium">"{filter.value}"</span>
                              </div>
                            ))}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                )}
              </div>

              <div className="flex flex-col items-center gap-2">
                <div className="flex flex-col items-center">
                  {/* Date range */}
                  <div className="flex items-center text-sm gap-1.5">
                    <span>{dateRangeDisplay}</span>
                    {pack.auto_refresh && !isToday(pack.date_stop) && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className="relative z-20"
                              onClick={(e) => {
                                e.stopPropagation();
                              }}
                              onPointerDown={(e) => {
                                e.stopPropagation();
                              }}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                              }}
                            >
                              <IconAlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />
                            </div>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Os dados podem estar desatualizados. Atualize para garantir uma análise atual.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  {/* Duração */}
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {daysCount} {daysCount === 1 ? "dia" : "dias"}
                  </div>
                </div>
                {/* Valor monetário em destaque */}
                {(() => {
                  const formatted = formatCurrency(stats?.totalSpend || 0);
                  // Extrair símbolo e número (ex: "R$ 477.518,24" -> "R$" e "477.518,24")
                  const parts = formatted.split(/\s+/);
                  const symbol = parts[0] || "R$";
                  const number = parts.slice(1).join(" ") || formatted.replace(/[^\d,.]/g, "");
                  return (
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-sm text-muted-foreground">{symbol}</span>
                      <span className="text-3xl font-bold text-success">{number}</span>
                    </div>
                  );
                })()}
              </div>

              {/* Métricas: Lista vertical com separadores */}
              <div className="flex flex-col">
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-sm text-foreground">Campanhas</span>
                  <span className="text-sm font-medium text-foreground">{stats?.uniqueCampaigns || 0}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-sm text-foreground">Conjuntos</span>
                  <span className="text-sm font-medium text-foreground">{stats?.uniqueAdsets || 0}</span>
                </div>
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-sm text-foreground">Anúncios</span>
                  <span className="text-sm font-medium text-foreground">{stats?.uniqueAdNames || 0}</span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-foreground">Variações</span>
                  <span className="text-sm font-medium text-foreground">{stats?.uniqueAds || 0}</span>
                </div>
              </div>

              {/* Footer: Toggles com ícone e timestamp integrados */}
              <div className="flex flex-col gap-2">
                {/* Manter atualizado */}
                <div
                  className="relative z-20"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center px-3 py-2 bg-muted border border-border rounded-md gap-2 w-full justify-between">
                    <div className="flex gap-2">
                      <div className="flex items-center gap-2">
                        <MetaIcon className="w-4 h-4 flex-shrink-0" />
                      </div>
                      <div className="flex flex-col">
                        <label htmlFor={`auto-refresh-${pack.id}`} className="font-medium text-sm text-foreground cursor-pointer">
                          Manter atualizado
                        </label>
                        <UpdatedAtText dateTime={pack.updated_at} className="text-[10px] text-muted-foreground" />
                      </div>
                    </div>
                    <Switch
                      id={`auto-refresh-${pack.id}`}
                      checked={pack.auto_refresh || false}
                      onCheckedChange={(checked) => onToggleAutoRefresh(pack.id, checked)}
                      disabled={isTogglingAutoRefresh === pack.id || packToDisableAutoRefresh?.id === pack.id}
                      className="data-[state=checked]:bg-success"
                    />
                  </div>
                </div>

                {/* Leadscore */}
                <div
                  className="relative z-20"
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center px-3 py-2 bg-muted border border-border rounded-md gap-2 w-full justify-between">
                    <div className="flex gap-2">
                      <div className="flex items-center gap-2">
                        <GoogleSheetsIcon className="w-3.5 h-3.5 flex-shrink-0" />
                      </div>
                      <div className="flex flex-col">
                        <label htmlFor={`leadscore-${pack.id}`} className="font-medium text-sm text-foreground cursor-pointer">
                          Leadscore
                        </label>
                        {!pack.sheet_integration ? (
                          <span className="text-[10px] text-muted-foreground">Não conectado</span>
                        ) : hasAnyLeadscoreSyncInfo ? (
                          <div className="flex items-center gap-1">
                            {leadscoreSyncFailed && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <IconAlertCircle className="w-3 h-3 text-warning flex-shrink-0 cursor-help" />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>
                                      {lastSuccessfulSyncAt
                                        ? "A última tentativa de sincronização falhou. A data mostrada é da última sincronização bem-sucedida."
                                        : "A última tentativa de sincronização falhou e ainda não há sincronização bem-sucedida para este pack."}
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                            {leadscoreDateForDisplay ? (
                              <UpdatedAtText dateTime={leadscoreDateForDisplay} className="text-[10px] text-muted-foreground" />
                            ) : (
                              <span className="text-[10px] text-muted-foreground">Sem sync bem-sucedido</span>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <Switch
                      id={`leadscore-${pack.id}`}
                      checked={!!pack.sheet_integration}
                      onCheckedChange={(checked) => {
                        if (checked && !pack.sheet_integration) {
                          onSetSheetIntegration(pack);
                        }
                      }}
                      disabled={!!pack.sheet_integration}
                      className="data-[state=checked]:bg-success"
                    />
                  </div>
                </div>
              </div>
            </div>
          </StandardCard>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right">
          <DropdownMenuItem onClick={() => onRefresh(pack.id)} disabled={isUpdating}>
            <IconRotateClockwise className="w-4 h-4 mr-2" />
            Atualizar pack
          </DropdownMenuItem>
          {onTranscribeAds && (
            <DropdownMenuItem onClick={() => onTranscribeAds(pack.id, pack.name)} disabled={isUpdating}>
              <IconMicrophone className="w-4 h-4 mr-2" />
              Transcrever anúncios
            </DropdownMenuItem>
          )}
          {pack.sheet_integration ? (
            <>
              <DropdownMenuItem disabled className="opacity-100">
                <IconTableExport className="w-4 h-4 mr-2 text-success" />
                <div className="flex flex-col items-start">
                  <span className="text-xs font-medium text-success">Planilha conectada</span>
                  <span className="text-xs text-muted-foreground">
                    {pack.sheet_integration.spreadsheet_name || "Planilha"} • {pack.sheet_integration.worksheet_title || "Aba"}
                  </span>
                </div>
              </DropdownMenuItem>
              {onEditSheetIntegration && (
                <DropdownMenuItem onClick={() => onEditSheetIntegration(pack)}>
                  <IconPencil className="w-4 h-4 mr-2" />
                  Editar integração
                </DropdownMenuItem>
              )}
              {onDeleteSheetIntegration && (
                <DropdownMenuItem onClick={() => onDeleteSheetIntegration(pack)} className="text-destructive focus:text-destructive focus:bg-destructive-10">
                  <IconTrash className="w-4 h-4 mr-2" />
                  Remover integração
                </DropdownMenuItem>
              )}
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onRemove(pack.id)} className="text-destructive focus:text-destructive focus:bg-destructive-10">
            <IconTrash className="w-4 h-4 mr-2" />
            Remover pack
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
