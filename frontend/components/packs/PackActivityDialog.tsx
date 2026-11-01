"use client";

import { useTranslations } from "next-intl";
import { getAppLocale } from "@/lib/i18n/locale";
import { translate } from "@/lib/i18n/translate";
import { getDateFnsLocale } from "@/lib/utils/dateFnsLocale";
import { useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  IconAlertTriangle,
  IconHistory,
  IconLoader2,
  IconUserCircle,
} from "@tabler/icons-react";

import { AppDialog } from "@/components/common/AppDialog";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/common/States";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePackActivity } from "@/lib/hooks/usePackActivity";
import type { PackActionVerb, PackActivityEntry } from "@/lib/api/schemas";
import type { AdsPack } from "@/lib/types";

interface PackActivityDialogProps {
  pack: AdsPack;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Verbo canônico -> chave da frase no catálogo (`packs.activity.verb.*`). O `Record` é
 * exaustivo sobre `PackActionVerb`: um verbo novo no backend quebra o build aqui em vez
 * de aparecer cru na tela do usuário.
 */
const VERB_KEY: Record<PackActionVerb, string> = {
  "ad.status": "status",
  "adset.status": "status",
  "campaign.status": "status",
  "adset.budget": "budget",
  "campaign.budget": "budget",
  "pack.refresh": "refresh",
  "pack.transcribe": "transcribe",
  "pack.sheet_sync": "sheetSync",
  "pack.sheet_relink": "sheetRelink",
  "pack.sheet_columns": "sheetColumns",
  "job.cancel": "jobCancel",
  "pack.judgment": "judgment",
  "pack.auto_refresh": "autoRefresh",
  "pack.rename": "rename",
  "pack.date_range": "dateRange",
  "pack.delete": "delete",
  "share.grant": "shareGrant",
  "share.role": "shareRole",
  "share.revoke": "shareRevoke",
  "share.leave": "shareLeave",
};

const TARGET_KINDS = new Set(["ad", "adset", "campaign"]);

const tr = (key: string, values?: Record<string, string | number>) => translate(`packs.activity.${key}`, values);

function roleLabel(role: string): string {
  return role === "dono" || role === "editor" || role === "viewer" ? tr(`role.${role}`) : role;
}

function formatMoneySubunit(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  return (n / 100).toLocaleString(getAppLocale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Complemento da frase: o QUE foi afetado. Vazio quando o verbo já se basta. */
function describeTarget(entry: PackActivityEntry): string {
  const kind = entry.target_type ?? "";
  return TARGET_KINDS.has(kind) ? tr("target", { kind, count: entry.target_count }) : "";
}

/** Detalhe curto entre parênteses — o "de X para Y" quando existe. */
function describeDetail(entry: PackActivityEntry): string | null {
  const d = entry.detail ?? {};

  if (entry.action.endsWith(".status") && typeof d.to === "string") {
    return d.to === "PAUSED" ? tr("detail.paused") : tr("detail.activated");
  }
  if (entry.action.endsWith(".budget")) {
    const type = d.budget_type === "lifetime" ? "lifetime" : "daily";
    // Ajuste em massa: guarda o PEDIDO (o valor final difere por entidade).
    if (d.mode === "percent" && d.percent != null) {
      const pct = Number(d.percent);
      return tr("detail.budgetPercent", { pct: `${pct > 0 ? "+" : ""}${pct.toLocaleString(getAppLocale())}` });
    }
    if (d.mode === "delta" && d.amount != null) {
      const amount = Number(d.amount);
      return tr("detail.budgetDelta", { sign: amount < 0 ? "−" : "+", amount: formatMoneySubunit(Math.abs(amount)), type });
    }
    if (d.mode === "fixed" && d.amount != null) {
      return tr("detail.budgetFixed", { type, amount: formatMoneySubunit(d.amount) });
    }
    if (d.daily_budget != null) return tr("detail.budgetDaily", { amount: formatMoneySubunit(d.daily_budget) });
    if (d.lifetime_budget != null) return tr("detail.budgetLifetime", { amount: formatMoneySubunit(d.lifetime_budget) });
    return null;
  }
  if (entry.action === "pack.rename") {
    return d.from && d.to ? `«${String(d.from)}» → «${String(d.to)}»` : null;
  }
  if (entry.action === "pack.date_range") {
    const from = d.from as { date_start?: string; date_stop?: string } | undefined;
    const to = d.to as { date_start?: string; date_stop?: string } | undefined;
    const fmt = (s?: string) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "?");
    return from && to ? tr("detail.dateRange", { fromStart: fmt(from.date_start), fromStop: fmt(from.date_stop), toStart: fmt(to.date_start), toStop: fmt(to.date_stop) }) : null;
  }
  if (entry.action === "pack.auto_refresh") {
    return d.to === true ? tr("detail.autoOn") : tr("detail.autoOff");
  }
  if (entry.action === "pack.judgment") {
    const parts: string[] = [];
    if ("mql_leadscore_min" in d) {
      parts.push(d.mql_leadscore_min == null ? tr("detail.mqlRemoved") : tr("detail.mqlSet", { value: String(d.mql_leadscore_min) }));
    }
    if ("target_cpr" in d) {
      parts.push(d.target_cpr == null ? tr("detail.targetRemoved") : tr("detail.targetSet"));
    }
    if ("lead_economics" in d) {
      parts.push(d.lead_economics == null ? tr("detail.economicsRemoved") : tr("detail.economicsSet"));
    }
    return parts.length ? parts.join(" · ") : null;
  }
  if (entry.action === "pack.refresh") {
    return d.since && d.until ? tr("detail.refreshRange", { since: String(d.since), until: String(d.until) }) : null;
  }
  if (entry.action === "pack.transcribe") {
    return d.pending != null ? tr("detail.videos", { count: String(d.pending) }) : null;
  }
  if (entry.action === "share.grant" || entry.action === "share.role") {
    const role = typeof d.role === "string" ? roleLabel(d.role) : null;
    // Acesso que veio de uma pasta compartilhada (181). Sem o nome da pasta: o feed é lido
    // também pelo convidado, e a pasta é organização pessoal do dono.
    return d.via_folder ? [role, tr("detail.viaFolder")].filter(Boolean).join(" · ") : role;
  }
  if (entry.action === "share.revoke" && d.via_folder) {
    return tr("detail.viaFolder");
  }
  if (entry.action === "pack.sheet_relink") {
    return typeof d.google_email === "string" ? d.google_email : null;
  }
  if (entry.action === "pack.sheet_columns") {
    const op = d.op === "delete" ? tr("detail.columnDeleted") : tr("detail.columnEdited");
    return typeof d.label === "string" ? `${op} "${d.label}"` : op;
  }
  return null;
}

function ActivityRow({ entry }: { entry: PackActivityEntry }) {
  const t = useTranslations("packs.activity");
  const dateLocale = getDateFnsLocale();
  const when = new Date(entry.created_at);
  const target = describeTarget(entry);
  const detail = describeDetail(entry);
  const failed = entry.status === "error";

  return (
    <li className="flex gap-3 border-b border-border py-3 last:border-b-0">
      <IconUserCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">
          <span className="font-medium">{entry.actor_name || t("someone")}</span>{" "}
          <span className="text-muted-foreground">{VERB_KEY[entry.action] ? t(`verb.${VERB_KEY[entry.action]}`) : entry.action}</span>
          {target && <span className="font-medium"> {target}</span>}
          {detail && <span className="text-muted-foreground"> — {detail}</span>}
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
          <span title={format(when, t("dateTimeFormat"), { locale: dateLocale })}>
            {formatDistanceToNow(when, { addSuffix: true, locale: dateLocale })}
          </span>
          <span>·</span>
          <span>{roleLabel(entry.actor_role)}</span>
          {entry.status === "partial" && (
            <>
              <span>·</span>
              <span className="text-warning">{t("partial")}</span>
            </>
          )}
        </div>

        {/* Falha registrada de propósito: "tentei pausar e não pausou" é
            exatamente a pergunta que chega no suporte sem esta linha. */}
        {failed && (
          <p className="mt-1 flex items-start gap-1.5 text-xs text-destructive">
            <IconAlertTriangle className="mt-px h-3 w-3 shrink-0" />
            <span>{t("notDone", { hasError: entry.error ? "yes" : "no", error: entry.error ?? "" })}</span>
          </p>
        )}
        {/* Parcial também diz o porquê: "3 de 50 não mudaram" sem motivo não responde nada. */}
        {entry.status === "partial" && entry.error && (
          <p className="mt-1 flex items-start gap-1.5 text-xs text-warning">
            <IconAlertTriangle className="mt-px h-3 w-3 shrink-0" />
            <span>{entry.error}</span>
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * Histórico de ações do pack (P3.5).
 *
 * Existe porque num pack compartilhado a credencial é sempre do dono: no
 * Gerenciador de Anúncios da Meta, tudo que o convidado faz aparece como sendo
 * do dono. Esta tela é o único lugar que sabe quem realmente agiu.
 *
 * Qualquer membro abre — todos já veem os efeitos das ações; esconder o autor
 * não protegeria nada.
 */
export function PackActivityDialog({ pack, open, onOpenChange }: PackActivityDialogProps) {
  const t = useTranslations("packs.activity");
  const [actorFilter, setActorFilter] = useState<string>("all");

  const { data, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    usePackActivity(pack.id, actorFilter === "all" ? undefined : actorFilter, open);

  const entries = useMemo(
    () => (data?.pages ?? []).flatMap((page) => page.entries),
    [data]
  );

  // Opções do filtro saem das entradas já carregadas: não há endpoint de
  // "membros que agiram", e inventar um por causa de um seletor seria caro.
  const actors = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) {
      if (e.actor_id && !map.has(e.actor_id)) map.set(e.actor_id, e.actor_name || t("someone"));
    }
    return [...map.entries()];
  }, [entries, t]);

  return (
    <AppDialog isOpen={open} onClose={() => onOpenChange(false)} size="lg" title={t("title")}>
      <div className="space-y-4">
        <header className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <IconHistory className="h-5 w-5" />
            {t("heading", { name: pack.name })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("intro")}
          </p>
        </header>

        {actors.length > 1 && (
          <div className="flex items-center gap-2">
            <Select value={actorFilter} onValueChange={setActorFilter}>
              <SelectTrigger size="sm" className="w-56">
                <SelectValue placeholder={t("allPeople")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allPeople")}</SelectItem>
                {actors.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Loading antes de qualquer empty state: "nenhuma ação" enquanto ainda
            carrega é uma afirmação falsa. */}
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <IconLoader2 className="h-4 w-4 animate-spin" />
            {t("loading")}
          </div>
        ) : isError ? (
          <InlineNotice tone="destructive" title={t("errorTitle")}>
            {error instanceof Error ? error.message : t("errorRetry")}
          </InlineNotice>
        ) : entries.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {t("empty")}
          </p>
        ) : (
          <>
            <ul className="max-h-[50vh] overflow-y-auto pr-1">
              {entries.map((entry) => (
                <ActivityRow key={entry.id} entry={entry} />
              ))}
            </ul>

            {hasNextPage && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? <IconLoader2 className="h-4 w-4 animate-spin" /> : t("loadMore")}
              </Button>
            )}

            <p className="text-xs text-muted-foreground">
              {t("retention")}
            </p>
          </>
        )}
      </div>
    </AppDialog>
  );
}
