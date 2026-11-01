"use client";

import { useTranslations } from "next-intl";
import { getAppLocale } from "@/lib/i18n/locale";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconInfoCircle, IconLoader2 } from "@tabler/icons-react";

import { AppDialog } from "@/components/common/AppDialog";
import { InlineNotice } from "@/components/common/States";
import { DateRangeFilter, type DateRangeValue } from "@/components/common/DateRangeFilter";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/endpoints";
import { logger } from "@/lib/utils/logger";
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

interface Previa {
  dias: number;
  investimento: number;
}

/**
 * Edição do período do pack.
 *
 * O diálogo mostra exatamente a fatia que o backend vai pedir à Meta (espelho em
 * lib/utils/packWindow.ts), incluindo os dias de janela de atribuição, para o
 * usuário não estranhar as datas pedidas serem maiores que as escolhidas. As
 * datas do pack só mudam quando o dado novo chega completo; falha não muda nada.
 *
 * Reduzir apaga dado, então o aviso é quantificado e vem do banco — o que EXISTE
 * fora do período novo, não o que a janela declarada diz (há linhas fora dela).
 */
export function PackDateRangeDialog({ pack, open, onOpenChange, onConfirm }: PackDateRangeDialogProps) {
  const t = useTranslations("packs.dateRange");
  const tc = useTranslations("packs.common");
  const [range, setRange] = useState<DateRangeValue>({});
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);
  const pedidoRef = useRef(0);
  const today = getTodayLocal();

  // Reidrata ao abrir — reabrir para outro pack não pode mostrar o período do anterior.
  useEffect(() => {
    if (!open || !pack) return;
    setRange({ start: pack.date_start || undefined, end: pack.date_stop || undefined });
    setPrevia(null);
  }, [open, pack]);

  const result = useMemo(
    () => (pack ? planWindowEdit(pack, range.start ?? "", range.end ?? "", today) : null),
    [pack, range.start, range.end, today],
  );

  const plan = result?.plan ?? null;
  const unchanged = result?.error === "mesmo_periodo";
  const reduces = !!plan?.reduces;
  const canConfirm = !!plan;

  const errorMessage = result?.error && !unchanged ? windowEditErrorMessage(result.error) : null;

  // Prévia só quando reduz, e com respiro: o usuário mexe no calendário várias
  // vezes antes de decidir. `pedidoRef` descarta resposta de pedido vencido.
  useEffect(() => {
    if (!pack || !plan || !plan.reduces) {
      setPrevia(null);
      setCarregandoPrevia(false);
      return;
    }
    const meu = ++pedidoRef.current;
    setCarregandoPrevia(true);
    const timer = setTimeout(() => {
      api.analytics
        .previewPackDateRange(pack.id, plan.newStart, plan.newStop)
        .then((r) => {
          if (meu !== pedidoRef.current) return;
          setPrevia({ dias: r.dias, investimento: r.investimento });
        })
        .catch((e) => {
          if (meu !== pedidoRef.current) return;
          logger.error("Erro ao calcular a prévia do recorte:", e);
          setPrevia(null);
        })
        .finally(() => {
          if (meu === pedidoRef.current) setCarregandoPrevia(false);
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [pack, plan?.reduces, plan?.newStart, plan?.newStop]);

  return (
    <AppDialog isOpen={open} onClose={() => onOpenChange(false)} title={t("title")} size="sm">
      <div className="space-y-4">
        {pack && (
          <p className="text-xs text-muted-foreground">
            {t.rich("current", { name: pack.name, b: (c) => <span className="font-medium text-foreground">{c}</span> })}{" "}
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
          <InlineNotice tone="warning" title={t("reducesTitle")}>
            <div className="space-y-1">
              {carregandoPrevia || !previa ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <IconLoader2 className="w-3 h-3 animate-spin" /> {t("calculating")}
                </p>
              ) : previa.dias === 0 ? (
                <p className="text-xs">{t("noneLeave")}</p>
              ) : (
                <p className="text-xs">
                  {t.rich("daysLeave", {
                    days: previa.dias,
                    amount: previa.investimento.toLocaleString(getAppLocale(), { style: "currency", currency: "BRL" }),
                    b: (c) => <span className="font-medium">{c}</span>,
                  })}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {t("restoreHint")}
              </p>
            </div>
          </InlineNotice>
        )}

        {plan && plan.fetch && (
          <div className="rounded-md border border-border bg-background p-3 space-y-1">
            <p className="text-xs text-foreground">
              {t.rich("willFetch", { start: fmt(plan.fetch[0]), end: fmt(plan.fetch[1]), b: (c) => <span className="font-medium">{c}</span> })}
            </p>
            <p className="text-xs text-muted-foreground flex items-start gap-1">
              <IconInfoCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span>
                {t("lookback", { days: plan.lookbackDays })}
              </span>
            </p>
            {plan.autoRefreshOff && pack?.auto_refresh && (
              <p className="text-xs text-muted-foreground">
                {t("autoOff")}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {tc("cancel")}
          </Button>
          <Button
            size="sm"
            variant={reduces && (previa?.dias ?? 0) > 0 ? "destructive" : "default"}
            disabled={!canConfirm || (reduces && carregandoPrevia)}
            onClick={() => {
              if (!pack || !plan) return;
              onConfirm(pack, { date_start: plan.newStart, date_stop: plan.newStop });
            }}
          >
            {reduces && (previa?.dias ?? 0) > 0 ? t("confirmDelete") : t("confirm")}
          </Button>
        </div>
      </div>
    </AppDialog>
  );
}
