"use client";

import { useState, useMemo, ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent, pointerWithin } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, horizontalListSortingStrategy, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { RankingsItem, RankingsResponse } from "@/lib/api/schemas";
import { Modal } from "@/components/common/Modal";
import { AdDetailsDialog } from "@/components/ads/AdDetailsDialog";
import { KanbanScrollContainer } from "@/components/common/KanbanScrollContainer";
import { useKanbanColumnOrder } from "@/lib/hooks/useKanbanColumnOrder";

/**
 * Configuração de uma coluna do Kanban
 */
export interface KanbanColumnConfig<T extends string> {
  id: T;
  title: string;
  items: any[];
  averageValue?: number | null;
  emptyMessage?: string;
  formatAverage?: (value: number | null | undefined) => string;
  /** Renderiza o conteúdo da coluna (componente de coluna completo) */
  renderColumn: (config: KanbanColumnConfig<T> & { onAdClick?: (ad: RankingsItem, openVideo?: boolean) => void }, index: number) => ReactNode;
  /** Tooltip opcional para o header da coluna */
  tooltip?: {
    title: string;
    content?: ReactNode;
  };
}

/**
 * Props do BaseKanbanWidget
 */
export interface BaseKanbanWidgetProps<T extends string> {
  /** Chave única para armazenar ordem no localStorage */
  storageKey: string;
  /** Ordem padrão das colunas */
  defaultColumnOrder: readonly T[];
  /** Configurações de cada coluna */
  columnConfigs: KanbanColumnConfig<T>[];
  /** Colunas ativas (opcional - se não fornecido, todas as colunas configuradas são mostradas) */
  activeColumns?: Set<T>;
  /** Habilitar drag and drop (padrão: true) */
  enableDrag?: boolean;
  /** Props para o modal de detalhes do anúncio */
  modalProps?: {
    dateStart?: string;
    dateStop?: string;
    actionType: string;
    availableConversionTypes?: string[];
    averages?: RankingsResponse["averages"];
  };
  /** Callback quando um anúncio é clicado */
  onAdClick?: (ad: RankingsItem, openVideo?: boolean) => void;
  /** Largura aproximada de cada item para scroll (padrão: 320) */
  itemWidth?: number;
  /** Número de itens para rolar por vez (padrão: 1) */
  scrollItems?: number;
  /** Direção das colunas do Kanban (padrão: horizontal) */
  orientation?: "horizontal" | "vertical";
}

/**
 * Widget base de Kanban reutilizável que unifica GemsWidget e InsightsKanbanWidget.
 * Suporta drag and drop, tooltips, visibilidade de colunas e persistência de ordem.
 */
