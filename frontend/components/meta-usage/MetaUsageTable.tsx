"use client";

import { MetaUsageCall } from "@/lib/api/schemas";
import { cn } from "@/lib/utils/cn";

interface Props {
  items: MetaUsageCall[];
  isLoading: boolean;
  total: number | null;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

function pctCellClass(value: number | null): string {
  if (value == null) return "";
  if (value >= 80) return "text-red-400";
  if (value >= 50) return "text-yellow-400";
  return "";
}

function formatNum(v: number | null, digits = 1): string {
  if (v == null) return "—";
  return v.toFixed(digits);
}

function statusBadgeClass(status: number | null): string {
  if (status == null) return "text-muted-foreground";
  if (status >= 500) return "text-red-400";
  if (status >= 400) return "text-yellow-400";
  return "text-emerald-400";
}

export function MetaUsageTable({
  items,
  isLoading,
  total,
  page,
  pageSize,
  onPageChange,
}: Props) {
  const totalPages = total != null ? Math.max(1, Math.ceil(total / pageSize)) : null;
  const showingFrom = items.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = (page - 1) * pageSize + items.length;

  return (
    <div className="rounded border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground bg-muted/30">
              <th className="px-3 py-2 font-normal">Quando</th>
              <th className="px-3 py-2 font-normal">Página</th>
              <th className="px-3 py-2 font-normal">Rota backend</th>
              <th className="px-3 py-2 font-normal">Serviço</th>
              <th className="px-3 py-2 font-normal">Meta endpoint</th>
              <th className="px-3 py-2 font-normal">Account</th>
              <th className="px-3 py-2 font-normal text-right">CPU %</th>
              <th className="px-3 py-2 font-normal text-right">Calls %</th>
              <th className="px-3 py-2 font-normal text-right">Time %</th>
              <th className="px-3 py-2 font-normal text-right">Latência</th>
              <th className="px-3 py-2 font-normal text-right">Status</th>
              <th className="px-3 py-2 font-normal text-right">Bloqueio</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && items.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-muted-foreground">
                  Carregando...
                </td>
              </tr>
            )}
            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhuma chamada registrada no período/filtros.
                </td>
              </tr>
            )}
            {items.map((call) => (
              <tr key={call.id} className="border-t border-border hover:bg-muted/20">
                <td className="px-3 py-2 whitespace-nowrap">
                  {new Date(call.created_at).toLocaleString()}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{call.page_route ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{call.route ?? "—"}</td>
                <td className="px-3 py-2 text-xs">{call.service_name ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{call.meta_endpoint ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{call.ad_account_id ?? "—"}</td>
                <td className={cn("px-3 py-2 text-right tabular-nums", pctCellClass(call.cputime_pct))}>
                  {formatNum(call.cputime_pct)}
                </td>
                <td className={cn("px-3 py-2 text-right tabular-nums", pctCellClass(call.call_count_pct))}>
                  {formatNum(call.call_count_pct)}
                </td>
                <td className={cn("px-3 py-2 text-right tabular-nums", pctCellClass(call.total_time_pct))}>
                  {formatNum(call.total_time_pct)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {call.response_ms != null ? `${call.response_ms} ms` : "—"}
                </td>
                <td className={cn("px-3 py-2 text-right tabular-nums", statusBadgeClass(call.http_status))}>
                  {call.http_status ?? "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {call.regain_access_minutes != null && call.regain_access_minutes > 0
                    ? <span className="text-red-400 font-medium">{call.regain_access_minutes}m</span>
                    : <span className="text-muted-foreground">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-3 py-2 bg-muted/20 text-xs text-muted-foreground">
        <div>
          {total != null ? (
            <>
              Mostrando {showingFrom}–{showingTo} de {total}
            </>
          ) : (
            <>
              {items.length} itens
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-2 py-1 rounded border border-border disabled:opacity-50"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Anterior
          </button>
          <span>
            Página {page}
            {totalPages != null ? ` / ${totalPages}` : ""}
          </span>
          <button
            type="button"
            className="px-2 py-1 rounded border border-border disabled:opacity-50"
            disabled={totalPages != null ? page >= totalPages : items.length < pageSize}
            onClick={() => onPageChange(page + 1)}
          >
            Próxima
          </button>
        </div>
      </div>
    </div>
  );
}
