"use client";

import { useTranslations } from "next-intl";
import { MetaUsageDistinctResponse } from "@/lib/api/schemas";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export interface MetaUsageFilters {
  route: string;
  service_name: string;
  ad_account_id: string;
  from: string;
  to: string;
  min_cputime: string;
}

export const EMPTY_FILTERS: MetaUsageFilters = {
  route: "",
  service_name: "",
  ad_account_id: "",
  from: "",
  to: "",
  min_cputime: "",
};

interface Props {
  filters: MetaUsageFilters;
  onChange: (next: MetaUsageFilters) => void;
  distinct: MetaUsageDistinctResponse | undefined;
}

// Radix Select não aceita value="" em SelectItem — sentinela interna para "todos".
const ALL = "__all__";

function FilterSelect({ label, value, options, allLabel, onValueChange }: { label: string; value: string; options: string[] | undefined; allLabel: string; onValueChange: (value: string) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select value={value || ALL} onValueChange={(v) => onValueChange(v === ALL ? "" : v)}>
        <SelectTrigger size="sm" className="min-w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options?.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export function MetaUsageFilterBar({ filters, onChange, distinct }: Props) {
  const t = useTranslations("metaUsage.filters");
  const update = (patch: Partial<MetaUsageFilters>) => onChange({ ...filters, ...patch });

  const hasFilters = Object.values(filters).some((v) => v !== "");

  return (
    <div className="rounded-md border border-border p-3 flex flex-wrap items-end gap-3">
      <FilterSelect label={t("route")} value={filters.route} options={distinct?.routes} allLabel={t("allFeminine")} onValueChange={(route) => update({ route })} />
      <FilterSelect label={t("service")} value={filters.service_name} options={distinct?.services} allLabel={t("allMasculine")} onValueChange={(service_name) => update({ service_name })} />
      <FilterSelect label={t("adAccount")} value={filters.ad_account_id} options={distinct?.ad_accounts} allLabel={t("allFeminine")} onValueChange={(ad_account_id) => update({ ad_account_id })} />

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("from")}</span>
        <Input type="datetime-local" size="sm" value={filters.from} onChange={(e) => update({ from: e.target.value })} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("to")}</span>
        <Input type="datetime-local" size="sm" value={filters.to} onChange={(e) => update({ to: e.target.value })} />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">{t("minCpu")}</span>
        <Input type="number" min={0} step={0.1} size="sm" className="w-24" value={filters.min_cputime} onChange={(e) => update({ min_cputime: e.target.value })} />
      </label>

      {hasFilters && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(EMPTY_FILTERS)}>
          {t("clear")}
        </Button>
      )}
    </div>
  );
}
