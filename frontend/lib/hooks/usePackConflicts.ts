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
 *      é relido.
 *
 * NÃO EXISTE CAMADA 2 (corrigido em 2026-09-09)
 * ---------------------------------------------
 * Este comentário afirmava que, se o grafo envelhecesse, "a camada 2 (sinal
 * `overlap` no read-path) bloqueia a tela". Isso deixou de ser verdade na
 * migration 145 — e por decisão deliberada, não por descuido: a 145 tirou o
 * `GROUP BY` do ramo por pack da RPC do Manager justamente porque o BLOQUEIO
 * passou a ser o mecanismo ("Por que bloquear e não deduplicar",
 * documentation/decisoes-tecnicas.md). Foi de lá que veio o −12% do Manager.
 * `x_cross_silo` ficou como constante `false`: o sinal `overlap` nunca é emitido.
 *
 * Consequência para quem mexer aqui: ESTE GRAFO É A ÚNICA PROTEÇÃO. Não há rede
 * atrás dele. Duas coisas seguem dessa afirmação:
 *   - reduzir a frequência da busca alarga a janela de grafo velho, e isso é
 *     decisão de segurança, não de performance;
 *   - e o grafo tem de FALHAR FECHADO. Mapa vazio não significa "sem conflito",
 *     significa "não sei" — por isso `isUnavailable` existe e é separado de
 *     `conflictMap.size === 0`.
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
    /**
     * O grafo NÃO pôde ser obtido (a busca falhou e o retry esgotou).
     *
     * Distinto de `conflictMap.size === 0`, que significa "olhei e não há
     * conflito". Aqui é "não sei" — e como este grafo é a única proteção (ver o
     * bloco acima), "não sei" tem de fechar a porta, não abri-la: os
     * consumidores desabilitam a seleção de um SEGUNDO pack enquanto isto
     * estiver ligado.
     *
     * `isLoading` de propósito NÃO entra aqui: durante a primeira busca a tela
     * piscaria bloqueada em toda carga de página, e o risco real só existe
     * depois que a busca falha em definitivo. Se o grafo chegar com conflito, o
     * `PackConflictGuard` bloqueia na sequência.
     */
    isUnavailable: query.isError,
  };
}
