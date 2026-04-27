"use client";

import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageContainer } from "@/components/common/PageContainer";
import { PageIcon } from "@/lib/utils/pageIcon";
import { StandardCard } from "@/components/common/StandardCard";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { IconChevronUp, IconChevronDown, IconSelector, IconShieldLock, IconUser, IconDiamond, IconShield } from "@tabler/icons-react";
import { api, type AdminUser } from "@/lib/api/endpoints";
import { showSuccess, showError } from "@/lib/utils/toast";

type SortKey = keyof AdminUser;
type SortDir = "asc" | "desc";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (col !== sortKey) return <IconSelector className="inline ml-1 opacity-30" size={12} />;
  return sortDir === "asc"
    ? <IconChevronUp className="inline ml-1 opacity-70" size={12} />
    : <IconChevronDown className="inline ml-1 opacity-70" size={12} />;
}

const TIER_STYLE: Record<string, { icon: React.ElementType; className: string }> = {
  standard: { icon: IconUser,    className: "text-muted-foreground" },
  insider:  { icon: IconDiamond, className: "text-primary" },
  admin:    { icon: IconShield,  className: "text-attention" },
};

function TierBadge({ tier }: { tier: string }) {
  const { icon: Icon, className } = TIER_STYLE[tier] ?? TIER_STYLE.standard;
  return (
    <div className={`flex items-center gap-1.5 text-xs font-medium capitalize whitespace-nowrap ${className}`}>
      <Icon size={13} className="shrink-0" />
      {tier}
    </div>
  );
}

function TierSelect({ user, onUpdate }: { user: AdminUser; onUpdate: (userId: string, tier: string) => void }) {
  return (
    <Select
      value={user.tier}
      onValueChange={(value) => onUpdate(user.user_id, value)}
    >
      <SelectTrigger className="w-32 h-7 text-xs flex items-center gap-1">
        <TierBadge tier={user.tier} />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(TIER_STYLE).map(([tier, { icon: Icon, className }]) => (
          <SelectItem key={tier} value={tier}>
            <div className={`flex items-center gap-1.5 text-xs font-medium capitalize whitespace-nowrap ${className}`}>
              <Icon size={13} className="shrink-0" />
              {tier}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const COLUMNS: { label: string; key: SortKey }[] = [
  { label: "Email", key: "email" },
  { label: "Nome", key: "name" },
  { label: "Tier", key: "tier" },
  { label: "Meta Account", key: "meta_email" },
  { label: "Packs", key: "packs_count" },
  { label: "Criado em", key: "created_at" },
  { label: "Expira em", key: "expires_at" },
  { label: "Atualizado em", key: "updated_at" },
  { label: "Concedido por", key: "granted_by" },
];

function compareValues(a: AdminUser, b: AdminUser, key: SortKey, dir: SortDir): number {
  const va = a[key] ?? "";
  const vb = b[key] ?? "";
  const cmp = va < vb ? -1 : va > vb ? 1 : 0;
  return dir === "asc" ? cmp : -cmp;
}

export default function AdminPage() {
  const queryClient = useQueryClient();
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.admin.listUsers(),
  });

  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => compareValues(a, b, sortKey, sortDir)),
    [users, sortKey, sortDir]
  );

  const mutation = useMutation({
    mutationFn: ({ userId, tier }: { userId: string; tier: string }) =>
      api.admin.updateUserTier(userId, tier as "standard" | "insider" | "admin"),
    onSuccess: (updated) => {
      queryClient.setQueryData<AdminUser[]>(["admin", "users"], (prev) =>
        prev?.map((u) => (u.user_id === updated.user_id ? { ...u, tier: updated.tier } : u)) ?? []
      );
      showSuccess("Tier atualizado com sucesso.");
    },
    onError: () => showError("Falha ao atualizar tier."),
    onSettled: () => setUpdatingId(null),
  });

  function handleTierChange(userId: string, tier: string) {
    setUpdatingId(userId);
    mutation.mutate({ userId, tier });
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <PageContainer
      variant="analytics"
      title="Admin"
      description="Gerenciamento de usuários e tiers"
      icon={<PageIcon icon={IconShieldLock} />}
    >
      <StandardCard padding="none">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {COLUMNS.map(({ label, key }) => (
                  <th
                    key={key}
                    onClick={() => handleSort(key)}
                    className="text-left px-4 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:text-foreground transition-colors"
                  >
                    {label}
                    <SortIcon col={key} sortKey={sortKey} sortDir={sortDir} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="border-b border-border-50">
                    {Array.from({ length: 9 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 w-24 rounded bg-muted animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              ) : (
                sortedUsers.map((user) => (
                  <tr key={user.user_id} className="border-b border-border-50 hover:bg-input-30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs">{user.email}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{user.name}</td>
                    <td className="px-4 py-3">
                      {updatingId === user.user_id ? (
                        <div className="h-7 w-28 rounded bg-muted animate-pulse" />
                      ) : (
                        <TierSelect user={user} onUpdate={handleTierChange} />
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {user.meta_email ?? <span className="text-muted-foreground/50">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">{user.packs_count}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground text-xs">
                      {user.created_at ? fmt(user.created_at) : "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground text-xs">
                      {user.expires_at ? fmt(user.expires_at) : <Badge variant="outline" className="text-[10px]">Never</Badge>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground text-xs">
                      {user.updated_at ? fmt(user.updated_at) : "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {user.granted_by ? user.granted_by.slice(0, 8) + "…" : <span className="text-muted-foreground/50">—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </StandardCard>
    </PageContainer>
  );
}
