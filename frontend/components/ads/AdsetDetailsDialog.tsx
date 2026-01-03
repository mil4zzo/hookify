"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api/endpoints";
import { RankingsItem } from "@/lib/api/schemas";
import { useFormatCurrency } from "@/lib/utils/currency";
import { IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

interface AdsetDetailsDialogProps {
  adsetId: string;
  adsetName?: string | null;
  dateStart?: string;
  dateStop?: string;
  actionType?: string;
}

export function AdsetDetailsDialog({ adsetId, adsetName, dateStart, dateStop, actionType }: AdsetDetailsDialogProps) {
  const formatCurrency = useFormatCurrency();
  const [isLoading, setIsLoading] = useState(false);
  const [details, setDetails] = useState<any | null>(null);
  const [children, setChildren] = useState<RankingsItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const shouldFetch = !!adsetId && !!dateStart && !!dateStop;
    if (!shouldFetch) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    Promise.all([
      api.analytics.getAdsetDetails(adsetId, { date_start: dateStart!, date_stop: dateStop! }),
      api.analytics.getAdsetChildren(adsetId, { date_start: dateStart!, date_stop: dateStop! }),
    ])
      .then(([d, c]) => {
        if (cancelled) return;
        setDetails(d || null);
        setChildren((c?.data || []) as any);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || "Erro ao carregar detalhes do conjunto");
        setDetails(null);
        setChildren([]);
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [adsetId, dateStart, dateStop]);

  const headerTitle = useMemo(() => {
    const name = (adsetName || details?.adset_name || "").toString().trim();
    if (name) return name;
    return `Conjunto ${adsetId}`;
  }, [adsetId, adsetName, details?.adset_name]);

  const summary = useMemo(() => {
    const spend = Number(details?.spend || 0);
    const impressions = Number(details?.impressions || 0);
    const clicks = Number(details?.clicks || 0);
    const conversionsObj = details?.conversions || {};
    const results = actionType ? Number(conversionsObj[actionType] || 0) : 0;
    const cpr = results > 0 ? spend / results : null;
    return { spend, impressions, clicks, results, cpr };
  }, [details, actionType]);

  return (
    <div className="w-full">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="text-lg font-medium truncate">{headerTitle}</div>
          <div className="text-xs text-muted-foreground truncate">ID: {adsetId}</div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => {}} className="pointer-events-none opacity-0">
          <IconX className="h-4 w-4" />
        </Button>
      </div>

      {error ? <div className="text-sm text-destructive">{error}</div> : null}

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground">Spend</div>
              <div className="text-sm font-medium">{formatCurrency(summary.spend)}</div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground">Impressões</div>
              <div className="text-sm font-medium">{summary.impressions.toLocaleString("pt-BR")}</div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground">Cliques</div>
              <div className="text-sm font-medium">{summary.clicks.toLocaleString("pt-BR")}</div>
            </div>
            <div className="rounded-md border border-border p-3">
              <div className="text-xs text-muted-foreground">CPR</div>
              <div className="text-sm font-medium">{summary.cpr != null ? formatCurrency(summary.cpr) : "—"}</div>
            </div>
          </div>

          <div className="rounded-md border border-border overflow-hidden">
            <div className="px-4 py-3 border-b border-border text-sm font-medium">Anúncios no conjunto</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2">Anúncio</th>
                    <th className="text-right px-4 py-2">Spend</th>
                    <th className="text-right px-4 py-2">Impr.</th>
                    <th className="text-right px-4 py-2">CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {children.length === 0 ? (
                    <tr>
                      <td className="px-4 py-6 text-center text-muted-foreground" colSpan={4}>
                        Nenhum anúncio encontrado para este conjunto.
                      </td>
                    </tr>
                  ) : (
                    children.map((row: any) => {
                      const ctr = Number(row.ctr || 0);
                      return (
                        <tr key={row.ad_id} className="border-t border-border">
                          <td className="px-4 py-2">{row.ad_name || row.ad_id}</td>
                          <td className="px-4 py-2 text-right">{formatCurrency(Number(row.spend || 0))}</td>
                          <td className="px-4 py-2 text-right">{Number(row.impressions || 0).toLocaleString("pt-BR")}</td>
                          <td className="px-4 py-2 text-right">{(ctr * 100).toFixed(2)}%</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}



