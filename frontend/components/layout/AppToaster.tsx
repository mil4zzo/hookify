"use client";

import React from "react";
import { Toaster } from "sonner";
import { useRefreshQueueStore, selectQueuedCount } from "@/lib/store/refreshQueue";
import { RefreshQueueBar, REFRESH_QUEUE_BAR_SPACE } from "@/components/common/RefreshQueueBar";

/** VIEWPORT_OFFSET do sonner (constante interna, 32px). A barra usa o mesmo valor para alinhar. */
const TOASTER_BASE_OFFSET = 32;
/** Idem para telas pequenas, onde o sonner usa --mobile-offset-*. */
const TOASTER_BASE_MOBILE_OFFSET = 16;

/**
 * Largura da lista de toasts, igualada à do card (w-[22rem] no ProgressToastCard).
 * O padrão do sonner é 356px e os cards são unstyled com width auto — a lista ficava 4px
 * mais larga que o card, e o placar (que alinha pelo card) parecia torto. O `style` do
 * Toaster é aplicado depois das vars do sonner, então isto vence.
 */
const TOASTER_STYLE = { "--width": "22rem" } as React.CSSProperties;

/**
 * Toaster do app + o placar do lote de atualizações.
 *
 * Client component porque o offset da pilha depende do estado do lote: quando o placar
 * aparece embaixo, os toasts sobem para não ficarem por cima dele. Sonner renderiza uma
 * lista por posição, então o card de erro (top-right) convive com a pilha de progresso
 * (bottom-right) neste mesmo Toaster.
 *
 * expand={false}: a pilha fica fechada, em baralho — com um pack por card e a fila serial,
 * 12 atualizações abertas ao mesmo tempo passavam de 1.500px e saíam da tela.
 */
export function AppToaster() {
  const hasQueue = useRefreshQueueStore((state) => selectQueuedCount(state) > 0);
  const bottomOffset = TOASTER_BASE_OFFSET + (hasQueue ? REFRESH_QUEUE_BAR_SPACE : 0);
  const bottomMobileOffset = TOASTER_BASE_MOBILE_OFFSET + (hasQueue ? REFRESH_QUEUE_BAR_SPACE : 0);

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
        offset={{ bottom: bottomOffset }}
        mobileOffset={{ bottom: bottomMobileOffset }}
        // Sem isto a duração é tempo de relógio: um toast disparado com a aba
        // em segundo plano nasce e morre sem o usuário ver. Com a prop, o timer
        // pausa enquanto document.hidden e retoma o restante ao voltar.
        pauseWhenPageIsHidden
      />
      <RefreshQueueBar />
    </>
  );
}
