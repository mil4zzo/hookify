"use client";

import { useTranslations } from "next-intl";
import { MetaUsageSummaryResponse, MetaUsageBucEntry } from "@/lib/api/schemas";
import { InlineNotice } from "@/components/common/States";
import { cn } from "@/lib/utils/cn";

interface QuotaGaugesProps {
  summary: MetaUsageSummaryResponse | undefined;
  isLoading: boolean;
}

function bandColor(value: number | null | undefined): string {
  if (value == null) return "bg-border";
  if (value >= 80) return "bg-destructive";
  if (value >= 50) return "bg-warning";
  return "bg-success";
}

function Gauge({ label, value }: { label: string; value: number | null | undefined }) {
  const pct = typeof value === "number" ? Math.min(100, Math.max(0, value)) : 0;
  const barColor = bandColor(value);
  return (
    <div className="p-4 rounded-sm border border-border">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold">
          {value == null ? "—" : `${pct.toFixed(1)}%`}
        </div>
      </div>
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-border">
        <div
          className={cn("h-full transition-all duration-300 ease-in-out", barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function QuotaGauges({ summary, isLoading }: QuotaGaugesProps) {
  const t = useTranslations("metaUsage.quota");
  const latest = summary?.latest ?? null;

  // supabase-py sometimes double-encodes jsonb columns as a JSON string atom.
  // Parse it defensively so the BUC section renders correctly.
  const buc = ((): Record<string, MetaUsageBucEntry[]> | null => {
    const raw = latest?.business_use_case_usage;
    if (!raw) return null;
    if (typeof raw === "string") {
      try { return JSON.parse(raw); } catch { return null; }
    }
    return raw as Record<string, MetaUsageBucEntry[]>;
  })();

  const regainMinutes = latest?.regain_access_minutes ?? null;

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="p-4 rounded-sm border border-border h-[92px] animate-pulse bg-border" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {regainMinutes != null && regainMinutes > 0 && (
        <InlineNotice tone="destructive" title={t("rateLimitTitle")}>
          {t.rich("rateLimitBody", { minutes: regainMinutes, b: (c) => <strong>{c}</strong> })}
        </InlineNotice>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Gauge label="Call count" value={latest?.call_count_pct} />
        <Gauge label="CPU time" value={latest?.cputime_pct} />
        <Gauge label="Total time" value={latest?.total_time_pct} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
        <div className="p-3 rounded-sm border border-border">
          <div className="text-xs text-muted-foreground">{t("calls24h")}</div>
          <div className="text-lg font-semibold">{summary?.calls_24h ?? 0}</div>
        </div>
        <div className="p-3 rounded-sm border border-border">
          <div className="text-xs text-muted-foreground">{t("calls7d")}</div>
          <div className="text-lg font-semibold">{summary?.calls_7d ?? 0}</div>
        </div>
        <div className="p-3 rounded-sm border border-border">
          <div className="text-xs text-muted-foreground">{t("lastUpdate")}</div>
          <div className="text-sm font-medium">
            {latest?.created_at ? new Date(latest.created_at).toLocaleString() : "—"}
          </div>
        </div>
      </div>

      {summary && summary.top_routes_24h.length > 0 && (
        <div className="rounded-sm border border-border overflow-hidden">
          <div className="px-4 py-2 bg-muted text-xs font-medium text-muted-foreground">
            {t("topRoutes")}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2 font-normal">{t("route")}</th>
                <th className="px-4 py-2 font-normal">{t("calls")}</th>
                <th className="px-4 py-2 font-normal">{t("cpuSum")}</th>
              </tr>
            </thead>
            <tbody>
              {summary.top_routes_24h.map((row) => (
                <tr key={row.route} className="border-t border-border">
                  <td className="px-4 py-2 font-mono text-xs">{row.route}</td>
                  <td className="px-4 py-2">{row.calls}</td>
                  <td className="px-4 py-2">{row.cputime_sum.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {buc && Object.keys(buc).length > 0 && (
        <details className="rounded-sm border border-border">
          <summary className="px-4 py-2 cursor-pointer text-sm bg-muted">
            {t("buc")}
          </summary>
          <div className="p-4 space-y-3">
            {Object.entries(buc).map(([account, entries]) => (
              <div key={account}>
                <div className="text-xs text-muted-foreground mb-1">{t("accountLabel", { account })}</div>
                <div className="space-y-1">
                  {entries.map((e, idx) => (
                    <div key={idx} className="flex items-center gap-3 text-xs">
                      <span className="font-mono w-40 shrink-0">{e.type || "unknown"}</span>
                      <span>call: {e.call_count ?? 0}%</span>
                      <span>cpu: {e.total_cputime ?? 0}%</span>
                      <span>time: {e.total_time ?? 0}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
