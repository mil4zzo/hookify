"use client";

import { KanbanColumn } from "./KanbanColumn";
import { useFormatCurrency } from "@/lib/utils/currency";

interface AdData {
  ad_id: string;
  ad_name: string;
  thumbnail?: string | null;
  cpr: number;
  hook: number;
  ctr: number;
  page_conv: number;
  conversions?: Record<string, number>;
  lpv?: number;
}

interface KanbanBoardProps {
  ads: AdData[];
  variant: "success" | "danger";
  actionType?: string;
}

export function KanbanBoard({ ads, variant, actionType }: KanbanBoardProps) {
  const formatCurrency = useFormatCurrency();

  // Calcular métricas para cada anúncio
  const adsWithMetrics = ads.map((ad) => {
    const results = actionType && ad.conversions ? Number(ad.conversions[actionType] || 0) : 0;
    const lpv = ad.lpv || 0;
    const page_conv = lpv > 0 ? results / lpv : 0;

    return {
      ...ad,
      page_conv,
    };
  });

  // Filtrar ads com valores válidos e calcular rankings
  const getTopCPR = () => {
    const valid = adsWithMetrics.filter((ad) => ad.cpr > 0 && !isNaN(ad.cpr));
    const sorted = [...valid].sort((a, b) => (variant === "success" ? a.cpr - b.cpr : b.cpr - a.cpr));
    return sorted.slice(0, 5).map((ad) => ({
      ad_id: ad.ad_id,
      ad_name: ad.ad_name,
      thumbnail: ad.thumbnail,
      metricValue: ad.cpr,
      metricFormatted: formatCurrency(ad.cpr),
    }));
  };

  const getTopHook = () => {
    const valid = adsWithMetrics.filter((ad) => ad.hook > 0 && !isNaN(ad.hook));
    const sorted = [...valid].sort((a, b) => (variant === "success" ? b.hook - a.hook : a.hook - b.hook));
    return sorted.slice(0, 5).map((ad) => ({
      ad_id: ad.ad_id,
      ad_name: ad.ad_name,
      thumbnail: ad.thumbnail,
      metricValue: ad.hook,
      metricFormatted: `${(ad.hook * 100).toFixed(1)}%`,
    }));
  };

  const getTopCTR = () => {
    const valid = adsWithMetrics.filter((ad) => ad.ctr > 0 && !isNaN(ad.ctr));
    const sorted = [...valid].sort((a, b) => (variant === "success" ? b.ctr - a.ctr : a.ctr - b.ctr));
    return sorted.slice(0, 5).map((ad) => ({
      ad_id: ad.ad_id,
      ad_name: ad.ad_name,
      thumbnail: ad.thumbnail,
      metricValue: ad.ctr,
      metricFormatted: `${(ad.ctr * 100).toFixed(2)}%`,
    }));
  };

  const getTopPageConv = () => {
    const valid = adsWithMetrics.filter((ad) => ad.page_conv > 0 && !isNaN(ad.page_conv));
    const sorted = [...valid].sort((a, b) => (variant === "success" ? b.page_conv - a.page_conv : a.page_conv - b.page_conv));
    return sorted.slice(0, 5).map((ad) => ({
      ad_id: ad.ad_id,
      ad_name: ad.ad_name,
      thumbnail: ad.thumbnail,
      metricValue: ad.page_conv,
      metricFormatted: `${(ad.page_conv * 100).toFixed(2)}%`,
    }));
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 h-full">
      <KanbanColumn title="CPR" items={getTopCPR()} variant={variant} />
      <KanbanColumn title="Hook" items={getTopHook()} variant={variant} />
      <KanbanColumn title="CTR" items={getTopCTR()} variant={variant} />
      <KanbanColumn title="Conversão de Página" items={getTopPageConv()} variant={variant} />
    </div>
  );
}

