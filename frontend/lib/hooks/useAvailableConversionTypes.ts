"use client";

import { useEffect, useMemo } from "react";
import { usePacksLoading } from "@/components/layout/PacksLoader";
import { useFilters } from "@/lib/hooks/useFilters";

/**
 * Lista de eventos de conversão disponíveis = união de `packs[].conversion_types`
 * dos packs selecionados, e a sincronização dessa lista com o store de filtros.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * O metadado `packs.conversion_types` é materializado no refresh (union incremental)
 * justamente para não pagar esse cálculo no read-path. A RPC de rankings sabe
 * calcular a mesma lista (`p_include_available_conversion_types`), mas isso expande
 * ~70 tipos de conversão a partir do jsonb, linha a linha: medido com EXPLAIN
 * ANALYZE em 2026-08-25, custa 0,8 s numa seleção de 3 packs e de 3 a 9 s numa de
 * 30 packs. Zero request aqui contra segundos lá.
 *
 * O GATE É A PARTE DELICADA (já quebrou três vezes)
 * -------------------------------------------------
 * `setActionTypeOptions` tem duas responsabilidades acopladas: popular a lista E
 * reconciliar o `actionType` selecionado — inclusive LIMPAR um `actionType` órfão
 * quando a lista vem `[]`. Disso saem duas regras opostas, e é fácil violar uma ao
 * respeitar a outra:
 *
 *  1. NÃO gatear em `length > 0`. Parece razoável, mas mata a limpeza do órfão:
 *     trocar de pack/período para um recorte sem aquele evento deixaria um
 *     `actionType` inexistente → `conversions[actionType] = 0` → CPR e resultados
 *     zerados em tudo, silenciosamente.
 *
 *  2. NÃO chamar antes dos packs carregarem. Como esta fonte é SÍNCRONA (deriva do
 *     metadado, não de fetch), a lista vale `[]` durante o load — e `selectedPackIds`
 *     já é não-vazio nessa janela, porque as preferências de pack são persistidas.
 *     Chamar com `[]` aí apagaria o `actionType` salvo do usuário.
 *
 * `packsReady` resolve as duas: inclui `!packsLoading` (não basta `packs.length > 0`,
 * que já é verdade com cache stale rehidratado — é preciso esperar o fetch fresco).
 * Com ele, a limpeza do órfão só acontece quando os packs de fato têm 0 tipos.
 *
 * Encapsular união + gate aqui é deliberado: enquanto cada tela montava isso por
 * conta própria, cada uma errou o gate de um jeito diferente.
 *
 * Chamar de várias telas ao mesmo tempo é seguro — a deduplicação de re-render
 * (não reescrever lista igual) mora no próprio `setActionTypeOptions`.
 */
export function useAvailableConversionTypes(): {
  availableConversionTypes: string[];
  packsReady: boolean;
} {
  const { packs, packsClient, selectedPackIds, setActionTypeOptions } = useFilters();
  const { isLoading: packsLoading } = usePacksLoading();

  const packsReady = !!packsClient && packs.length > 0 && !packsLoading;

  const availableConversionTypes = useMemo(() => {
    if (selectedPackIds.size === 0 || packs.length === 0) return [] as string[];
    const set = new Set<string>();
    for (const p of packs) {
      if (!selectedPackIds.has(p.id)) continue;
      const types = (p as { conversion_types?: unknown }).conversion_types;
      if (Array.isArray(types)) {
        for (const t of types) if (t) set.add(String(t));
      }
    }
    return Array.from(set).sort();
  }, [packs, selectedPackIds]);

  // Chave estável: o Set muda de identidade a cada render, mas o conteúdo não.
  const selectedPackIdsKey = useMemo(
    () => Array.from(selectedPackIds).sort().join(","),
    [selectedPackIds],
  );

  useEffect(() => {
    if (packsReady && selectedPackIds.size > 0) {
      setActionTypeOptions(availableConversionTypes);
    }
    // `availableConversionTypes` é derivado de packs+seleção; as duas já estão nas deps.
  }, [packsReady, availableConversionTypes, selectedPackIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return { availableConversionTypes, packsReady };
}
