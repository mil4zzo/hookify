"use client";

import React from "react";
import { Toaster } from "sonner";
import { ErrorCardStack } from "@/components/common/ErrorCardStack";
import { RefreshQueueBar } from "@/components/common/RefreshQueueBar";

/** VIEWPORT_OFFSET do sonner (constante interna, 32px). A coluna do canto usa o mesmo valor. */
const TOASTER_BASE_OFFSET = 32;
/** Idem para telas pequenas, onde o sonner usa --mobile-offset-*. */
const TOASTER_BASE_MOBILE_OFFSET = 16;
/** Folga entre a coluna do canto e a pilha de toasts. */
const STACK_GAP = 8;

/**
 * Largura da lista de toasts, igualada à do card (w-[22rem] no ProgressToastCard).
 * O padrão do sonner é 356px e os cards são unstyled com width auto — a lista ficava 4px
 * mais larga que o card, e a coluna do canto (que alinha pelo card) parecia torta. O `style`
 * do Toaster é aplicado depois das vars do sonner, então isto vence.
 */
const TOASTER_STYLE = { "--width": "22rem" } as React.CSSProperties;

/**
 * Toaster do app + a coluna ancorada no canto: cards de erro e placar do lote.
 *
 * De baixo para cima: placar da fila, cards de erro, pilha de progresso. Os dois primeiros
 * são nossos porque o sonner mantém UMA lista por posição e ordena por recência — dentro da
 * pilha fechada, um erro persistente era soterrado pelas atualizações seguintes do lote.
 * Fora dela, ele fica no mesmo canto, separado por uma folga, sem disputar o lugar da frente.
 *
 * A altura da coluna é medida (o card de erro varia com o tamanho da mensagem) e vira o
 * offset do Toaster — é o que mantém a pilha sempre logo acima dela.
 *
 * expand={false}: a pilha fica fechada, em baralho. Com um card por pack e a fila serial,
 * 12 atualizações abertas ao mesmo tempo passavam de 1.500px e saíam da tela.
 */
export function AppToaster() {
  const cornerRef = React.useRef<HTMLDivElement | null>(null);
  const [cornerHeight, setCornerHeight] = React.useState(0);

  // ResizeObserver porque a coluna muda de altura sozinha: o placar entra e sai, e o card
  // de erro tem altura variável (mensagem longa, linha de diagnóstico). Medir uma vez no
  // mount deixaria a pilha por cima. O nó é nosso e renderiza sempre, então ref + effect
  // basta — sem o cleanup de callback ref, que o React 18 ignora.
  React.useEffect(() => {
    const node = cornerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => setCornerHeight(node.getBoundingClientRect().height);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, []);

  const occupied = cornerHeight > 0 ? cornerHeight + STACK_GAP : 0;

  return (
    <>
      <Toaster
        position="bottom-right"
        richColors
        theme="dark"
        expand={false}
        visibleToasts={3}
        // gap é o que define a fatia visível de cada card ATRÁS no baralho fechado
        // (--lift-amount = lift × gap), menos ~3px que o scale-down do sonner come.
        // Com 8 sobrava uma tira de ~5px, que lia como borda do card da frente.
        gap={16}
        style={TOASTER_STYLE}
        offset={{ bottom: TOASTER_BASE_OFFSET + occupied }}
        mobileOffset={{ bottom: TOASTER_BASE_MOBILE_OFFSET + occupied }}
        // Sem isto a duração é tempo de relógio: um toast disparado com a aba
        // em segundo plano nasce e morre sem o usuário ver. Com a prop, o timer
        // pausa enquanto document.hidden e retoma o restante ao voltar.
        pauseWhenPageIsHidden
      />

      <div
        ref={cornerRef}
        className="pointer-events-none fixed bottom-8 right-8 z-toast flex flex-col items-end gap-2"
      >
        <ErrorCardStack />
        <RefreshQueueBar />
      </div>
    </>
  );
}
