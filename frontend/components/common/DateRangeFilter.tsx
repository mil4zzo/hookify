"use client";

import { DateRange } from "react-day-picker";
import { format, parse } from "date-fns";
import { DateRangePicker } from "@/components/ui/date-range-picker";

export interface DateRangeValue {
  start?: string;
  end?: string;
}

interface DateRangeFilterProps {
  label?: string;
  showLabel?: boolean; // Se true, mostra a label (padrão: true para manter compatibilidade)
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  className?: string;
  useModal?: boolean; // Se true, usa modal ao invés de popover
  disableFutureDates?: boolean; // Se true, desabilita datas posteriores a hoje
  requireConfirmation?: boolean; // Se true, requer confirmação antes de aplicar (mostra botão "Aplicar")
}

// Helper para converter DateRange para DateRangeValue
function dateRangeToValue(range: DateRange | undefined): DateRangeValue {
  if (!range?.from) {
    return { start: undefined, end: undefined };
  }

  return {
    start: format(range.from, "yyyy-MM-dd"),
    end: range.to ? format(range.to, "yyyy-MM-dd") : undefined,
  };
}

// Helper para converter DateRangeValue para DateRange
function valueToDateRange(value: DateRangeValue): DateRange | undefined {
  if (!value.start) {
    return undefined;
  }

  try {
    const from = parse(value.start, "yyyy-MM-dd", new Date());
    const to = value.end ? parse(value.end, "yyyy-MM-dd", new Date()) : undefined;

    return {
      from,
      to: to || undefined,
    };
  } catch {
    return undefined;
  }
}

export function DateRangeFilter({ label = "Período", showLabel = true, value, onChange, className, useModal = false, disableFutureDates = false, requireConfirmation = false }: DateRangeFilterProps) {
  const dateRange = valueToDateRange(value);

  const handleDateChange = (range: DateRange | undefined) => {
    const newValue = dateRangeToValue(range);
    onChange(newValue);
  };

  return <DateRangePicker label={label} showLabel={showLabel} date={dateRange} onDateChange={handleDateChange} className={className} placeholder="Selecione um período" useModal={useModal} disableFutureDates={disableFutureDates} requireConfirmation={requireConfirmation} />;
}
