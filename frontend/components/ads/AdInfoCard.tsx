"use client";

import { Card, CardContent } from "@/components/ui/card";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";

interface AdInfoCardProps {
  ad: any;
}

export function AdInfoCard({ ad }: AdInfoCardProps) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-muted-foreground">Ad Name</p>
            <p className="font-medium">{ad.ad_name}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Ad ID</p>
            <p className="font-mono text-xs">{ad.ad_id}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Adset</p>
            <p className="font-medium">{ad.adset_name}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Campaign</p>
            <p className="font-medium">{ad.campaign_name}</p>
          </div>
        </div>

        {(() => {
          const thumbnail = getAdThumbnail(ad);
          return thumbnail ? <img src={thumbnail} alt="thumbnail" className="w-full rounded" /> : null;
        })()}
      </CardContent>
    </Card>
  );
}
