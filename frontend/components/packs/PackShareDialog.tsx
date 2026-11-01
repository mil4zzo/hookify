"use client";

import { useTranslations } from "next-intl";
import { getAppLocale } from "@/lib/i18n/locale";
import { useCallback, useEffect, useState } from "react";
import { IconLoader2, IconTrash, IconUsers } from "@tabler/icons-react";

import { AppDialog } from "@/components/common/AppDialog";
import { Button } from "@/components/ui/button";
import { InlineNotice } from "@/components/common/States";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api/endpoints";
import { showError, showSuccess } from "@/lib/utils/toast";
import type { AdsPack } from "@/lib/types";

interface PackShareDialogProps {
  pack: AdsPack;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ShareRow {
  id: string;
  grantee_id: string;
  display_name: string | null;
  role: "editor" | "viewer";
  created_at: string;
  /** Preenchido = o acesso vem de uma pasta compartilhada (migration 181): somente leitura aqui. */
  source_folder_id: string | null;
  source_folder_name: string | null;
}

/**
 * Avatar de iniciais + nome + detalhe. Uma lista de pessoas só com o nome lia chapada;
 * o círculo e a segunda linha dão o ritmo que o olho usa para percorrer a lista.
 * Neutro de propósito: um círculo de cor sólida por membro pesaria mais que o conteúdo.
 */
export function MemberIdentity({ name, fallback, since }: { name: string | null; fallback: string; since?: string }) {
  const ts = useTranslations("packs.share");
  const label = name?.trim() || fallback;
  const words = label.split(/\s+/).filter(Boolean);
  const initials = (words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : label.slice(0, 2)).toUpperCase();
  const sinceDate = since ? new Date(since) : null;
  const sinceLabel = sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate.toLocaleDateString(getAppLocale()) : null;

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface-3 text-xs font-semibold text-foreground">
        {initials}
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{label}</div>
        {sinceLabel && <div className="text-2xs text-muted-foreground">{ts("accessSince", { date: sinceLabel })}</div>}
      </div>
    </div>
  );
}

/**
 * Convite e membros de um pack — SÓ O DONO abre isto (decisão travada: sem
 * repasse a terceiros; o backend responde 404 para os demais).
 *
 * Convite por e-mail EXATO de quem já tem conta no Hookify: busca parcial
 * transformaria o app num oráculo de e-mails cadastrados. O dado nunca é
 * copiado — o convidado lê o silo do dono ao vivo, com a credencial do dono.
 */
