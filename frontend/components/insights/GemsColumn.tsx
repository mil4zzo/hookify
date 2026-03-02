"use client";

import type { ReactNode } from "react";
import { GenericCard } from "@/components/common/GenericCard";
import { GenericColumn, GenericColumnColorScheme } from "@/components/common/GenericColumn";
import { gemsMetricColorSchemes } from "@/lib/utils/gemsColorSchemes";

interface GemsColumnProps {
  title: string;
  items: Array<{
    ad_id?: string | null;
    ad_name?: string | null;
    thumbnail?: string | null;
    metricValue: number;
    metricFormatted: string;
    [key: string]: any;
  }>;
  metric: "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate" | "cpr" | "cpmql";
  averageValue?: number | null;
  onAdClick?: (ad: any, openVideo?: boolean) => void;
  getTopMetrics?: (adId: string | null | undefined) => {
    spendRank: number | null;
    hookRank: number | null;
    websiteCtrRank: number | null;
    ctrRank: number | null;
    pageConvRank: number | null;
    holdRateRank: number | null;
    cprRank: number | null;
    cpmqlRank: number | null;
  };
  actionType?: string;
  headerRight?: ReactNode;
  /** Tooltip opcional para o header */
  tooltip?: {
    title: string;
    content?: React.ReactNode;
  };
  /** Objeto com todas as médias para colorir o tooltip (opcional) */
  averages?: {
    hook?: number | null;
    hold_rate?: number | null;
    website_ctr?: number | null;
    connect_rate?: number | null;
    ctr?: number | null;
    cpm?: number | null;
    per_action_type?: {
      [actionType: string]: {
        cpr?: number | null;
        page_conv?: number | null;
      };
    };
  };
}

export function GemsColumn({ title, items, metric, averageValue, onAdClick, getTopMetrics, actionType, headerRight, tooltip, averages }: GemsColumnProps) {
  const colorScheme = gemsMetricColorSchemes[metric];

  return <GenericColumn title={title} items={items} colorScheme={colorScheme} averageValue={averageValue} emptyMessage="Nenhum anúncio válido encontrado" headerRight={headerRight} tooltip={tooltip} renderCard={(item, index) => <GenericCard key={`${item.ad_id}-${index}`} ad={item} metricLabel={title} metricKey={metric} rank={index + 1} averageValue={averageValue} metricColor={colorScheme.card} onClick={(openVideo?: boolean) => onAdClick?.(item, openVideo)} topMetrics={getTopMetrics?.(item.ad_id)} actionType={actionType} averages={averages} />} />;
}
