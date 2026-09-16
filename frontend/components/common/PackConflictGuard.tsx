"use client";

import { useMemo } from "react";
import { IconAlertTriangle } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { usePackConflicts } from "@/lib/hooks/usePackConflicts";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { useFiltersStore } from "@/lib/store/filters";
import { selectionIsUnverifiable } from "@/components/common/packConflictGate";

interface PackConflictGuardProps {
  /**
   * Sinal do servidor (`overlap` no payload do rankings): linhas dedupadas
   * porque o mesmo anúncio existia em mais de um silo.
   *
   * INERTE desde a migration 145, e por decisão: ao tornar o BLOQUEIO o
   * mecanismo, a 145 tirou o `GROUP BY` do ramo por pack da RPC e deixou
   * `x_cross_silo` como constante `false` (ver "Por que bloquear e não
   * deduplicar" em documentation/decisoes-tecnicas.md — foi de lá que veio o
   * −12% do Manager). Logo `overlap` nunca é emitido e este valor é sempre null.
   *
   * A fiação fica para o dia em que a detecção server-side voltar. Até então,
   * NÃO é gatilho reserva de nada: quem cobre o grafo defasado/indisponível é o
   * `conflictUnknown` abaixo.
   */
  serverOverlapRows?: number | null;
  children: React.ReactNode;
}

/**
 * A última barreira do bloqueio de conflito.
 *
 * A camada 1 (`PackFilter`) impede ENTRAR no estado ruim: pack conflitante fica
 * desabilitado na seleção. Mas há caminhos que não passam pelo clique — a
 * seleção é persistida e reidrata depois de um refresh que criou o conflito, ou
 * um grant novo chega com a seleção já montada. Aqui, em vez de renderizar uma
 * análise imprecisa, a área inteira vira um bloqueio que EXPLICA e oferece a
 * saída — desmarcar um dos packs. Sem modal: o estado é da página, não um aviso
 * por cima dela.
 *
 * "Impreciso é impreciso": não existe versão degradada da análise.
 *
 * DOIS MOTIVOS PARA BLOQUEAR, e o segundo é o que faz isto FALHAR FECHADO
 * ----------------------------------------------------------------------
 *   1. O grafo aponta um par conflitante dentro da seleção — nomeia os packs.
 *   2. O grafo NÃO PÔDE SER OBTIDO e há 2+ packs somando (`conflictUnknown`).
 *      Mapa vazio por falha não é "sem conflito", é "não sei"; e desde a
 *      migration 145 não existe nada atrás deste bloqueio (o read-path deixou
 *      de deduplicar, de propósito — ver `serverOverlapRows`). Liberar no
 *      "não sei" era abrir justamente a porta que este componente fecha.
 */
export function PackConflictGuard({ serverOverlapRows, children }: PackConflictGuardProps) {
  const { conflictMap, isUnavailable: conflictUnknown } = usePackConflicts();
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

  // FALHA FECHADA: o grafo não pôde ser obtido E há 2+ packs somando na tela.
  // A camada 1 (PackFilter) impede ADICIONAR um segundo pack nessa situação, mas
  // não desfaz uma seleção que já estava montada quando a busca falhou — seleção
  // é persistida e rehidrata. Sem grafo não há como nomear o par, então a saída
  // é revisar a seleção.
  const unknownWithMultiple = selectionIsUnverifiable(selectedIds, conflictUnknown);

  const blocked =
    conflictingPairs.length > 0 || (serverOverlapRows ?? 0) > 0 || unknownWithMultiple;
  if (!blocked) return <>{children}</>;

  const unselect = (packId: string) => {
    setPackPreferences({ ...packPreferences, [packId]: false });
  };

  return (
    <div className="flex flex-1 items-center justify-center rounded-md border border-border bg-card p-8">
      <div className="flex max-w-xl flex-col items-center gap-4 text-center">
        <IconAlertTriangle className="h-8 w-8 text-warning" />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">
            {unknownWithMultiple && conflictingPairs.length === 0
              ? "Não foi possível verificar conflito entre packs"
              : "Packs em conflito na seleção"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {unknownWithMultiple && conflictingPairs.length === 0
              ? "A verificação de packs que compartilham anúncios falhou. Com mais de um pack somando, não há como garantir que os totais estejam exatos — então preferimos não mostrá-los. Deixe um pack selecionado, ou recarregue a página para tentar de novo."
              : "Os packs abaixo contêm os mesmos anúncios nos mesmos dias. Analisá-los juntos duplicaria (ou descartaria) dados — os totais deixariam de ser exatos. Desmarque um pack de cada par para continuar, ou crie um pack que junte os dois recortes."}
          </p>
        </div>

        {conflictingPairs.length > 0 ? (
          <div className="flex w-full flex-col divide-y divide-border rounded-md border border-border bg-surface-2">
            {conflictingPairs.map(([a, b]) => (
              <div
                key={`${a}:${b}`}
                className="flex flex-wrap items-center justify-center gap-2 p-3"
              >
                <span className="text-sm text-foreground">
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
        ) : unknownWithMultiple ? (
          // Sem grafo não há par para nomear: ofereço desmarcar qualquer um dos
          // selecionados, o que já basta para sair do estado (1 pack nunca soma
          // em duplicidade).
          <div className="flex w-full flex-wrap items-center justify-center gap-2">
            {selectedIds.map((id) => (
              <Button key={id} variant="outline" size="sm" onClick={() => unselect(id)}>
                Desmarcar «{nameById.get(id) ?? id}»
              </Button>
            ))}
          </div>
        ) : (
          // Sinal `overlap` do servidor. INERTE hoje: a migration 145 fixou
          // `x_cross_silo` em `false` ao tornar o bloqueio o mecanismo (ver
          // "Por que bloquear e não deduplicar" em decisoes-tecnicas.md), então
          // `serverOverlapRows` é sempre null e este ramo não é alcançado. A
          // fiação fica para o dia em que a detecção server-side voltar; não
          // confie nela como rede de segurança enquanto isto estiver escrito.
          <p className="text-2xs text-muted-foreground">
            O servidor detectou {serverOverlapRows} linha{(serverOverlapRows ?? 0) === 1 ? "" : "s"} em
            conflito na seleção atual. Revise os packs selecionados no filtro acima.
          </p>
        )}
      </div>
    </div>
  );
}
