"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdInfoCard } from "@/components/ads/AdInfoCard";
import { VideoDialog } from "@/components/ads/VideoDialog";
import { createColumnHelper, getCoreRowModel, getSortedRowModel, useReactTable, flexRender } from "@tanstack/react-table";
import { ArrowUpDown, Play, Eye } from "lucide-react";

type Ad = any;

interface RankingsTableProps {
  ads: Ad[];
  groupByAdName?: boolean;
}

const columnHelper = createColumnHelper<Ad>();

export function RankingsTable({ ads, groupByAdName = false }: RankingsTableProps) {
  const [selectedAd, setSelectedAd] = useState<Ad | null>(null);
  const [videoOpen, setVideoOpen] = useState(false);
  const [selectedVideo, setSelectedVideo] = useState<{ videoId: string; actorId: string; title: string } | null>(null);

  const data = useMemo(() => {
    if (!groupByAdName) return ads;
    // Agrupar por ad_name agregando métricas básicas
    const map = new Map<string, Ad>();
    for (const ad of ads) {
      const key = ad.ad_name || ad.ad_id;
      if (!map.has(key)) {
        map.set(key, { ...ad });
      } else {
        const acc = map.get(key)!;
        acc.impressions = (acc.impressions || 0) + (ad.impressions || 0);
        acc.clicks = (acc.clicks || 0) + (ad.clicks || 0);
        acc.inline_link_clicks = (acc.inline_link_clicks || 0) + (ad.inline_link_clicks || 0);
        acc.spend = (acc.spend || 0) + (ad.spend || 0);
        acc.total_plays = (acc.total_plays || 0) + (ad.total_plays || 0);
        acc.total_thruplays = (acc.total_thruplays || 0) + (ad.total_thruplays || 0);
      }
    }
    return Array.from(map.values()).map((ad) => ({
      ...ad,
      ctr: ad.impressions ? (ad.clicks / ad.impressions) * 100 : 0,
      website_ctr: ad.impressions ? (ad.inline_link_clicks / ad.impressions) * 100 : 0,
      cpm: ad.impressions ? (ad.spend * 1000) / ad.impressions : 0,
    }));
  }, [ads, groupByAdName]);

  const formatPct = (v: number) => (v ? `${v.toFixed(2)}%` : "—");
  const formatNum = (v: number) => (v ? v.toLocaleString("pt-BR") : "—");
  const formatUsd = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" }).format(v || 0);

  const columns = useMemo(
    () => [
      columnHelper.accessor("ad_name", { header: "Ad Name", cell: (info) => <span className="truncate max-w-[240px] inline-block">{String(info.getValue() || "—")}</span> }),
      columnHelper.accessor("impressions", { header: "Impressions", cell: (info) => <span className="text-right inline-block w-full">{formatNum(Number(info.getValue()))}</span> }),
      columnHelper.accessor("clicks", { header: "Clicks", cell: (info) => <span className="text-right inline-block w-full">{formatNum(Number(info.getValue()))}</span> }),
      columnHelper.accessor("ctr", { header: "CTR", cell: (info) => <span className="text-right inline-block w-full">{formatPct(Number(info.getValue()))}</span> }),
      columnHelper.accessor("inline_link_clicks", { header: "Link Clicks", cell: (info) => <span className="text-right inline-block w-full">{formatNum(Number(info.getValue()))}</span> }),
      columnHelper.accessor("website_ctr", { header: "Website CTR", cell: (info) => <span className="text-right inline-block w-full">{formatPct(Number(info.getValue()))}</span> }),
      columnHelper.accessor("spend", { header: "Spend", cell: (info) => <span className="text-right inline-block w-full">{formatUsd(Number(info.getValue()))}</span> }),
      columnHelper.display({
        id: "actions",
        header: "Ações",
        cell: ({ row }) => {
          const ad = row.original;
          const hasVideo = Boolean(ad["creative.video_id"] || (Array.isArray(ad.adcreatives_videos_ids) && ad.adcreatives_videos_ids.length > 0));
          const videoId = ad["creative.video_id"] || (ad.adcreatives_videos_ids?.[0] as string | undefined);
          const actorId = ad["creative.actor_id"];
          return (
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setSelectedAd(ad)}>
                <Eye className="w-4 h-4 mr-1" /> Info
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasVideo}
                onClick={() => {
                  setSelectedVideo({ videoId: videoId!, actorId: actorId!, title: ad.ad_name });
                  setVideoOpen(true);
                }}
              >
                <Play className="w-4 h-4 mr-1" /> Vídeo
              </Button>
            </div>
          );
        },
      }),
    ],
    [videoOpen]
  );

  const table = useReactTable({ data, columns, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });

  return (
    <div className="w-full">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="bg-surface2">
                {hg.headers.map((header) => (
                  <th key={header.id} className="border border-surface2 p-2 text-left font-medium">
                    {header.isPlaceholder ? null : (
                      <div className={`flex items-center gap-1 ${header.column.getCanSort() ? "cursor-pointer select-none hover:text-brand" : ""}`} onClick={header.column.getToggleSortingHandler()}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <ArrowUpDown className="w-3 h-3" />
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="hover:bg-surface2/50">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="border border-surface2 p-2">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Info Dialog */}
      <Dialog open={!!selectedAd} onOpenChange={(open) => !open && setSelectedAd(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Informações do Anúncio</DialogTitle>
          </DialogHeader>
          {selectedAd && <AdInfoCard ad={selectedAd} />}
        </DialogContent>
      </Dialog>

      {/* Video Dialog - Único para toda a tabela */}
      <VideoDialog
        open={videoOpen}
        onOpenChange={(open) => {
          setVideoOpen(open);
          if (!open) setSelectedVideo(null);
        }}
        videoId={selectedVideo?.videoId}
        actorId={selectedVideo?.actorId}
        title={selectedVideo?.title}
      />
    </div>
  );
}
