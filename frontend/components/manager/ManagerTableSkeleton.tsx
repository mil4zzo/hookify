"use client";

import React from "react";
// design-system-exception: direct-skeleton-import - loading chrome espelha a grade densa do manager (mesma exceção do TableContent)
import { Skeleton } from "@/components/ui/skeleton";
import { IconBorderAll, IconDeviceTablet, IconFolder, IconPlayCardA } from "@tabler/icons-react";
import { TabbedWorkspace, TableWorkspace } from "@/components/common/layout";
import { TabbedContentItem, type TabItem } from "@/components/common/TabbedContent";
import { getManagerMetricLabel, type ManagerMetricKey } from "@/lib/metrics";

/**
 * Esqueleto da tela /manager exibido enquanto auth/onboarding não estão prontos
 * (fallback do Suspense e dos gates de autenticação da página).
 *
 * Reproduz a MESMA cromo do ManagerTable em loading (abas + controles + toolbar +
 * tabela "detailed") para que a transição fallback → tabela real seja contínua, sem
 * o salto do skeleton genérico antigo. É puramente apresentacional: não dispara hooks
 * de dados. Os estilos da tabela espelham VARIANT_STYLES.detailed de TableContent.tsx.
 */

// Espelha MANAGER_TABS de ManagerTable.tsx (mantido inline para não acoplar o skeleton
// ao módulo pesado do ManagerTable).
const SKELETON_TABS: TabItem[] = [
  { value: "por-anuncio", label: "Criativos", icon: IconPlayCardA },
  { value: "por-campanha", label: "Por campanha", icon: IconFolder },
  { value: "por-conjunto", label: "Por conjunto", icon: IconBorderAll },
  { value: "individual", label: "Por anúncio", icon: IconDeviceTablet },
];

// Colunas visíveis por padrão sem integração de planilha (DEFAULT_MANAGER_COLUMNS menos
// mqls/cpmql), na ordem de render de buildMetricColumns. Contas com planilha só ganham
// mqls/cpmql depois do load — diferença aceitável para um fallback efêmero.
const SKELETON_METRIC_COLUMNS: ManagerMetricKey[] = [
  "spend",
  "results",
  "cpr",
  "cpc",
  "cplc",
  "cpm",
  "hook",
  "website_ctr",
  "connect_rate",
  "page_conv",
];

const SKELETON_ROW_COUNT = 8;
const NAME_COLUMN_WIDTH = 300;
const METRIC_COLUMN_WIDTH = 100;

const noop = () => {};

function ManagerSkeletonTable() {
  const columns = SKELETON_METRIC_COLUMNS;
  const lastIndex = columns.length - 1;

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <table className="w-full border-separate border-spacing-y-4 text-sm" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: NAME_COLUMN_WIDTH }} />
            {columns.map((id) => (
              <col key={id} style={{ width: METRIC_COLUMN_WIDTH }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="text-text/80">
              <th className="px-4 py-4 text-left text-base font-normal">Anúncio</th>
              {columns.map((id) => (
                <th key={id} className="px-4 py-4 text-center text-base font-normal">
                  {getManagerMetricLabel(id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: SKELETON_ROW_COUNT }).map((_, rowIndex) => (
              <tr key={rowIndex} className="bg-background">
                <td className="rounded-l-md border-y border-l border-border p-4 text-left">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-14 w-14 flex-shrink-0 rounded" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                </td>
                {columns.map((id, colIndex) => (
                  <td key={id} className={`border-y border-border p-4 text-center ${colIndex === lastIndex ? "rounded-r-md border-r" : ""}`}>
                    <Skeleton className="mx-auto h-4 w-16" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ManagerTableSkeleton() {
  // Placeholders dos controles do topo (Colunas / Exibição / Tela cheia).
  const controls = (
    <div className="flex flex-wrap items-stretch justify-start gap-2 md:justify-end">
      <Skeleton className="h-control-default w-full rounded-lg sm:w-[190px]" />
      <Skeleton className="h-control-default w-28 rounded-lg" />
      <Skeleton className="h-control-default w-11 rounded-lg" />
    </div>
  );

  // Placeholders da toolbar (busca + barra de filtros).
  const toolbar = (
    <>
      <Skeleton className="h-9 w-full rounded-none md:max-w-[20rem] md:flex-shrink-0" />
      <div className="flex flex-1 items-center justify-end gap-2">
        <Skeleton className="h-4 w-32 rounded-md" />
        <Skeleton className="h-control-default w-24 rounded-lg" />
      </div>
    </>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <TabbedWorkspace
        value="por-anuncio"
        onValueChange={noop}
        variant="with-controls"
        tabs={SKELETON_TABS}
        controls={controls}
        tabsContainerClassName="flex-col items-stretch gap-3 md:flex-row md:items-center md:gap-4"
        tabsListClassName="w-full overflow-x-auto md:w-fit"
      >
        <TabbedContentItem value="por-anuncio" variant="with-controls">
          <TableWorkspace compact contentClassName="pt-stack-compact" toolbar={toolbar}>
            <ManagerSkeletonTable />
          </TableWorkspace>
        </TabbedContentItem>
      </TabbedWorkspace>
    </div>
  );
}
