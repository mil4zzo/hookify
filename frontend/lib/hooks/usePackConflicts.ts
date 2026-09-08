"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/endpoints";
import { useSupabaseAuth } from "@/lib/hooks/useSupabaseAuth";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { computePacksContentStamp } from "@/lib/utils/packsFreshness";
import { usePacksLoading } from "@/components/layout/PacksLoader";

/**
 * Grafo de conflito entre os packs acessíveis.
 *
 * Dois packs que contêm o mesmo anúncio no mesmo dia não podem ser analisados
 * juntos: o dedup escolheria uma das linhas e o total deixaria de ser exato.
 * Decisão de produto: "impreciso é impreciso" — não se avisa com porcentagem,
 * bloqueia-se.
 *
 * Até a migration 145 isso valia só entre DONOS diferentes: packs do mesmo dono
 * liam a mesma linha física de ad_metrics, então somar não duplicava. Desde a
 * 145 cada linha pertence a UM pack — o mesmo anúncio-dia em dois packs são duas
 * linhas — e a regra passou a valer para qualquer par. O uso esperado é packs
 * que não se sobrepõem (recortes complementares); para comparar recortes que se
 * cruzam, cria-se outro pack.
 *
 * O grafo cobre TODOS os packs da lista, não só os selecionados: a seleção muda
 * a cada clique, mas o grafo só muda quando o conteúdo de um pack muda (refresh)
 * ou um grant aparece — por isso um fetch com staleTime serve todas as
 * interações, e o toggle de seleção é puramente client-side.
 *
 * QUANDO ISTO É REBUSCADO
 * -----------------------
 * Não existe timer: o TanStack só repete sozinho com `refetchInterval`, que não
 * há, e `refetchOnWindowFocus` é `false` no provider. Sobram três gatilhos:
 *
 *   1. A LISTA muda (pack criado/apagado, share concedido/revogado) — os ids
 *      estão na chave, então a busca é imediata.
 *   2. O CONTEÚDO muda (refresh, inclusive o de outro membro em pack
 *      compartilhado) — `computePacksContentStamp` põe o `max(updated_at)` na
 *      chave. Quem relê esse carimbo do servidor é `usePackRefreshSync`, na
 *      volta ao foco da aba. Mudou o dado → mudou a chave → o cache velho não
 *      precisa ser invalidado, ele só deixa de ser encontrável.
 *   3. Teto de 30 min, ao montar uma tela. Cinto e suspensório para o caso que
 *      o carimbo não cobre: ninguém sai e volta para a aba, então nem o carimbo
 *      é relido. Se o grafo ainda assim envelhecer, a camada 2 (sinal `overlap`
 *      no read-path) bloqueia a tela — nunca se mostra número impreciso.
 *
 * O gate em `packsLoading` existe pelo mesmo motivo que em `useAdPerformance`: o
 * store é persistido e rehidrata packs com `updated_at` ANTIGO antes do /packs
 * fresco chegar. Sem ele, toda carga de página buscaria o grafo duas vezes — uma
 * com o carimbo velho, outra quando a lista sincronizasse. Os dois consumidores
 * (TopbarFilters e PackConflictGuard) vivem dentro do PacksLoader, que é quem
 * fornece o contexto.
 */
export function usePackConflicts() {
  const { session, sessionReady } = useSupabaseAuth();
  const { packs, isClient } = useClientPacks();
  const { isLoading: packsLoading } = usePacksLoading();

  const packIds = useMemo(() => packs.map((p) => p.id).sort(), [packs]);
  const contentStamp = useMemo(() => computePacksContentStamp(packs), [packs]);

  const query = useQuery({
    // user_id na key: cache persistido não pode vazar entre contas.
    queryKey: [
      "pack-conflicts",
      session?.user?.id ?? "anon",
      packIds.join(","),
      contentStamp,
    ],
    queryFn: ({ signal }) => api.packShares.getConflicts(packIds, { signal }),
    // Conflito exige 2+ packs e donos diferentes — com a lista vazia/unitária
    // nem vale a viagem.
    enabled: !!session && sessionReady && isClient && !packsLoading && packIds.length >= 2,
    staleTime: 30 * 60 * 1000,
    retry: 1,
  });

  /** packId -> conjunto de packIds com que ele conflita (grafo não-direcionado). */
  const conflictMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const [a, b] of query.data?.pairs ?? []) {
      if (!map.has(a)) map.set(a, new Set());
      if (!map.has(b)) map.set(b, new Set());
      map.get(a)!.add(b);
      map.get(b)!.add(a);
    }
    return map;
  }, [query.data]);

  return {
    conflictMap,
    pairs: query.data?.pairs ?? [],
    isLoading: query.isLoading,
  };
}
