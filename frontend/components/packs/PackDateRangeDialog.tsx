"use client";

import { useEffect, useMemo, useState } from "react";
import { IconInfoCircle } from "@tabler/icons-react";

import { AppDialog } from "@/components/common/AppDialog";
import { DateRangeFilter, type DateRangeValue } from "@/components/common/DateRangeFilter";
import { Button } from "@/components/ui/button";
import { getTodayLocal } from "@/lib/utils/dateFilters";
import { planWindowEdit, windowEditErrorMessage } from "@/lib/utils/packWindow";
import type { WindowEditParams } from "@/lib/hooks/usePackRefresh";
import type { AdsPack } from "@/lib/types";

interface PackDateRangeDialogProps {
  pack: AdsPack | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dispara a edição: o chamador roda o refresh "window_edit" com este período. */
  onConfirm: (pack: AdsPack, windowEdit: WindowEditParams) => void;
}

const fmt = (s: string) => s.slice(0, 10).split("-").reverse().join("/");

/**
 * Edição do período do pack — Etapa 1: só AMPLIAR.
 *
 * O diálogo mostra exatamente a fatia que o backend vai pedir à Meta (espelho em
 * lib/utils/packWindow.ts), incluindo os dias de janela de atribuição, para o
 * usuário não estranhar as datas pedidas serem maiores que as escolhidas. As
 * datas do pack só mudam quando o dado novo chega completo; falha não muda nada.
 */
export function PackDateRangeDialog({ pack, open, onOpenChange, onConfirm }: PackDateRangeDialogProps) {
  const [range, setRange] = useState<DateRangeValue>({});
  const today = getTodayLocal();

  // Reidrata ao abrir — reabrir para outro pack não pode mostrar o período do anterior.
  useEffect(() => {
    if (!open || !pack) return;
    setRange({ start: pack.date_start || undefined, end: pack.date_stop || undefined });
  }, [open, pack]);

  const result = useMemo(
    () => (pack ? planWindowEdit(pack, range.start ?? "", range.end ?? "", today) : null),
    [pack, range.start, range.end, today],
  );

  const plan = result?.plan ?? null;
  const unchanged = result?.error === "mesmo_periodo";
  // Reduzir chega na Etapa 2 (documentation/plano-edicao-periodo-pack.md).
  const reduces = !!plan?.reduces;
  const canConfirm = !!plan && !reduces;

  const errorMessage = result?.error && !unchanged ? windowEditErrorMessage(result.error) : null;

  return (
    <AppDialog isOpen={open} onClose={() => onOpenChange(false)} title="Editar período" size="sm">
      <div className="space-y-4">
        {pack && (
          <p className="text-xs text-muted-foreground">
            Período atual de <span className="font-medium text-foreground">{pack.name}</span>:{" "}
            {pack.date_start && pack.date_stop ? `${fmt(pack.date_start)} → ${fmt(pack.date_stop)}` : "—"}
          </p>
        )}

        <DateRangeFilter
          value={range}
          onChange={setRange}
          useModal={true}
          disableFutureDates={true}
          showLabel={false}
        />

        {errorMessage && <p className="text-xs text-destructive">{errorMessage}</p>}

        {reduces && (
          <div className="rounded-lg border border-border bg-input-30 p-3 text-xs text-muted-foreground">
            Reduzir o período ainda não está disponível. Por enquanto, para reduzir, recrie o pack.
          </div>
        )}

        {plan && !reduces && plan.fetch && (
          <div className="rounded-lg border border-border bg-input-30 p-3 space-y-1">
            <p className="text-xs text-foreground">
              Vai buscar na Meta <span className="font-medium">{fmt(plan.fetch[0])} → {fmt(plan.fetch[1])}</span>.
            </p>
            <p className="text-2xs text-muted-foreground flex items-start gap-1">
              <IconInfoCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>
                Inclui {plan.lookbackDays} {plan.lookbackDays === 1 ? "dia" : "dias"} de janela de atribuição na
                emenda, para as conversões tardias entrarem. O período só muda quando os dados chegarem
                completos; se a busca falhar, nada é alterado.
              </span>
            </p>
            {plan.autoRefreshOff && pack?.auto_refresh && (
              <p className="text-2xs text-muted-foreground">
                A data final é anterior a hoje: o «manter atualizado» será desligado.
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={!canConfirm}
            onClick={() => {
              if (!pack || !plan) return;
              onConfirm(pack, { date_start: plan.newStart, date_stop: plan.newStop });
            }}
          >
            Alterar período
          </Button>
        </div>
      </div>
    </AppDialog>
  );
}
