"use client";

import { useMemo, type MutableRefObject, type RefObject } from "react";

/**
 * Devolve o rolar da roda do mouse a uma lista dentro de um popover aberto sobre um
 * diálogo.
 *
 * O PROBLEMA
 *   `AppDialog` é um Radix Dialog MODAL, e modal traz `react-remove-scroll`: um
 *   listener de `wheel` no `document` que chama `preventDefault()` em tudo que não
 *   esteja dentro do conteúdo do diálogo — é assim que a página atrás para de rolar
 *   junto. O conteúdo de um Popover vive num Portal (`document.body`), FORA do
 *   conteúdo do diálogo: para o scroll-lock ele é "a página atrás", a roda não faz
 *   nada e só resta arrastar a barra.
 *
 * POR QUE `ref` DE CALLBACK E NÃO `useEffect`
 *   Duas versões anteriores prendiam o listener num `useEffect([open, ref])` e NUNCA
 *   rodaram — provado no navegador em 2026-09-04: o efeito rodava com
 *   `{open: true, temElemento: false}` e nenhum listener de `wheel` aparecia no
 *   elemento. O Radix monta o conteúdo do popover um COMMIT DEPOIS de `open` virar
 *   true (o `Presence` só manda 'MOUNT' no layout effect dele), então quando o efeito
 *   do combobox roda o `ref.current` ainda é null — e como `open` já não muda mais, o
 *   efeito nunca é reexecutado. Um `ref` de callback não tem esse buraco: o React o
 *   chama com o nó no instante em que ele entra no DOM, e com `null` quando sai.
 *
 * POR QUE ROLAMOS À MÃO EM VEZ DE SÓ BARRAR A PROPAGAÇÃO
 *   Mexer no `scrollTop` nós mesmos não depende de quem chama `preventDefault` nem da
 *   ordem dos listeners. `stopPropagation` vem junto só para o scroll-lock não
 *   trabalhar à toa.
 *
 * NOS LIMITES, DEIXA PASSAR
 *   No topo rolando para cima (ou no fim rolando para baixo) não fazemos nada: o
 *   evento segue seu caminho e quem decide é o resto da página. Sem isso, a lista
 *   prenderia a roda do mouse mesmo sem ter para onde rolar.
 */

/**
 * Prende o tratamento da roda a um elemento já existente e devolve como soltá-lo.
 * Separado do hook para poder ser testado sem React nem DOM de verdade.
 */
export function attachPopoverWheelScroll(element: HTMLElement): () => void {
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
}

/**
 * Fábrica do `ref` de callback. Fora do hook para o teste poder exercitá-la sem React
 * nem DOM — é aqui que mora a garantia que faltava: prender o listener acontece
 * DENTRO da chamada, não num efeito posterior.
 *
 * @param externalRef ref que o componente já usa para outra coisa (rolagem infinita,
 *                    reposicionar no topo ao filtrar). Continua sendo preenchido.
 */
export function createPopoverWheelRef<T extends HTMLElement>(externalRef?: RefObject<T | null>): (node: T | null) => void {
  let solta: (() => void) | null = null;
  return (node: T | null) => {
    solta?.();
    solta = null;
    if (externalRef) (externalRef as MutableRefObject<T | null>).current = node;
    if (node) solta = attachPopoverWheelScroll(node);
  };
}

/** @returns o `ref` a passar para o elemento com `overflow-y-auto`. */
export function usePopoverWheelScroll<T extends HTMLElement>(externalRef?: RefObject<T | null>): (node: T | null) => void {
  return useMemo(() => createPopoverWheelRef(externalRef), [externalRef]);
}
