"use client";

import { useEffect, type RefObject } from "react";

/**
 * Devolve o rolar da roda do mouse a uma lista dentro de um popover aberto sobre um
 * diálogo.
 *
 * O PROBLEMA
 *   `AppDialog` é um Radix Dialog MODAL, e modal traz `react-remove-scroll`: um
 *   listener de `wheel` no `document` que chama `preventDefault()` em tudo que não
 *   esteja dentro do conteúdo do diálogo — é assim que a página atrás para de rolar
 *   junto. (Confirmado no código da lib: `document.addEventListener('wheel',
 *   shouldPrevent, {passive:false})`, e o Radix passa a `shards: [contentRef]`.)
 *
 *   O conteúdo de um Popover vive num Portal (`document.body`), FORA do conteúdo do
 *   diálogo. Para o scroll-lock ele é "a página atrás": a roda não faz nada e só
 *   resta arrastar a barra. Vale para qualquer lista rolável em popover dentro de um
 *   diálogo — o combobox de colunas da planilha, o seletor de evento de conversão no
 *   detalhe do anúncio, os multi-seleção do construtor de regra.
 *
 * POR QUE ROLAMOS À MÃO EM VEZ DE SÓ BARRAR A PROPAGAÇÃO
 *   A primeira tentativa foi `stopPropagation()` no container: sem chegar ao
 *   documento, o listener da lib não rodaria. Pela leitura do código da lib isso
 *   deveria bastar — e **não bastou na prática** (2026-09-04). Em vez de insistir
 *   numa explicação que não consigo provar sem o navegador, esta versão não depende
 *   de quem chama `preventDefault`: ela move o `scrollTop` do container ela mesma.
 *   Se o listener roda, a lista rola; ponto.
 *
 *   `stopPropagation` continua junto, porque é barato e evita que o scroll-lock
 *   trabalhe à toa.
 *
 * NOS LIMITES, DEIXA PASSAR
 *   No topo rolando para cima (ou no fim rolando para baixo) não fazemos nada: o
 *   evento segue seu caminho normal, e quem decide é o resto da página. Sem isso, a
 *   lista prenderia a roda do mouse mesmo sem ter para onde rolar.
 *
 * @param open Só escuta enquanto o popover está aberto.
 * @param ref ref do elemento com `overflow-y-auto` — criado pelo componente, para
 *            conviver com um ref que ele já tenha (rolagem infinita, por exemplo).
 */
export function usePopoverWheelScroll<T extends HTMLElement>(open: boolean, ref: RefObject<T | null>): void {
  useEffect(() => {
    const element = ref.current;
    if (!open || !element) return;

    const onWheel = (event: WheelEvent) => {
      // `deltaMode`: 0 = pixels (o normal), 1 = linhas, 2 = páginas. Firefox usa
      // linhas; sem converter, a lista andaria 3px por giro.
      const LINE_HEIGHT = 16;
      const factor = event.deltaMode === 1 ? LINE_HEIGHT : event.deltaMode === 2 ? element.clientHeight : 1;
      const delta = event.deltaY * factor;
      if (delta === 0) return;

      const maxScroll = element.scrollHeight - element.clientHeight;
      if (maxScroll <= 0) return; // não há o que rolar: deixa o evento seguir
      const atTop = element.scrollTop <= 0 && delta < 0;
      const atBottom = element.scrollTop >= maxScroll - 1 && delta > 0;
      if (atTop || atBottom) return; // chegou ao limite: quem rola é o resto da página

      event.stopPropagation();
      if (event.cancelable) event.preventDefault();
      element.scrollTop = Math.max(0, Math.min(maxScroll, element.scrollTop + delta));
    };

    // `passive: false` é obrigatório: um listener passivo não pode chamar
    // preventDefault, e sem ele a página atrás rolaria junto com a lista.
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [open, ref]);
}
