"use client";

import { MetaUsageDistinctResponse } from "@/lib/api/schemas";

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

const selectClass =
  "bg-transparent border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-brand";
const inputClass = selectClass;

export function MetaUsageFilterBar({ filters, onChange, distinct }: Props) {
  const update = (patch: Partial<MetaUsageFilters>) => onChange({ ...filters, ...patch });

  const hasFilters = Object.values(filters).some((v) => v !== "");

  return (
    <div className="rounded border border-border p-3 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Rota</span>
        <select
          className={selectClass}
          value={filters.route}
          onChange={(e) => update({ route: e.target.value })}
        >
          <option value="">Todas</option>
          {distinct?.routes.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Serviço</span>
        <select
          className={selectClass}
          value={filters.service_name}
          onChange={(e) => update({ service_name: e.target.value })}
        >
          <option value="">Todos</option>
          {distinct?.services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Ad account</span>
        <select
          className={selectClass}
          value={filters.ad_account_id}
          onChange={(e) => update({ ad_account_id: e.target.value })}
        >
          <option value="">Todas</option>
          {distinct?.ad_accounts.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">De</span>
        <input
          type="datetime-local"
          className={inputClass}
          value={filters.from}
          onChange={(e) => update({ from: e.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Até</span>
        <input
          type="datetime-local"
          className={inputClass}
          value={filters.to}
          onChange={(e) => update({ to: e.target.value })}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">CPU mín. %</span>
        <input
          type="number"
          min={0}
          step={0.1}
          className={inputClass + " w-24"}
          value={filters.min_cputime}
          onChange={(e) => update({ min_cputime: e.target.value })}
        />
      </label>

      {hasFilters && (
        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
          onClick={() => onChange(EMPTY_FILTERS)}
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
