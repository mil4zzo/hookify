"use client";

import { useMemo, useState } from "react";
import { LoadingState, EmptyState } from "@/components/common/States";
import { useClientAuth, useClientPacks } from "@/lib/hooks/useClientSession";
import { RankingsTable } from "@/components/rankings/RankingsTable";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { BarChart3, Group, ListFilter } from "lucide-react";

export default function RankingsPage() {
  const { isClient, isAuthenticated } = useClientAuth();
  const { packs } = useClientPacks();
  const [groupByAdName, setGroupByAdName] = useState(true);

  const allAds = useMemo(() => {
    return packs.flatMap((p) => p.ads || []);
  }, [packs]);

  if (!isClient) {
    return (
      <div className="container mx-auto px-4 py-8">
        <LoadingState label="Carregando..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="container mx-auto px-4 py-8">
        <EmptyState message="Você precisa estar logado para acessar o rankings" />
      </div>
    );
  }

  if (!allAds || allAds.length === 0) {
    return (
      <div className="container mx-auto px-4 py-8">
        <EmptyState message="Nenhum anúncio carregado. Carregue packs na página ADs Loader para visualizar os rankings." />
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-bold flex items-center gap-3">
              <BarChart3 className="w-10 h-10 text-brand" />
              Rankings
            </h1>
            <p className="text-muted">Análise e comparação de performance dos anúncios</p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant={groupByAdName ? "default" : "outline"} onClick={() => setGroupByAdName(true)}>
              Agrupar por nome
            </Button>
            <Button variant={!groupByAdName ? "default" : "outline"} onClick={() => setGroupByAdName(false)}>
              Sem agrupamento
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-4">
            <RankingsTable ads={allAds} groupByAdName={groupByAdName} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
