"use client";

import { useCallback, useEffect, useState } from "react";
import { IconLoader2, IconTrash, IconUsers } from "@tabler/icons-react";

import { AppDialog } from "@/components/common/AppDialog";
import { InlineNotice } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MemberIdentity } from "@/components/packs/PackShareDialog";
import { api } from "@/lib/api/endpoints";
import { showError, showSuccess } from "@/lib/utils/toast";
import type { FolderShareDetail, FolderShareMember, PackFolder } from "@/lib/types";

interface FolderShareDialogProps {
  folder: PackFolder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chamado depois de qualquer mudança, para a tela reler quem tem cada pasta. */
  onChanged: () => void;
}

type Role = "editor" | "viewer";

const ROLE_LABEL: Record<Role, string> = { editor: "Editor", viewer: "Leitura" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Compartilhar uma PASTA (migration 181), como no Drive: a pessoa vê a mesma pasta do
 * dono, com as subpastas e os packs de hoje e de depois. Só o dono da pasta abre isto.
 *
 * Para os packs, cada um vira um convite comum, marcado "via pasta" no Compartilhar
 * pack. Dentro da pasta tudo segue a pasta: o convite direto de quem está aqui é
 * absorvido e sai junto com a pessoa. A Biblioteca pede confirmação antes de mover um
 * pack para dentro de uma pasta assim — o silêncio que a Decisão 3 da 168 temia.
 */
export function FolderShareDialog({ folder, open, onOpenChange, onChanged }: FolderShareDialogProps) {
  const [detail, setDetail] = useState<FolderShareDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("editor");
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [lookupResult, setLookupResult] = useState<{ user_id: string; display_name: string | null } | "not_found" | null>(null);
  const [busyGranteeId, setBusyGranteeId] = useState<string | null>(null);

  const folderId = folder?.id ?? null;

  const load = useCallback(async () => {
    if (!folderId) return;
    setIsLoading(true);
    try {
      setDetail(await api.folderShares.list(folderId));
    } catch (e) {
      showError(e as Error);
    } finally {
      setIsLoading(false);
    }
  }, [folderId]);

  useEffect(() => {
    if (!open) return;
    setEmail("");
    setLookupResult(null);
    setInviteRole("editor");
    setDetail(null);
    void load();
  }, [open, load]);

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
      setLookupResult(res.found && res.user_id ? { user_id: res.user_id, display_name: res.display_name ?? null } : "not_found");
    } catch (e) {
      showError(e as Error);
    } finally {
      setIsLookingUp(false);
    }
  };

  const handleInvite = async () => {
    if (!folderId || !lookupResult || lookupResult === "not_found") return;
    setIsInviting(true);
    try {
      const res = await api.folderShares.create(folderId, lookupResult.user_id, inviteRole);
      const who = lookupResult.display_name || email.trim();
      const parts = [`Pasta compartilhada com ${who}.`];
      if (res.access_changes.granted > 0) parts.push(`${plural(res.access_changes.granted, "pack liberado", "packs liberados")}.`);
      if (res.absorbed > 0) {
        parts.push(`${plural(res.absorbed, "pack que já era", "packs que já eram")} compartilhado${res.absorbed === 1 ? "" : "s"} direto ${res.absorbed === 1 ? "passa" : "passam"} a valer pela pasta.`);
      }
      showSuccess(parts.join(" "));
      setEmail("");
      setLookupResult(null);
      await load();
      onChanged();
    } catch (e) {
      showError(e as Error);
    } finally {
      setIsInviting(false);
    }
  };

  const handleChangeRole = async (member: FolderShareMember, role: Role) => {
    if (!folderId) return;
    setBusyGranteeId(member.grantee_id);
    try {
      await api.folderShares.updateRole(folderId, member.grantee_id, role);
      await load();
      onChanged();
    } catch (e) {
      showError(e as Error);
    } finally {
      setBusyGranteeId(null);
    }
  };

  const handleRevoke = async (member: FolderShareMember) => {
    if (!folderId || !folder) return;
    const who = member.display_name || "este membro";
    const covered = detail?.scope.owned_packs ?? 0;
    // Dentro da pasta tudo segue a pasta (181): o que era convite direto foi absorvido e sai junto.
    const effect =
      covered > 0
        ? ` ${who} perde o acesso aos ${covered} ${covered === 1 ? "pack" : "packs"} da pasta, inclusive os que tinha recebido direto. Os packs que a pessoa criou lá dentro voltam para ela, e você deixa de vê-los.`
        : "";
    if (!confirm(`Tirar ${who} da pasta "${folder.name}"?${effect}`)) return;
    setBusyGranteeId(member.grantee_id);
    try {
      await api.folderShares.revoke(folderId, member.grantee_id);
      showSuccess("Acesso revogado.");
      await load();
      onChanged();
    } catch (e) {
      showError(e as Error);
    } finally {
      setBusyGranteeId(null);
    }
  };

  const scope = detail?.scope;

  return (
    <AppDialog isOpen={open} onClose={() => onOpenChange(false)} size="lg" title="Compartilhar pasta">
      <div className="space-y-6">
        <header className="space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <IconUsers className="h-5 w-5" />
            Compartilhar «{folder?.name ?? ""}»
          </h2>
          <p className="text-sm text-muted-foreground">
            Quem você convidar vê esta pasta como você: <span className="font-medium text-foreground">as subpastas e todos os packs</span>, os de
            hoje e os que entrarem depois. Quando um pack sai da pasta, o acesso a ele por aqui termina junto.{" "}
            <span className="font-medium text-foreground">Editor</span> mexe na pasta como você: renomeia, cria e desfaz subpastas, move,
            cria, renomeia e exclui packs, muda o período, atualiza e calibra. Pack que o editor cria aqui é dele e fica na pasta enquanto
            ele estiver nela.{" "}
            <span className="font-medium text-foreground">Leitura</span> só consulta.
          </p>
        </header>

        {scope && (
          <InlineNotice tone="info" title="O que esta pasta cobre hoje">
            {plural(scope.owned_packs, "pack seu", "packs seus")}
            {scope.subfolders > 0 ? ` e ${plural(scope.subfolders, "subpasta", "subpastas")}` : ""}.
            {scope.foreign_packs > 0 && (
              <> {plural(scope.foreign_packs, "pack desta pasta não é seu", "packs desta pasta não são seus")} (foram compartilhados com você) e {scope.foreign_packs === 1 ? "fica" : "ficam"} de fora.</>
            )}
          </InlineNotice>
        )}

        {/* ── Convite ── */}
        <section className="space-y-2">
          <label className="text-sm font-medium text-foreground">Convidar por e-mail</label>
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
          <p className="text-xs text-muted-foreground">E-mail exato de quem já tem conta no Hookify.</p>

          {lookupResult === "not_found" && (
            <InlineNotice tone="info" title="Nenhuma conta com este e-mail">
              A pessoa precisa criar uma conta no Hookify primeiro.
            </InlineNotice>
          )}

          {lookupResult && lookupResult !== "not_found" && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-2 p-3">
              <MemberIdentity name={lookupResult.display_name} fallback={email.trim()} />
              <div className="flex items-center gap-2">
                <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
                  <SelectTrigger size="sm" className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="editor">Editor</SelectItem>
                    <SelectItem value="viewer">Leitura</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={handleInvite} disabled={isInviting}>
                  {isInviting ? <IconLoader2 className="h-4 w-4 animate-spin" /> : "Compartilhar pasta"}
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* ── Quem tem a pasta ── */}
        <section className="space-y-2">
          <label className="text-sm font-medium text-foreground">Membros da pasta</label>
          {isLoading && !detail ? (
            <div className="flex items-center justify-center py-6">
              <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !detail || detail.shares.length === 0 ? (
            <p className="text-xs text-muted-foreground">Ninguém ainda — só você vê os packs desta pasta.</p>
          ) : (
            <div className="divide-y divide-border rounded-md border border-border bg-surface-2">
              {detail.shares.map((member) => (
                <div key={member.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <MemberIdentity name={member.display_name} fallback={member.grantee_id.slice(0, 8)} since={member.created_at} />
                  <div className="flex items-center gap-2">
                    <Select
                      value={member.role}
                      onValueChange={(v) => void handleChangeRole(member, v as Role)}
                      disabled={busyGranteeId === member.grantee_id}
                    >
                      <SelectTrigger size="sm" className="w-28">
                        <SelectValue>{ROLE_LABEL[member.role]}</SelectValue>
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
                      onClick={() => void handleRevoke(member)}
                      disabled={busyGranteeId === member.grantee_id}
                      aria-label={`Tirar ${member.display_name || "membro"} da pasta`}
                    >
                      <IconTrash className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Herdado das pastas de cima: vale aqui, só muda lá ── */}
        {detail && detail.inherited.length > 0 && (
          <section className="space-y-2">
            <label className="text-sm font-medium text-foreground">Herdado das pastas de cima</label>
            <div className="divide-y divide-border rounded-md border border-border bg-surface-2">
              {detail.inherited.map((member) => (
                <div key={member.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <MemberIdentity name={member.display_name} fallback={member.grantee_id.slice(0, 8)} />
                  <span className="text-xs text-muted-foreground">
                    {ROLE_LABEL[member.role]} · via «{member.folder_name ?? "pasta"}»
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Estes acessos valem para esta pasta também e só mudam na pasta de onde vêm. Compartilhar esta subpasta com a mesma pessoa
              troca o papel dela só aqui dentro.
            </p>
          </section>
        )}

        <footer className="flex justify-end border-t border-border pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </footer>
      </div>
    </AppDialog>
  );
}
