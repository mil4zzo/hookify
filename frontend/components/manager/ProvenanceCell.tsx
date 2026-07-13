"use client";

import React from "react";
import type { RankingsItem } from "@/lib/api/schemas";
import { formatProvenanceNames, formatProvenanceTitle, getRowAccountNames, getRowPackNames, useProvenanceIndex } from "@/lib/manager/provenance";

interface ProvenanceCellProps {
  original: RankingsItem;
  dimension: "pack" | "account";
}

/**
 * Célula das colunas opcionais Pack / Conta.
 *
 * Resolve os nomes pelo hook em vez de usar o valor do accessor de propósito: o TableContent é
 * memoizado sobre uma instância estável de `table`, então recriar as colunas quando as contas
 * terminam de carregar NÃO re-renderizaria as células — mas uma mudança no store, sim (o
 * React.memo não bloqueia re-render disparado por store). O accessor continua existindo e
 * devolvendo os mesmos nomes: é ele que alimenta ordenação, filtro de texto e exportação de CSV.
 */
export const ProvenanceCell = React.memo(function ProvenanceCell({ original, dimension }: ProvenanceCellProps) {
  const provenanceIndex = useProvenanceIndex();
  const names = dimension === "pack" ? getRowPackNames(original, provenanceIndex) : getRowAccountNames(original, provenanceIndex);

  if (names.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <span className="block truncate" title={formatProvenanceTitle(names)}>
      {formatProvenanceNames(names)}
    </span>
  );
});
