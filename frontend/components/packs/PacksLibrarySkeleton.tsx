"use client";

import React from "react";
// design-system-exception: direct-skeleton-import - esqueleto replica o explorer e os tiles de pasta com formato real, fora do escopo dos variants de StateSkeleton
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Esqueleto do corpo da Biblioteca (/packs): explorer à esquerda + tiles de pasta.
 *
 * Copia a CAIXA de cada peça real — mesmo grid, mesmas larguras de coluna, mesma
 * altura de linha — para a troca esqueleto → conteúdo não pular. Mostra pastas
 * porque é o que a raiz da Biblioteca abre mostrando; quem não tem pasta verá os
 * cards de pack no lugar, uma diferença aceitável num quadro de carregamento.
 */

const TREE_ROW_COUNT = 7;
const FOLDER_TILE_COUNT = 6;
// Larguras variadas: nomes de tamanhos iguais leem como padrão, não como texto.
const TREE_LABEL_WIDTHS = ["w-24", "w-10", "w-12", "w-10", "w-14", "w-16", "w-8"];

/** Linha do PackFolderTree: caret (w-6) + ícone + nome + contagem, 32px de altura. */
function TreeRowSkeleton({ index }: { index: number }) {
  return (
    <div className="flex items-center gap-2 py-1.5 pl-6 pr-1">
      <div className="flex h-5 flex-1 items-center gap-2">
        <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
        <Skeleton className={`h-3 ${TREE_LABEL_WIDTHS[index % TREE_LABEL_WIDTHS.length]}`} />
      </div>
      <Skeleton className="h-3.5 w-5 shrink-0 rounded-sm" />
    </div>
  );
}

/** Tile do FolderCard: desenho da pasta (170:128) + nome + "N packs · R$". */
function FolderTileSkeleton() {
  return (
    <div className="flex flex-col items-center gap-2 px-1.5 pb-2.5 pt-2">
      <Skeleton className="w-full rounded-lg" style={{ aspectRatio: "170 / 128" }} />
      <div className="flex w-full flex-col items-center gap-0.5 px-1">
        <div className="flex h-5 items-center">
          <Skeleton className="h-3.5 w-12" />
        </div>
        <div className="flex h-4 items-center">
          <Skeleton className="h-3 w-28 max-w-full" />
        </div>
      </div>
    </div>
  );
}

export function PacksLibrarySkeleton() {
  return (
    <div className="flex flex-col items-stretch gap-6 lg:min-h-0 lg:flex-1 lg:flex-row xl:gap-8" aria-busy="true" aria-label="Carregando Biblioteca">
      {/* Explorer: mesma coluna do PackFolderTree (busca + árvore). */}
      <div className="flex w-full shrink-0 flex-col gap-4 self-start lg:w-56 xl:w-64">
        <Skeleton className="h-control-default w-full" />
        <div className="flex flex-col gap-0.5">
          {Array.from({ length: TREE_ROW_COUNT }).map((_, index) => (
            <TreeRowSkeleton key={index} index={index} />
          ))}
        </div>
      </div>

      {/* Conteúdo: seção "Pastas" com o mesmo grid dos FolderCard. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <section className="flex flex-col gap-4">
          <div className="flex h-7 items-center">
            <Skeleton className="h-5 w-20" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: FOLDER_TILE_COUNT }).map((_, index) => (
              <FolderTileSkeleton key={index} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/** Placeholders das ações do cabeçalho (Ordenar / Nova pasta / Novo Pack). */
export function PacksActionsSkeleton() {
  return (
    <div className="flex items-center gap-3">
      <Skeleton className="h-control-default w-10" />
      <Skeleton className="h-control-default w-32" />
      <Skeleton className="h-control-default w-32" />
    </div>
  );
}
