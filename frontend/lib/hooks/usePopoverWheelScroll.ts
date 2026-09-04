"use client";

import { useEffect, useRef } from "react";

/**
 * Devolve o rolar da roda do mouse a uma lista dentro de um popover aberto sobre um
 * diálogo.
 *
 * O PROBLEMA
 *   `AppDialog` é um Radix Dialog MODAL, e modal traz `react-remove-scroll`: um
 *   listener de `wheel` no documento que chama `preventDefault()` em tudo que não
 *   esteja DENTRO do conteúdo do diálogo — é assim que a página atrás para de rolar
 *   junto.
 *
 *   O conteúdo de um Popover, porém, vive num Portal (`document.body`), FORA do
 *   conteúdo do diálogo. Para o scroll-lock ele é "a página atrás": a roda do mouse
 *   não faz nada e só resta arrastar a barra de rolagem. Vale para qualquer lista
 *   rolável em popover dentro de um diálogo — o combobox de colunas da planilha, o
 *   seletor de evento de conversão no detalhe do anúncio, os multi-seleção do
 *   construtor de regra.
 *
 * A CORREÇÃO
 *   Parar a propagação do `wheel` no próprio container rolável: sem chegar ao
 *   documento, o listener do scroll-lock não roda, e o navegador rola o container
 *   normalmente (não chamamos `preventDefault`, então o comportamento nativo fica
 *   intacto).
 *
 *   Listener NATIVO, não `onWheel` do React: eventos de um portal dependem de onde o
 *   React pendurou os listeners daquele container, e um listener no próprio elemento
 *   não depende disso.
 *
 * @param open Só escuta enquanto o popover está aberto.
 * @returns ref para pendurar no elemento com `overflow-y-auto`.
 */
export function usePopoverWheelScroll<T extends HTMLElement = HTMLDivElement>(open: boolean) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const element = ref.current;
    if (!open || !element) return;
    const stopWheel = (event: WheelEvent) => event.stopPropagation();
    element.addEventListener("wheel", stopWheel, { passive: true });
    return () => element.removeEventListener("wheel", stopWheel);
  }, [open]);

  return ref;
}