export function BaseKanbanWidget<T extends string>({ storageKey, defaultColumnOrder, columnConfigs, activeColumns, enableDrag = true, modalProps, onAdClick, itemWidth = 320, scrollItems = 1, orientation = "horizontal" }: BaseKanbanWidgetProps<T>) {
  const [selectedAd, setSelectedAd] = useState<RankingsItem | null>(null);
  const [openInVideoTab, setOpenInVideoTab] = useState(false);
  const { columnOrder, setColumnOrder } = useKanbanColumnOrder(storageKey, defaultColumnOrder);
  const isHorizontal = orientation === "horizontal";

  // Determinar colunas visíveis
  const columnsToShowArray = useMemo(() => {
    if (activeColumns && activeColumns.size > 0) {
      return Array.from(activeColumns);
    }
    return [...defaultColumnOrder];
  }, [activeColumns, defaultColumnOrder]);

  const columnsToShowSet = useMemo(() => new Set<T>(columnsToShowArray), [columnsToShowArray]);

  // Ordenar colunas baseado na ordem salva e colunas ativas
  const orderedColumns = useMemo(() => {
    const baseOrder = columnOrder.length > 0 ? columnOrder : [...defaultColumnOrder];
    const filtered = baseOrder.filter((column) => columnsToShowSet.has(column));
    const missing = columnsToShowArray.filter((column) => !filtered.includes(column));
    return [...filtered, ...missing];
  }, [columnOrder, columnsToShowArray, columnsToShowSet, defaultColumnOrder]);

  // Configurar sensores para drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Handler para quando o drag termina
  const handleDragEnd = (event: DragEndEvent) => {
    if (!enableDrag) return;

    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    setColumnOrder((prev) => {
      const visibleFromPrev = prev.filter((column) => columnsToShowSet.has(column));
      const missing = columnsToShowArray.filter((column) => !visibleFromPrev.includes(column));
      const currentVisible = [...visibleFromPrev, ...missing];
      const oldIndex = currentVisible.indexOf(active.id as T);
      const newIndex = currentVisible.indexOf(over.id as T);

      if (oldIndex === -1 || newIndex === -1) {
        return prev;
      }

      const newVisibleOrder = arrayMove(currentVisible, oldIndex, newIndex);
      const hiddenColumns = prev.filter((column) => !currentVisible.includes(column));
      return [...newVisibleOrder, ...hiddenColumns];
    });
  };

  // Handler para clique em anúncio
  const handleAdClickInternal = (ad: RankingsItem, openVideo?: boolean) => {
    if (onAdClick) {
      onAdClick(ad, openVideo);
    } else {
      setSelectedAd(ad);
      setOpenInVideoTab(openVideo || false);
    }
  };

  // Preparar averages para o AdDetailsDialog
  const dialogAverages = modalProps?.averages
    ? {
        hook: modalProps.averages.hook ?? null,
        scroll_stop: modalProps.averages.scroll_stop ?? null,
        ctr: modalProps.averages.ctr ?? null,
        website_ctr: modalProps.averages.website_ctr ?? null,
        connect_rate: modalProps.averages.connect_rate ?? null,
        cpm: modalProps.averages.cpm ?? null,
        cpr: modalProps.actionType && modalProps.averages.per_action_type?.[modalProps.actionType] && typeof modalProps.averages.per_action_type[modalProps.actionType].cpr === "number" ? modalProps.averages.per_action_type[modalProps.actionType].cpr : null,
        page_conv: modalProps.actionType && modalProps.averages.per_action_type?.[modalProps.actionType] && typeof modalProps.averages.per_action_type[modalProps.actionType].page_conv === "number" ? modalProps.averages.per_action_type[modalProps.actionType].page_conv : null,
      }
    : undefined;

  // Obter configuração de coluna por ID
  const getColumnConfig = (columnId: T): KanbanColumnConfig<T> | undefined => {
    return columnConfigs.find((config) => config.id === columnId);
  };

  // Renderizar conteúdo do Kanban
  const renderKanbanContent = () => {
    const columnsInner = (
      <div className={isHorizontal ? "kanban-columns" : "kanban-columns-vertical"}>
        {orderedColumns.map((columnId, index) => {
          const config = getColumnConfig(columnId);
          if (!config) return null;
          // Passar handleAdClickInternal como parte do config para os renderColumn
          const configWithHandler = {
            ...config,
            onAdClick: handleAdClickInternal,
          };
          return <div key={columnId}>{config.renderColumn(configWithHandler, index)}</div>;
        })}
      </div>
    );

    const content = isHorizontal ? (
      <KanbanScrollContainer itemWidth={itemWidth} scrollItems={scrollItems}>
        {columnsInner}
      </KanbanScrollContainer>
    ) : (
      <div className="w-full overflow-y-auto custom-scrollbar">{columnsInner}</div>
    );

    if (enableDrag) {
      return (
        <DndContext
          sensors={sensors}
          // Usar pointerWithin para melhorar a detecção de colisão em colunas de alturas diferentes.
          // Isso evita ter que mover o mouse muito para cima/baixo para reordenar.
          collisionDetection={pointerWithin}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={orderedColumns} strategy={isHorizontal ? horizontalListSortingStrategy : verticalListSortingStrategy}>
            {content}
          </SortableContext>
        </DndContext>
      );
    }

    return content;
  };

  return (
    <>
      {renderKanbanContent()}

      {/* Modal com detalhes do anúncio (apenas se onAdClick não foi fornecido) */}
      {!onAdClick && modalProps && (
        <Modal
          isOpen={!!selectedAd}
          onClose={() => {
            setSelectedAd(null);
            setOpenInVideoTab(false);
          }}
          size="4xl"
          padding="md"
        >
          {selectedAd && <AdDetailsDialog ad={selectedAd} groupByAdName={false} dateStart={modalProps.dateStart} dateStop={modalProps.dateStop} actionType={modalProps.actionType} availableConversionTypes={modalProps.availableConversionTypes} initialTab={openInVideoTab ? "video" : "overview"} averages={dialogAverages} />}
        </Modal>
      )}
    </>
  );
}
