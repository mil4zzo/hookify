"use client";

import { ReactNode, useRef, useState, useEffect, useCallback } from "react";

interface KanbanScrollContainerProps {
  children: ReactNode;
  /** Largura aproximada de cada item para calcular o scroll (em pixels) - mantido para compatibilidade, mas não usado */
  itemWidth?: number;
  /** Número de itens para rolar por vez (padrão: 2) - mantido para compatibilidade, mas não usado */
  scrollItems?: number;
  /** Classe CSS adicional para o container */
  className?: string;
}

/**
 * Container para kanban com scroll horizontal quando necessário.
 * As colunas se ajustam ao espaço disponível usando flexbox, mas permitem scroll quando há muitas colunas.
 * Inclui gradientes laterais para indicar quando há mais conteúdo para rolar.
 */
export function KanbanScrollContainer({ children, className }: KanbanScrollContainerProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Função para verificar se pode rolar
  const checkScrollability = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollContainerRef.current;
    setCanScrollLeft(scrollLeft > 0);
    setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1);
  }, []);

  // Verificar scrollabilidade ao montar e quando o tamanho mudar
  useEffect(() => {
    // Aguardar um frame para garantir que o DOM foi renderizado
    const timeoutId = setTimeout(() => {
      checkScrollability();
    }, 0);

    const container = scrollContainerRef.current;
    if (!container) return;

    // Verificar quando o scroll muda
    container.addEventListener("scroll", checkScrollability);

    // Verificar quando o tamanho do container muda
    const resizeObserver = new ResizeObserver(() => {
      checkScrollability();
    });
    resizeObserver.observe(container);

    return () => {
      clearTimeout(timeoutId);
      container.removeEventListener("scroll", checkScrollability);
      resizeObserver.disconnect();
    };
  }, [checkScrollability]);

  return (
    <div className="relative">
      {/* Gradiente lateral esquerdo */}
      {canScrollLeft && <div className="absolute left-0 top-0 bottom-0 w-20 z-[5] pointer-events-none bg-gradient-to-r from-background via-background/80 to-transparent" />}

      {/* Container de scroll */}
      <div ref={scrollContainerRef} className={`w-full overflow-x-auto overflow-y-visible scroll-smooth [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] ${className || ""}`}>
        {children}
      </div>

      {/* Gradiente lateral direito */}
      {canScrollRight && <div className="absolute right-0 top-0 bottom-0 w-20 z-[5] pointer-events-none bg-gradient-to-l from-background via-background/80 to-transparent" />}
    </div>
  );
}
