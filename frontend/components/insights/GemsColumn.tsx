"use client";

import type { ReactNode } from "react";
import { GenericCard } from "@/components/common/GenericCard";
import { GenericColumn, GenericColumnColorScheme } from "@/components/common/GenericColumn";

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
  metric: "hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate" | "cpr";
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
  };
  actionType?: string;
  isCompact?: boolean;
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

export function GemsColumn({ title, items, metric, averageValue, onAdClick, getTopMetrics, actionType, isCompact = true, headerRight, tooltip, averages }: GemsColumnProps) {
  const metricStyles: Record<"hook" | "website_ctr" | "ctr" | "page_conv" | "hold_rate" | "cpr", GenericColumnColorScheme> = {
    hook: {
      headerBg: "bg-blue-500/10 border-blue-500/30",
      title: "",
      card: {
        border: "border-blue-500/30",
        bg: "bg-blue-500/5",
        text: "text-blue-600 dark:text-blue-400",
        accent: "border-blue-500",
        badge: "bg-blue-500 text-white",
      },
    },
    website_ctr: {
      headerBg: "bg-purple-500/10 border-purple-500/30",
      title: "",
      card: {
        border: "border-purple-500/30",
        bg: "bg-purple-500/5",
        text: "text-purple-600 dark:text-purple-400",
        accent: "border-purple-500",
        badge: "bg-purple-500 text-white",
      },
    },
    ctr: {
      headerBg: "bg-green-500/10 border-green-500/30",
      title: "",
      card: {
        border: "border-green-500/30",
        bg: "bg-green-500/5",
        text: "text-green-600 dark:text-green-400",
        accent: "border-green-500",
        badge: "bg-green-500 text-white",
      },
    },
    page_conv: {
      headerBg: "bg-orange-500/10 border-orange-500/30",
      title: "",
      card: {
        border: "border-orange-500/30",
        bg: "bg-orange-500/5",
        text: "text-orange-600 dark:text-orange-400",
        accent: "border-orange-500",
        badge: "bg-orange-500 text-white",
      },
    },
    hold_rate: {
      headerBg: "bg-pink-500/10 border-pink-500/30",
      title: "",
      card: {
        border: "border-pink-500/30",
        bg: "bg-pink-500/5",
        text: "text-pink-600 dark:text-pink-400",
        accent: "border-pink-500",
        badge: "bg-pink-500 text-white",
      },
    },
    cpr: {
      headerBg: "bg-cyan-500/10 border-cyan-500/30",
      title: "",
      card: {
        border: "border-cyan-500/30",
        bg: "bg-cyan-500/5",
        text: "text-cyan-600 dark:text-cyan-400",
        accent: "border-cyan-500",
        badge: "bg-cyan-500 text-white",
      },
    },
  };

  const colorScheme = metricStyles[metric];

  return <GenericColumn title={title} items={items} colorScheme={colorScheme} averageValue={averageValue} emptyMessage="Nenhum anúncio válido encontrado" headerRight={headerRight} tooltip={tooltip} renderCard={(item, index) => <GenericCard key={`${item.ad_id}-${index}`} ad={item} metricLabel={title} metricKey={metric} rank={index + 1} averageValue={averageValue} metricColor={colorScheme.card} onClick={(openVideo?: boolean) => onAdClick?.(item, openVideo)} topMetrics={getTopMetrics?.(item.ad_id)} actionType={actionType} isCompact={isCompact} averages={averages} />} />;
}
