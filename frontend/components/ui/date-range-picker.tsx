"use client";

import * as React from "react";
import { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon } from "lucide-react";
import { DateRange } from "react-day-picker";

import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Modal } from "@/components/common/Modal";
import { FilterSelectButton } from "@/components/common/FilterSelectButton";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";

export interface DateRangePickerProps {
  date?: DateRange;
  onDateChange?: (date: DateRange | undefined) => void;
  className?: string;
  placeholder?: string;
  label?: string;
  showLabel?: boolean; // Se true, mostra a label (padrão: false)
  disabled?: boolean;
  useModal?: boolean; // Se true, abre um modal ao invés de popover
  disableFutureDates?: boolean; // Se true, desabilita datas posteriores a hoje
  requireConfirmation?: boolean; // Se true, requer confirmação antes de aplicar (mostra botão "Aplicar")
  usePackDates?: boolean; // Se true, usa datas dos packs (desabilita seleção manual)
  onUsePackDatesChange?: (checked: boolean) => void; // Handler para mudança do switch
  showPackDatesSwitch?: boolean; // Se true, mostra o switch "Usar datas dos packs" dentro do popup
  packDatesRange?: DateRange; // Datas dos packs para selecionar no calendário quando switch for ativado
}

export function DateRangePicker({ date, onDateChange, className, placeholder = "Selecione um período", label, showLabel = false, disabled, useModal = false, disableFutureDates = false, requireConfirmation = false, usePackDates = false, onUsePackDatesChange, showPackDatesSwitch = false, packDatesRange }: DateRangePickerProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>(date);
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [tempDateRangePopover, setTempDateRangePopover] = useState<DateRange | undefined>(date);
  const [isMobile, setIsMobile] = useState(false);

  // Função para obter a data de hoje sem hora (para comparação correta)
  const getTodayWithoutTime = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  };

  // Função para obter o valor padrão (hoje - 2 dias até hoje)
  const getDefaultDateRange = (): DateRange => {
    const today = getTodayWithoutTime();
    const twoDaysAgo = new Date(today);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    twoDaysAgo.setHours(0, 0, 0, 0);
    return {
      from: twoDaysAgo,
      to: today,
    };
  };

  // Função para desabilitar datas futuras
  const getDisabledDates = () => {
    if (!disableFutureDates) return undefined;
    const today = getTodayWithoutTime();
    return {
      after: today, // Desabilita datas após hoje (não inclui hoje)
    };
  };

  // Função para calcular o mês padrão do calendário
  const getDefaultMonth = (useTempDate: boolean = false) => {
    if (disableFutureDates) {
      const today = getTodayWithoutTime();
      // Se for mobile (1 mês), mostra o mês atual
      // Se for desktop (2 meses), mostra o mês anterior (para que o da direita seja o atual)
      if (isMobile) {
        return today;
      } else {
        // Calcular mês anterior
        const previousMonth = new Date(today);
        previousMonth.setMonth(previousMonth.getMonth() - 1);
        return previousMonth;
      }
    }
    // Caso contrário, usar a data selecionada ou mês atual
    if (useTempDate) {
      return tempDateRange?.from || new Date();
    }
    return date?.from || new Date();
  };

  // Detectar se é mobile para ajustar número de meses
  React.useEffect(() => {
    const checkMobile = () => {
      setIsMobile(typeof window !== "undefined" && window.innerWidth < 640);
    };
    if (typeof window !== "undefined") {
      checkMobile();
      window.addEventListener("resize", checkMobile);
      return () => window.removeEventListener("resize", checkMobile);
    }
  }, []);

  // Inicializar com valor padrão se date não for fornecido
  React.useEffect(() => {
    if (!date && onDateChange) {
      const defaultRange = getDefaultDateRange();
      onDateChange(defaultRange);
    }
  }, []); // Executa apenas na montagem

  // Atualizar tempDateRange quando date muda externamente (mas modal não está aberto)
  // Não atualizar se usePackDates estiver ativo, pois as datas dos packs têm prioridade
  React.useEffect(() => {
    if (!isModalOpen && !usePackDates) {
      setTempDateRange(date || getDefaultDateRange());
    }
  }, [date, isModalOpen, usePackDates]);

  // Atualizar tempDateRangePopover quando date muda externamente (mas popover não está aberto)
  // Não atualizar se usePackDates estiver ativo, pois as datas dos packs têm prioridade
  React.useEffect(() => {
    if (!isPopoverOpen && !usePackDates) {
      setTempDateRangePopover(date || getDefaultDateRange());
    }
  }, [date, isPopoverOpen, usePackDates]);

  // Quando usePackDates for ativado e packDatesRange existir, atualizar tempDateRange apenas no calendário
  // (sem aplicar as datas - aguarda confirmação do usuário)
  // Isso permite que o usuário veja quais datas serão aplicadas quando clicar em "Aplicar"
  React.useEffect(() => {
    if (usePackDates && packDatesRange && packDatesRange.from) {
      // Sempre atualizar tempDateRange e tempDateRangePopover com as datas dos packs quando switch está ativo
      setTempDateRange(packDatesRange);
      setTempDateRangePopover(packDatesRange);
    } else if (!usePackDates) {
      // Quando o switch é desativado, resetar para o valor atual (date)
      setTempDateRange(date || getDefaultDateRange());
      setTempDateRangePopover(date || getDefaultDateRange());
    }
  }, [usePackDates, packDatesRange, date]);

  const handleModalOpen = () => {
    // Quando abre modal, inicializar com datas dos packs se usePackDates estiver ativo, senão usar valor atual
    if (usePackDates && packDatesRange && packDatesRange.from) {
      setTempDateRange(packDatesRange);
    } else {
      setTempDateRange(date || getDefaultDateRange());
    }
    setIsModalOpen(true);
  };

  const handleConfirm = () => {
    onDateChange?.(tempDateRange);
    setIsModalOpen(false);
  };

  const handleCancel = () => {
    setTempDateRange(date); // Reset para o valor original
    setIsModalOpen(false);
  };

  const handlePopoverOpenChange = (open: boolean) => {
    setIsPopoverOpen(open);
    if (!open) {
      // Se o popover está fechando e não foi confirmado, resetar para o valor original
      // Se usePackDates estiver ativo, resetar para packDatesRange, senão para date
      if (usePackDates && packDatesRange && packDatesRange.from) {
        setTempDateRangePopover(packDatesRange);
      } else {
        setTempDateRangePopover(date || getDefaultDateRange());
      }
    } else {
      // Quando abre, inicializar com datas dos packs se usePackDates estiver ativo, senão usar valor atual
      // O useEffect já atualiza tempDateRangePopover quando packDatesRange muda, mas garantimos aqui também
      if (usePackDates && packDatesRange && packDatesRange.from) {
        setTempDateRangePopover(packDatesRange);
      } else {
        setTempDateRangePopover(date || getDefaultDateRange());
      }
    }
  };

  const handlePopoverConfirm = () => {
    onDateChange?.(tempDateRangePopover);
    setIsPopoverOpen(false);
  };

  const handlePopoverCancel = () => {
    setTempDateRangePopover(date || getDefaultDateRange()); // Reset para o valor original
    setIsPopoverOpen(false);
  };

  // Função para verificar se uma data é hoje (considerando apenas a data, não a hora)
  const isToday = (dateToCheck: Date): boolean => {
    const today = new Date();
    return dateToCheck.getDate() === today.getDate() && dateToCheck.getMonth() === today.getMonth() && dateToCheck.getFullYear() === today.getFullYear();
  };

  // Função para verificar se duas datas são o mesmo dia
  const isSameDay = (date1: Date, date2: Date): boolean => {
    return date1.getDate() === date2.getDate() && date1.getMonth() === date2.getMonth() && date1.getFullYear() === date2.getFullYear();
  };

  // Função para formatar data ou mostrar "Hoje"
  const formatDateOrToday = (dateToFormat: Date): string => {
    if (isToday(dateToFormat)) {
      return "Hoje";
    }
    return format(dateToFormat, "dd/MM/yyyy", { locale: ptBR });
  };

  // Usar date ou valor padrão
  const currentDateRange = date || getDefaultDateRange();

  // Verificar se está carregando datas dos packs
  const isLoadingPackDates = usePackDates && (!packDatesRange || !packDatesRange.from);
  
  // Desabilitar o botão se disabled for true ou se estiver carregando datas dos packs
  const isButtonDisabled = disabled || isLoadingPackDates;

  const buttonContent = (
    <FilterSelectButton
      id="date"
      type="button"
      disabled={isButtonDisabled}
      onClick={useModal ? handleModalOpen : undefined}
      iconPosition="start"
      icon={<CalendarIcon className="mr-2 h-4 w-4 flex-shrink-0" />}
      className={cn(
        "justify-start text-left font-normal",
        "h-10",
        !currentDateRange?.from && "text-muted-foreground"
      )}
    >
      {isLoadingPackDates ? (
        <span className="text-muted-foreground flex items-center gap-2">
          <Skeleton className="h-4 w-24" />
        </span>
      ) : currentDateRange?.from ? (
        currentDateRange.to ? (
          // Se início e fim são o mesmo dia, mostrar apenas uma data
          isSameDay(currentDateRange.from, currentDateRange.to) ? (
            formatDateOrToday(currentDateRange.from)
          ) : (
            <>
              {formatDateOrToday(currentDateRange.from)} → {formatDateOrToday(currentDateRange.to)}
            </>
          )
        ) : (
          formatDateOrToday(currentDateRange.from)
        )
      ) : (
        <span className="text-muted-foreground">{placeholder}</span>
      )}
    </FilterSelectButton>
  );

  // Função para desabilitar datas quando usePackDates estiver ativo
  const getDisabledDatesWithPackDates = () => {
    const baseDisabled = getDisabledDates();
    if (usePackDates) {
      // Desabilitar todas as datas quando usePackDates estiver ativo
      // Retornar um objeto que desabilita todas as datas (antes de 0 e depois de 9999)
      return {
        before: new Date(0),
        after: new Date(9999, 11, 31),
      };
    }
    return baseDisabled;
  };

  if (useModal) {
    return (
      <>
        <div className={cn("space-y-2", className)}>
          {showLabel && label && <label className="text-sm font-medium">{label}</label>}
          {buttonContent}
        </div>

        <Modal isOpen={isModalOpen} onClose={handleCancel} size="full" padding="lg" className="!max-w-[95vw] sm:!max-w-[min(95vw,45rem)] md:!max-w-[min(95vw,48rem)]">
          <div className="space-y-4 sm:space-y-6 w-full">
            <div className="space-y-1 sm:space-y-2">
              <h2 className="text-lg sm:text-xl md:text-2xl font-semibold text-foreground">Selecionar Período</h2>
              <p className="text-sm sm:text-base text-muted-foreground">Escolha a data de início e fim do período</p>
            </div>

            {showPackDatesSwitch && onUsePackDatesChange && (
              <div className="flex items-center gap-2 p-3 bg-card border border-border rounded-md">
                <Switch
                  id="use-pack-dates-modal"
                  checked={usePackDates}
                  onCheckedChange={onUsePackDatesChange}
                />
                <label
                  htmlFor="use-pack-dates-modal"
                  className="text-sm font-medium cursor-pointer"
                >
                  Usar datas dos packs
                </label>
              </div>
            )}

            <div className="flex justify-center w-full min-w-0 overflow-x-auto pb-2">
              <div className={cn("w-fit min-w-0 mx-auto", usePackDates && "opacity-50 pointer-events-none")}>
                <Calendar initialFocus mode="range" defaultMonth={getDefaultMonth(true)} selected={tempDateRange || (usePackDates && packDatesRange ? packDatesRange : getDefaultDateRange())} onSelect={usePackDates ? () => {} : setTempDateRange} numberOfMonths={isMobile ? 1 : 2} locale={ptBR} disabled={getDisabledDatesWithPackDates()} />
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-4 sm:pt-5 border-t border-border">
              <Button variant="outline" onClick={handleCancel} className="w-full sm:w-auto text-sm sm:text-base h-10 sm:h-11">
                Cancelar
              </Button>
              <Button onClick={handleConfirm} disabled={!tempDateRange?.from || !tempDateRange?.to} className="w-full sm:w-auto text-sm sm:text-base h-10 sm:h-11">
                Confirmar
              </Button>
            </div>
          </div>
        </Modal>
      </>
    );
  }

  // Versão original com Popover (mantida para compatibilidade)
  return (
    <div className={cn("space-y-2", className)}>
      {showLabel && label && <label className="text-sm font-medium">{label}</label>}
      <Popover open={isPopoverOpen} onOpenChange={handlePopoverOpenChange}>
        <PopoverTrigger asChild>{buttonContent}</PopoverTrigger>
        <PopoverContent className="w-auto p-0 z-[10000] max-w-[95vw] sm:max-w-none" align="start">
          <div className="space-y-2">
            {showPackDatesSwitch && onUsePackDatesChange && (
              <div className="flex items-center gap-2 p-3 border-b border-border">
                <Switch
                  id="use-pack-dates-popover"
                  checked={usePackDates}
                  onCheckedChange={onUsePackDatesChange}
                />
                <label
                  htmlFor="use-pack-dates-popover"
                  className="text-sm font-medium cursor-pointer"
                >
                  Usar datas dos packs
                </label>
              </div>
            )}
            <div className={cn("relative", usePackDates && "opacity-50 pointer-events-none")}>
              <Calendar 
                initialFocus 
                mode="range" 
                defaultMonth={getDefaultMonth(false)} 
                selected={tempDateRangePopover || (usePackDates && packDatesRange ? packDatesRange : undefined)} 
                onSelect={usePackDates ? () => {} : setTempDateRangePopover} 
                numberOfMonths={isMobile ? 1 : 2} 
                locale={ptBR} 
                disabled={getDisabledDatesWithPackDates()} 
              />
            </div>
            {requireConfirmation && (
              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 p-3 pt-2 border-t border-border">
                <Button variant="outline" onClick={handlePopoverCancel} className="w-full sm:w-auto text-sm sm:text-base h-9 sm:h-10">
                  Cancelar
                </Button>
                <Button variant="default" onClick={handlePopoverConfirm} disabled={!tempDateRangePopover?.from || !tempDateRangePopover?.to} className="w-full sm:w-auto text-sm sm:text-base h-9 sm:h-10">
                  Aplicar
                </Button>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