export function PackShareDialog({ pack, open, onOpenChange }: PackShareDialogProps) {
  const t = useTranslations("packs.packShare");
  const ts = useTranslations("packs.share");
  const tc = useTranslations("packs.common");
  const roleLabel = { editor: ts("roleEditor"), viewer: ts("roleViewer") };
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"editor" | "viewer">("editor");
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [lookupResult, setLookupResult] = useState<{ user_id: string; display_name: string | null } | "not_found" | null>(null);

  const [shares, setShares] = useState<ShareRow[]>([]);
  const [isLoadingShares, setIsLoadingShares] = useState(false);
  const [busyGranteeId, setBusyGranteeId] = useState<string | null>(null);

  const loadShares = useCallback(async () => {
    setIsLoadingShares(true);
    try {
      const res = await api.packShares.listShares(pack.id);
      setShares(res.shares || []);
    } catch (e) {
      showError(e as Error);
    } finally {
      setIsLoadingShares(false);
    }
  }, [pack.id]);

  useEffect(() => {
    if (!open) return;
    setEmail("");
    setLookupResult(null);
    setInviteRole("editor");
    void loadShares();
  }, [open, loadShares]);

  const handleLookup = async () => {
    const normalized = email.trim().toLowerCase();
    if (!normalized.includes("@")) {
      showError({ message: ts("invalidEmail") });
      return;
    }
    setIsLookingUp(true);
    setLookupResult(null);
    try {
      const res = await api.packShares.lookupUser(normalized);
      if (res.found && res.user_id) {
        setLookupResult({ user_id: res.user_id, display_name: res.display_name ?? null });
      } else {
        setLookupResult("not_found");
      }
    } catch (e) {
      showError(e as Error);
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleInvite = async () => {
    if (!lookupResult || lookupResult === "not_found") return;
    setIsInviting(true);
    try {
      await api.packShares.create(pack.id, lookupResult.user_id, inviteRole);
      showSuccess(t("shared", { who: lookupResult.display_name || email.trim() }));
      setEmail("");
      setLookupResult(null);
      await loadShares();
    } catch (e) {
      showError(e as Error);
    } finally {
      setIsInviting(false);
    }
  };

  const handleChangeRole = async (granteeId: string, role: "editor" | "viewer") => {
    setBusyGranteeId(granteeId);
    try {
      await api.packShares.updateRole(pack.id, granteeId, role);
      setShares((prev) => prev.map((s) => (s.grantee_id === granteeId ? { ...s, role } : s)));
    } catch (e) {
      showError(e as Error);
    } finally {
      setBusyGranteeId(null);
    }
  };

  const handleRevoke = async (share: ShareRow) => {
    const who = share.display_name || ts("thisMember");
    if (!confirm(t("revokeConfirm", { who, pack: pack.name }))) return;
    setBusyGranteeId(share.grantee_id);
    try {
      await api.packShares.revoke(pack.id, share.grantee_id);
      setShares((prev) => prev.filter((s) => s.grantee_id !== share.grantee_id));
      showSuccess(ts("revoked"));
    } catch (e) {
      showError(e as Error);
    } finally {
      setBusyGranteeId(null);
    }
  };

  return (
    <AppDialog isOpen={open} onClose={() => onOpenChange(false)} size="lg" title={t("title")}>
      <div className="space-y-6">
        <header className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <IconUsers className="h-5 w-5" />
            {t("heading", { name: pack.name })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t.rich("intro", { b: (c) => <span className="font-medium text-foreground">{c}</span> })}
          </p>
        </header>

        {/* ── Convite ── */}
        <section className="space-y-2">
          <label className="text-sm font-medium text-foreground">{ts("inviteByEmail")}</label>
          <div className="flex gap-2">
            <Input
              type="email"
              size="sm"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setLookupResult(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleLookup();
              }}
              placeholder={ts("emailPlaceholder")}
              disabled={isLookingUp || isInviting}
            />
            <Button size="sm" variant="outline" onClick={handleLookup} disabled={isLookingUp || !email.trim()}>
              {isLookingUp ? <IconLoader2 className="h-4 w-4 animate-spin" /> : ts("search")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {ts("exactEmail")}
          </p>

          {lookupResult === "not_found" && (
            <InlineNotice tone="info" title={ts("notFoundTitle")}>
              {ts("notFoundBody")}
            </InlineNotice>
          )}

          {lookupResult && lookupResult !== "not_found" && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-2 p-3">
              <MemberIdentity name={lookupResult.display_name} fallback={email.trim()} />
              <div className="flex items-center gap-2">
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "editor" | "viewer")}>
                  <SelectTrigger size="sm" className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">{ts("roleEditor")}</SelectItem>
                    <SelectItem value="viewer">{ts("roleViewer")}</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={handleInvite} disabled={isInviting}>
                  {isInviting ? <IconLoader2 className="h-4 w-4 animate-spin" /> : ts("invite")}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* ── Membros ── */}
        <section className="space-y-2">
          <label className="text-sm font-medium text-foreground">{t("members")}</label>
          {isLoadingShares ? (
            <div className="flex items-center justify-center py-6">
              <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : shares.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("noMembers")}</p>
          ) : (
            <div className="divide-y divide-border rounded-md border border-border bg-surface-2">
              {shares.map((share) => (
                <div key={share.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <MemberIdentity name={share.display_name} fallback={share.grantee_id.slice(0, 8)} since={share.created_at} />
                  {share.source_folder_id ? (
                    // Mantido pelo banco a partir da pasta: mexer aqui seria desfeito na próxima
                    // mudança dela. O caminho para tirar é a pasta (ou o pack sair dela).
                    <span className="text-xs text-muted-foreground" title={t("viaFolderTitle")}>
                      {t("viaFolder", { role: roleLabel[share.role], folder: share.source_folder_name ?? t("folderFallback") })}
                    </span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Select
                        value={share.role}
                        onValueChange={(v) => void handleChangeRole(share.grantee_id, v as "editor" | "viewer")}
                        disabled={busyGranteeId === share.grantee_id}
                      >
                        <SelectTrigger size="sm" className="w-28">
                          <SelectValue>{roleLabel[share.role]}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="editor">{ts("roleEditor")}</SelectItem>
                          <SelectItem value="viewer">{ts("roleViewer")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => void handleRevoke(share)}
                        disabled={busyGranteeId === share.grantee_id}
                        aria-label={t("revokeAria", { name: share.display_name || ts("member") })}
                      >
                        <IconTrash className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="flex justify-end border-t border-border pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tc("close")}
          </Button>
        </footer>
      </div>
    </AppDialog>
  );
}
