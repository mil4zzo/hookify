"use client";

import { useCallback, useEffect, useState } from "react";
import { IconLoader2, IconMail, IconTrash, IconUsers } from "@tabler/icons-react";

import { AppDialog } from "@/components/common/AppDialog";
import { Button } from "@/components/ui/button";
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
}

const ROLE_LABEL: Record<"editor" | "viewer", string> = {
  editor: "Editor",
  viewer: "Leitura",
};

/**
 * Convite e membros de um pack — SÓ O DONO abre isto (decisão travada: sem
 * repasse a terceiros; o backend responde 404 para os demais).
 *
 * Convite por e-mail EXATO de quem já tem conta no Hookify: busca parcial
 * transformaria o app num oráculo de e-mails cadastrados. O dado nunca é
 * copiado — o convidado lê o silo do dono ao vivo, com a credencial do dono.
 */
export function PackShareDialog({ pack, open, onOpenChange }: PackShareDialogProps) {
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
      showError({ message: "Informe um e-mail válido." });
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
      showSuccess(`Pack compartilhado com ${lookupResult.display_name || email.trim()}.`);
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
    const who = share.display_name || "este membro";
    if (!confirm(`Revogar o acesso de ${who} ao pack "${pack.name}"?`)) return;
    setBusyGranteeId(share.grantee_id);
    try {
      await api.packShares.revoke(pack.id, share.grantee_id);
      setShares((prev) => prev.filter((s) => s.grantee_id !== share.grantee_id));
      showSuccess("Acesso revogado.");
    } catch (e) {
      showError(e as Error);
    } finally {
      setBusyGranteeId(null);
    }
  };

  return (
    <AppDialog isOpen={open} onClose={() => onOpenChange(false)} size="lg" title="Compartilhar pack">
      <div className="space-y-6">
        <header className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text">
            <IconUsers className="h-5 w-5" />
            Compartilhar «{pack.name}»
          </h2>
          <p className="text-sm text-muted-foreground">
            O convidado vê e analisa este pack ao vivo — sem copiar dados e sem precisar
            conectar o Facebook. <span className="font-medium text-text">Editor</span> também
            atualiza e calibra os critérios; <span className="font-medium text-text">Leitura</span> só
            consulta.
          </p>
        </header>

        {/* ── Convite ── */}
        <section className="space-y-2">
          <label className="text-sm font-medium text-text">Convidar por e-mail</label>
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
              placeholder="email@exemplo.com"
              disabled={isLookingUp || isInviting}
            />
            <Button size="sm" variant="outline" onClick={handleLookup} disabled={isLookingUp || !email.trim()}>
              {isLookingUp ? <IconLoader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
            </Button>
          </div>
          <p className="text-2xs text-muted-foreground">
            E-mail exato de quem já tem conta no Hookify.
          </p>

          {lookupResult === "not_found" && (
            <p className="flex items-center gap-2 rounded-md border border-border bg-background p-3 text-xs text-muted-foreground">
              <IconMail className="h-4 w-4 shrink-0" />
              Nenhuma conta com este e-mail. A pessoa precisa criar uma conta no Hookify primeiro.
            </p>
          )}

          {lookupResult && lookupResult !== "not_found" && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background p-3">
              <span className="text-sm font-medium text-text">{lookupResult.display_name || email.trim()}</span>
              <div className="flex items-center gap-2">
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "editor" | "viewer")}>
                  <SelectTrigger size="sm" className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="viewer">Leitura</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={handleInvite} disabled={isInviting}>
                  {isInviting ? <IconLoader2 className="h-4 w-4 animate-spin" /> : "Convidar"}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* ── Membros ── */}
        <section className="space-y-2">
          <label className="text-sm font-medium text-text">Membros</label>
          {isLoadingShares ? (
            <div className="flex items-center justify-center py-6">
              <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : shares.length === 0 ? (
            <p className="text-xs text-muted-foreground">Ninguém ainda — só você vê este pack.</p>
          ) : (
            <div className="space-y-2">
              {shares.map((share) => (
                <div key={share.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background p-3">
                  <span className="truncate text-sm text-text">{share.display_name || share.grantee_id.slice(0, 8)}</span>
                  <div className="flex items-center gap-2">
                    <Select
                      value={share.role}
                      onValueChange={(v) => void handleChangeRole(share.grantee_id, v as "editor" | "viewer")}
                      disabled={busyGranteeId === share.grantee_id}
                    >
                      <SelectTrigger size="sm" className="w-28">
                        <SelectValue>{ROLE_LABEL[share.role]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="viewer">Leitura</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={() => void handleRevoke(share)}
                      disabled={busyGranteeId === share.grantee_id}
                      aria-label={`Revogar acesso de ${share.display_name || "membro"}`}
                    >
                      <IconTrash className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <footer className="flex justify-end border-t border-border pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </footer>
      </div>
    </AppDialog>
  );
}
