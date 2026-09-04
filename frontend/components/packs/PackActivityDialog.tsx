"use client";

import { useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  IconAlertTriangle,
  IconHistory,
  IconLoader2,
  IconUserCircle,
} from "@tabler/icons-react";

import { AppDialog } from "@/components/common/AppDialog";
import { Button } from "@/components/ui/button";
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
 * Verbo canônico -> frase em português. O `Record` é exaustivo sobre
 * `PackActionVerb`: um verbo novo no backend quebra o build aqui em vez de
 * aparecer cru na tela do usuário.
 */
const VERB_LABEL: Record<PackActionVerb, string> = {
  "ad.status": "alterou o status de",
  "adset.status": "alterou o status de",
  "campaign.status": "alterou o status de",
  "adset.budget": "mudou o orçamento de",
  "campaign.budget": "mudou o orçamento de",
  "pack.refresh": "atualizou os dados do pack",
  "pack.transcribe": "iniciou a transcrição dos vídeos",
  "pack.sheet_sync": "sincronizou a planilha",
  "pack.sheet_relink": "reconectou a conta Google",
  "pack.sheet_columns": "alterou uma coluna vinculada da planilha",
  "job.cancel": "cancelou um processamento em andamento",
  "pack.judgment": "mudou os critérios de julgamento",
  "pack.auto_refresh": "mudou a atualização automática",
  "pack.rename": "renomeou o pack",
  "pack.delete": "apagou o pack",
  "share.grant": "deu acesso a",
  "share.role": "mudou o papel de",
  "share.revoke": "removeu o acesso de",
  "share.leave": "saiu do pack",
};

const KIND_PT: Record<string, [string, string]> = {
  ad: ["anúncio", "anúncios"],
  adset: ["conjunto", "conjuntos"],
  campaign: ["campanha", "campanhas"],
};

const ROLE_LABEL: Record<string, string> = {
  dono: "dono",
  editor: "editor",
  viewer: "leitura",
};

