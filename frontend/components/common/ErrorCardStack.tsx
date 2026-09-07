"use client";

import React from "react";
import { ProgressToastCard } from "@/components/common/ProgressToastCard";
import { useErrorCardsStore } from "@/lib/store/errorCards";
import { getTerminalContextMeta } from "@/lib/utils/toast";

/**
 * Os cards de erro terminal, no mesmo canto da pilha de progresso mas em bloco próprio —
 * logo abaixo do toast em andamento, com folga entre os dois.
 *
 * Fora do sonner de propósito (ver lib/store/errorCards): dentro da pilha fechada o erro
 * era soterrado pelas atualizações seguintes do lote. O card é o MESMO ProgressToastCard
 * terminal de antes; só o dono da posição mudou.
 */
export function ErrorCardStack() {
  const cards = useErrorCardsStore((state) => state.cards);
  const dismiss = useErrorCardsStore((state) => state.dismiss);

  if (cards.length === 0) return null;

  return (
    // Vários erros num lote grande: rola dentro do próprio bloco em vez de crescer
    // até sair da tela — o mesmo problema que a pilha tinha.
    <div
      role="alert"
      aria-live="assertive"
      className="flex max-h-[60vh] flex-col items-end gap-2 overflow-y-auto overflow-x-hidden"
    >
      {cards.map((card) => {
        const { stageContext, icon } = getTerminalContextMeta(card.context);
        return (
          <div key={card.id} className="animate-in fade-in slide-in-from-bottom-2">
            <ProgressToastCard
              packName={card.packName}
              progress={0}
              currentStep={1}
              totalSteps={1}
              stagedContent={{
                stageLabel: "Falhou",
                stageTitle: "Erro",
                dynamicLine: card.message,
                stageContext,
                diagnosticLine: card.diagnosticLine,
              }}
              icon={icon}
              inlineError
              terminal
              animated={false}
              onCancel={() => dismiss(card.id)}
            />
          </div>
        );
      })}
    </div>
  );
}
