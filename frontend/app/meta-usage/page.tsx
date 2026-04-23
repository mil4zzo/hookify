"use client";

import { useMemo, useState } from "react";
import { IconGauge } from "@tabler/icons-react";

import { PageContainer } from "@/components/common/PageContainer";
import { useAppAuthReady } from "@/lib/hooks/useAppAuthReady";
import {
  useMetaUsageCalls,
  useMetaUsageDistinct,
  useMetaUsageSummary,
} from "@/lib/api/hooks";
import { MetaUsageCallsParams } from "@/lib/api/schemas";
import { QuotaGauges } from "@/components/meta-usage/QuotaGauges";
import {
  EMPTY_FILTERS,
  MetaUsageFilterBar,
  MetaUsageFilters,
} from "@/components/meta-usage/MetaUsageFilterBar";
import { MetaUsageTable } from "@/components/meta-usage/MetaUsageTable";

const PAGE_SIZE = 50;

function filtersToParams(filters: MetaUsageFilters, page: number): MetaUsageCallsParams {
  const params: MetaUsageCallsParams = {
    page,
    page_size: PAGE_SIZE,
  };
  if (filters.route) params.route = filters.route;
  if (filters.service_name) params.service_name = filters.service_name;
  if (filters.ad_account_id) params.ad_account_id = filters.ad_account_id;
  if (filters.from) params.from = new Date(filters.from).toISOString();
  if (filters.to) params.to = new Date(filters.to).toISOString();
  if (filters.min_cputime) {
    const n = Number(filters.min_cputime);
    if (!Number.isNaN(n)) params.min_cputime = n;
  }
  return params;
}

export default function MetaUsagePage() {
  const { isAuthorized } = useAppAuthReady();

  const [filters, setFilters] = useState<MetaUsageFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  const callsParams = useMemo(() => filtersToParams(filters, page), [filters, page]);

  const summary = useMetaUsageSummary(isAuthorized);
  const distinct = useMetaUsageDistinct(isAuthorized);
  const calls = useMetaUsageCalls(callsParams, isAuthorized);

  const handleFiltersChange = (next: MetaUsageFilters) => {
    setFilters(next);
    setPage(1);
  };

  return (
    <PageContainer
      title="Meta Usage"
      icon={<IconGauge className="h-5 w-5" />}
      description="Monitore o consumo da Meta Graph API por rota, serviço e ad account."
    >
      <div className="space-y-5">
        <QuotaGauges summary={summary.data} isLoading={summary.isLoading} />

        <MetaUsageFilterBar
          filters={filters}
          onChange={handleFiltersChange}
          distinct={distinct.data}
        />

        <MetaUsageTable
          items={calls.data?.items ?? []}
          isLoading={calls.isLoading}
          total={calls.data?.total ?? null}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      </div>
    </PageContainer>
  );
}