function formatMoneySubunit(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? "");
  return (n / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Complemento da frase: o QUE foi afetado. Vazio quando o verbo já se basta. */
function describeTarget(entry: PackActivityEntry): string {
  const kind = KIND_PT[entry.target_type ?? ""];
  if (kind) {
    const [singular, plural] = kind;
    return entry.target_count === 1
      ? `1 ${singular}`
      : `${entry.target_count.toLocaleString("pt-BR")} ${plural}`;
  }
  return "";
}

/** Detalhe curto entre parênteses — o "de X para Y" quando existe. */
function describeDetail(entry: PackActivityEntry): string | null {
  const d = entry.detail ?? {};

  if (entry.action.endsWith(".status") && typeof d.to === "string") {
    return d.to === "PAUSED" ? "pausou" : "ativou";
  }
  if (entry.action.endsWith(".budget")) {
    if (d.daily_budget != null) return `diário para ${formatMoneySubunit(d.daily_budget)}`;
    if (d.lifetime_budget != null) return `total para ${formatMoneySubunit(d.lifetime_budget)}`;
    return null;
  }
  if (entry.action === "pack.rename") {
    return d.from && d.to ? `«${String(d.from)}» → «${String(d.to)}»` : null;
  }
  if (entry.action === "pack.auto_refresh") {
    return d.to === true ? "ligou" : "desligou";
  }
  if (entry.action === "pack.judgment") {
    const parts: string[] = [];
    if ("mql_leadscore_min" in d) {
      parts.push(d.mql_leadscore_min == null ? "corte de MQL removido" : `corte de MQL ${d.mql_leadscore_min}`);
    }
    if ("target_cpr" in d) {
      parts.push(d.target_cpr == null ? "CPR alvo removido" : "CPR alvo redefinido");
    }
    return parts.length ? parts.join(" · ") : null;
  }
  if (entry.action === "pack.refresh") {
    return d.since && d.until ? `${String(d.since)} a ${String(d.until)}` : null;
  }
  if (entry.action === "pack.transcribe") {
    return d.pending != null ? `${String(d.pending)} vídeo(s)` : null;
  }
  if (entry.action === "share.grant" || entry.action === "share.role") {
    return typeof d.role === "string" ? (ROLE_LABEL[d.role] ?? d.role) : null;
  }
  if (entry.action === "pack.sheet_relink") {
    return typeof d.google_email === "string" ? d.google_email : null;
  }
  if (entry.action === "pack.sheet_columns") {
    const op = d.op === "delete" ? "excluiu" : "editou";
    return typeof d.label === "string" ? `${op} "${d.label}"` : op;
  }
  return null;
}

function ActivityRow({ entry }: { entry: PackActivityEntry }) {
  const when = new Date(entry.created_at);
  const target = describeTarget(entry);
  const detail = describeDetail(entry);
  const failed = entry.status === "error";

  return (
    <li className="flex gap-3 border-b border-border py-3 last:border-b-0">
      <IconUserCircle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text">
          <span className="font-medium">{entry.actor_name || "Alguém"}</span>{" "}
          <span className="text-muted-foreground">{VERB_LABEL[entry.action] ?? entry.action}</span>
          {target && <span className="font-medium"> {target}</span>}
          {detail && <span className="text-muted-foreground"> — {detail}</span>}
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
          <span title={format(when, "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}>
            {formatDistanceToNow(when, { addSuffix: true, locale: ptBR })}
          </span>
          <span>·</span>
          <span>{ROLE_LABEL[entry.actor_role] ?? entry.actor_role}</span>
          {entry.status === "partial" && (
            <>
              <span>·</span>
              <span className="text-warning">parcial</span>
            </>
          )}
        </div>

        {/* Falha registrada de propósito: "tentei pausar e não pausou" é
            exatamente a pergunta que chega no suporte sem esta linha. */}
        {failed && (
          <p className="mt-1 flex items-start gap-1.5 text-2xs text-destructive">
            <IconAlertTriangle className="mt-px h-3 w-3 shrink-0" />
            <span>Não concluído{entry.error ? `: ${entry.error}` : ""}</span>
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
      if (e.actor_id && !map.has(e.actor_id)) map.set(e.actor_id, e.actor_name || "Alguém");
    }
    return [...map.entries()];
  }, [entries]);

  return (
    <AppDialog isOpen={open} onClose={() => onOpenChange(false)} size="lg" title="Histórico do pack">
      <div className="space-y-4">
        <header className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text">
            <IconHistory className="h-5 w-5" />
            Histórico de «{pack.name}»
          </h2>
          <p className="text-sm text-muted-foreground">
            Quem fez o quê neste pack. Ações feitas por convidados aparecem no Gerenciador
            de Anúncios como sendo suas — aqui aparece quem realmente agiu.
          </p>
        </header>

        {actors.length > 1 && (
          <div className="flex items-center gap-2">
            <Select value={actorFilter} onValueChange={setActorFilter}>
              <SelectTrigger size="sm" className="w-56">
                <SelectValue placeholder="Todas as pessoas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as pessoas</SelectItem>
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
            Carregando histórico...
          </div>
        ) : isError ? (
          <p className="rounded-md border border-border bg-background p-4 text-sm text-muted-foreground">
            Não foi possível carregar o histórico{error instanceof Error ? `: ${error.message}` : ""}.
          </p>
        ) : entries.length === 0 ? (
          <p className="rounded-md border border-border bg-background p-4 text-sm text-muted-foreground">
            Nenhuma ação registrada neste pack ainda. Pausar um anúncio, mudar um orçamento
            ou atualizar os dados aparece aqui.
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
                {isFetchingNextPage ? <IconLoader2 className="h-4 w-4 animate-spin" /> : "Carregar mais"}
              </Button>
            )}

            <p className="text-2xs text-muted-foreground">
              O histórico guarda os últimos 365 dias.
            </p>
          </>
        )}
      </div>
    </AppDialog>
  );
}
