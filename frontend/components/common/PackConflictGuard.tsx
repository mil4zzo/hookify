"use client";

import { useMemo } from "react";
import { IconAlertTriangle } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { usePackConflicts } from "@/lib/hooks/usePackConflicts";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { useFiltersStore } from "@/lib/store/filters";

interface PackConflictGuardProps {
  /**
   * Sinal do servidor (camada 2, `overlap` no payload do rankings): linhas
   * dedupadas porque o mesmo anúncio existia em mais de um silo. Gatilho
   * reserva para quando o grafo client-side está defasado (staleTime) — o
   * servidor viu o conflito acontecer de fato.
   */
  serverOverlapRows?: number | null;
  children: React.ReactNode;
}

/**
 * Camada 3 do bloqueio de conflito: a rede de segurança.
 *
 * A camada 1 impede ENTRAR no estado ruim (packs conflitantes desabilitados na
 * seleção). Mas há caminhos que não passam pelo clique: a seleção persistida
 * reidrata depois de um refresh que criou o conflito, ou um grant novo chega
 * com a seleção já montada. Aqui, em vez de renderizar uma análise imprecisa,
 * a área inteira vira um bloqueio que EXPLICA e oferece a saída — desmarcar um
 * dos packs. Sem modal: o estado é da página, não um aviso por cima dela.
 *
 * "Impreciso é impreciso": não existe versão degradada da análise.
 */
export function PackConflictGuard({ serverOverlapRows, children }: PackConflictGuardProps) {
  const { conflictMap } = usePackConflicts();
  const { packs } = useClientPacks();
  const packPreferences = useFiltersStore((s) => s.packPreferences);
  const setPackPreferences = useFiltersStore((s) => s.setPackPreferences);

  const nameById = useMemo(() => new Map(packs.map((p) => [p.id, p.name])), [packs]);

  const selectedIds = useMemo(
    () => Object.entries(packPreferences).filter(([, on]) => on).map(([id]) => id),
    [packPreferences]
  );

  /** Pares CONFLITANTES dentro da seleção atual (cada par uma vez). */
  const conflictingPairs = useMemo(() => {
    const pairs: Array<[string, string]> = [];
    for (let i = 0; i < selectedIds.length; i++) {
      const enemies = conflictMap.get(selectedIds[i]);
      if (!enemies) continue;
      for (let j = i + 1; j < selectedIds.length; j++) {
        if (enemies.has(selectedIds[j])) pairs.push([selectedIds[i], selectedIds[j]]);
      }
    }
    return pairs;
  }, [selectedIds, conflictMap]);

  const blocked = conflictingPairs.length > 0 || (serverOverlapRows ?? 0) > 0;
  if (!blocked) return <>{children}</>;

  const unselect = (packId: string) => {
    setPackPreferences({ ...packPreferences, [packId]: false });
  };

  return (
    <div className="flex flex-1 items-center justify-center rounded-md border border-border bg-card p-8">
      <div className="flex max-w-xl flex-col items-center gap-4 text-center">
        <IconAlertTriangle className="h-8 w-8 text-warning" />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-text">Packs em conflito na seleção</h2>
          <p className="text-sm text-muted-foreground">
            Os packs abaixo contêm os mesmos anúncios vindos de donos diferentes. Analisá-los
            juntos duplicaria (ou descartaria) dados — os totais deixariam de ser exatos.
            Desmarque um pack de cada par para continuar.
          </p>
        </div>

        {conflictingPairs.length > 0 ? (
          <div className="flex w-full flex-col gap-2">
            {conflictingPairs.map(([a, b]) => (
              <div
                key={`${a}:${b}`}
                className="flex flex-wrap items-center justify-center gap-2 rounded-md border border-border bg-background p-3"
              >
                <span className="text-sm text-text">
                  «{nameById.get(a) ?? a}» × «{nameById.get(b) ?? b}»
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => unselect(a)}>
                    Desmarcar «{nameById.get(a) ?? "primeiro"}»
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => unselect(b)}>
                    Desmarcar «{nameById.get(b) ?? "segundo"}»
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          // Grafo local ainda não viu o par, mas o SERVIDOR dedupou linhas nesta
          // resposta (camada 2). Sem nomes para apontar, a saída é revisar a seleção.
          <p className="text-2xs text-muted-foreground">
            O servidor detectou {serverOverlapRows} linha{(serverOverlapRows ?? 0) === 1 ? "" : "s"} em
            conflito na seleção atual. Revise os packs selecionados no filtro acima.
          </p>
        )}
      </div>
    </div>
  );
}
