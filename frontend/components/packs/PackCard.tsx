"use client";

import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { StandardCard } from "@/components/common/StandardCard";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { IconFilter, IconTrash, IconLoader2, IconRotateClockwise, IconPencil, IconTableExport, IconAlertTriangle } from "@tabler/icons-react";
import { FilterRule } from "@/lib/api/schemas";
import { AdsPack } from "@/lib/types";
import { api } from "@/lib/api/endpoints";
import { showSuccess, showError } from "@/lib/utils/toast";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { getTodayLocal } from "@/lib/utils/dateFilters";

const FILTER_FIELDS = [
  { label: "Campaign Name", value: "campaign.name" },
  { label: "Adset Name", value: "adset.name" },
  { label: "Ad Name", value: "ad.name" },
];

export interface PackCardProps {
  pack: AdsPack;
  formatCurrency: (value: number) => string;
  formatDate: (dateString: string) => string;
  formatDateTime: (dateTimeString: string) => string;
  getAccountName: (accountId: string) => string;
  // Handlers
  onRefresh: (packId: string) => void;
  onRemove: (packId: string) => void;
  onToggleAutoRefresh: (packId: string, checked: boolean) => void;
  onSyncSheetIntegration: (packId: string) => void;
  onSetSheetIntegration: (pack: AdsPack) => void;
  onEditSheetIntegration?: (pack: AdsPack) => void;
  onDeleteSheetIntegration?: (pack: AdsPack) => void;
  // Estados de loading
  isUpdating: boolean;
  isTogglingAutoRefresh: string | null;
  packToDisableAutoRefresh: { id: string; name: string } | null;
  isSyncingSheetIntegration: string | null;
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
export function PackCard({ pack, formatCurrency, formatDate, formatDateTime, getAccountName, onRefresh, onRemove, onToggleAutoRefresh, onSyncSheetIntegration, onSetSheetIntegration, onEditSheetIntegration, onDeleteSheetIntegration, isUpdating, isTogglingAutoRefresh, packToDisableAutoRefresh, isSyncingSheetIntegration }: PackCardProps) {
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

  const getFilterFieldLabel = (fieldValue: string) => {
    const field = FILTER_FIELDS.find((f) => f.value === fieldValue);
    return field ? field.label : fieldValue;
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
  const dateEndDisplay = isToday(pack.date_stop) ? "HOJE" : formatDate(pack.date_stop);

  return (
    <div className="relative inline-block w-full">
      {/* Cards decorativos atrás */}
      <div className="absolute inset-0 rounded-xl bg-card rotate-2 pointer-events-none" />
      <div className="absolute inset-0 rounded-xl bg-secondary rotate-1 pointer-events-none" />

      <DropdownMenu open={isEditingName ? false : undefined}>
        <DropdownMenuTrigger asChild disabled={isEditingName}>
          <StandardCard variant="default" padding="none" interactive={!isEditingName} className="relative flex flex-col cursor-pointer hover:opacity-90 transition-opacity z-10 w-full overflow-hidden">
            {/* Feedback visual de atualização */}
            {isUpdating && (
              <>
                {/* Overlay sutil com animação */}
                <div className="absolute inset-0 bg-primary/10 rounded-xl pointer-events-none z-[15] animate-pulse" />

                {/* Borda animada */}
                <div className="absolute inset-0 rounded-xl border-2 border-primary pointer-events-none z-[16] animate-pulse" />

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
                          className={`text-xl font-semibold leading-tight px-0 text-center bg-transparent border-0 border-b-2 rounded-none outline-none focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 resize-none overflow-hidden max-w-full break-words [overflow-wrap:anywhere] transition-colors ${hasNameError ? "border-red-500" : "border-white"}`}
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
                  <div className="flex justify-start flex-wrap gap-2">
                    {pack.filters.map((filter: FilterRule, index: number) => (
                      <div key={index} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                        <IconFilter className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="font-medium text-foreground/80">{getFilterFieldLabel(filter.field)}</span>
                        <span className="opacity-60">{filter.operator.toLowerCase().replace("_", " ")}</span>
                        <span className="font-medium text-foreground/80">"{filter.value}"</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col items-center gap-2">
                <div className="flex flex-col items-center">
                  {/* Date range */}
                  <div className="flex items-center text-sm gap-1.5">
                    <span>
                      {formatDate(pack.date_start)} → {dateEndDisplay}
                    </span>
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
                              <IconAlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
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
                      <span className="text-3xl font-bold text-green-500">{number}</span>
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
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-foreground">Anúncios</span>
                  <span className="text-sm font-medium text-foreground">{stats?.uniqueAds || 0}</span>
                </div>
              </div>

              {/* Footer: Toggles e última atualização */}
              <div className="flex flex-col gap-2">
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
                  <ToggleSwitch id={`auto-refresh-${pack.id}`} checked={pack.auto_refresh || false} onCheckedChange={(checked) => onToggleAutoRefresh(pack.id, checked)} disabled={isTogglingAutoRefresh === pack.id || packToDisableAutoRefresh?.id === pack.id} labelLeft="Atualização automática:" variant="default" size="md" className="w-full justify-between" labelClassName="text-sm text-foreground" switchClassName="data-[state=checked]:bg-green-500" />
                </div>
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
                  <ToggleSwitch
                    id={`leadscore-${pack.id}`}
                    checked={!!pack.sheet_integration}
                    onCheckedChange={(checked) => {
                      if (checked && !pack.sheet_integration) {
                        onSetSheetIntegration(pack);
                      }
                    }}
                    disabled={!!pack.sheet_integration}
                    labelLeft="Leadscore"
                    variant="default"
                    size="md"
                    className="w-full justify-between"
                    labelClassName="text-sm text-foreground"
                    switchClassName="data-[state=checked]:bg-green-500"
                  />
                </div>
                <div className="flex items-center justify-between mt-3 text-xs text-foreground">
                  <span>Última atualização:</span>
                  <span>{formatDateTime(pack.updated_at)}</span>
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
          {pack.sheet_integration ? (
            <>
              <DropdownMenuItem disabled className="opacity-100">
                <IconTableExport className="w-4 h-4 mr-2 text-green-500" />
                <div className="flex flex-col items-start">
                  <span className="text-xs font-medium text-green-500">Planilha conectada</span>
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
                <DropdownMenuItem onClick={() => onDeleteSheetIntegration(pack)} className="text-red-500 focus:text-red-500 focus:bg-red-500/10">
                  <IconTrash className="w-4 h-4 mr-2" />
                  Remover integração
                </DropdownMenuItem>
              )}
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onRemove(pack.id)} className="text-red-500 focus:text-red-500 focus:bg-red-500/10">
            <IconTrash className="w-4 h-4 mr-2" />
            Remover pack
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
