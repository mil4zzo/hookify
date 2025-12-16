"use client";

import { EmptyState } from "./States";

interface HookifyWidgetProps {
  // Título principal
  title?: string;
  showTitle?: boolean;
  titleClassName?: string;

  // Estados
  isLoading?: boolean;
  isEmpty?: boolean;
  emptyMessage?: string;
  skeleton?: React.ReactNode;

  // Filtros/Seletores (renderizados à direita do título)
  headerActions?: React.ReactNode;

  // Conteúdo - pode ser qualquer coisa (incluindo múltiplos widgets)
  children: React.ReactNode;

  // Espaçamento entre seções
  contentSpacing?: string;
}

export function HookifyWidget({
  title,
  showTitle = true,
  titleClassName = "text-xl font-normal",
  isLoading = false,
  isEmpty = false,
  emptyMessage,
  skeleton,
  headerActions,
  children,
  contentSpacing = "space-y-6",
}: HookifyWidgetProps) {
  if (isLoading) {
    return skeleton || null;
  }

  if (isEmpty) {
    return (
      <div className="py-12">
        <EmptyState message={emptyMessage || "Sem dados disponíveis."} />
      </div>
    );
  }

  // Sempre renderizar o header quando há título ou actions para manter altura consistente
  const hasHeader = (showTitle && title) || headerActions;

  return (
    <div className={contentSpacing}>
      {/* Header com título e ações - sempre renderizado quando há título ou actions */}
      {hasHeader && (
        <div className="flex items-center justify-between gap-4 min-h-10">
          {showTitle && title ? (
            <h2 className={titleClassName}>{title}</h2>
          ) : (
            // Espaçador invisível para manter altura quando não há título mas há actions
            <div className="flex-1" />
          )}
          {headerActions ? (
            <div className="flex items-center gap-2">{headerActions}</div>
          ) : (
            // Espaçador invisível para manter altura quando não há actions mas há título
            <div className="flex-shrink-0" />
          )}
        </div>
      )}

      {/* Conteúdo - pode ser qualquer coisa */}
      {children}
    </div>
  );
}

