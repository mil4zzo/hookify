"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { IconBrandFacebook, IconCheck, IconLoader2, IconRefresh, IconTrash, IconAlertCircle, IconShieldExclamation } from "@tabler/icons-react";
import { InlineNotice } from "@/components/common/States";
import { useFacebookConnectionVerification } from "@/lib/hooks/useFacebookConnectionVerification";
import { getFacebookAvatarUrl } from "@/lib/utils/facebookAvatar";
import { getScopeImpact } from "@/lib/utils/facebookScopeImpact";

interface FacebookConnection {
  id: string;
  facebook_name?: string | null;
  facebook_email?: string | null;
  facebook_user_id: string;
  facebook_picture_url?: string | null;
  picture_storage_path?: string | null;
  status?: string;
  is_primary?: boolean;
  scopes?: string[] | null;
  missing_scopes?: string[] | null;
}

interface FacebookConnectionCardProps {
  connection: FacebookConnection;
  isSelected?: boolean;
  onSelect?: (connectionId: string) => void;
  onDelete?: (connectionId: string) => void;
  onReconnect?: (connectionId: string) => void;
  onRefreshPicture?: (connectionId: string) => void | Promise<void>;
  onSetPrimary?: (connectionId: string) => void;
  onVerify?: () => void;
  isDeleting?: boolean;
  showActions?: boolean;
}

export function FacebookConnectionCard({ connection, isSelected = false, onSelect, onDelete, onReconnect, onRefreshPicture, onSetPrimary, onVerify, isDeleting = false, showActions = true }: FacebookConnectionCardProps) {
  const { testingConnections, expiredConnections, handleRetestConnection } = useFacebookConnectionVerification();
  const hasTriggeredPictureRefresh = useRef(false);
  const avatarUrl = getFacebookAvatarUrl(connection);

  const isTesting = testingConnections.has(connection.id);
  const isExpired = expiredConnections.has(connection.id) || connection.status === "expired" || connection.status === "invalid";
  const missingScopes = connection.missing_scopes || [];
  const isDegraded = !isExpired && (connection.status === "degraded" || missingScopes.length > 0);
  const isValid = connection.status === "active" && !isExpired && !isDegraded;
  const canSelect = !isExpired && !isTesting;

  const handleRetest = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await handleRetestConnection(connection.id);
    onVerify?.();
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      onDelete(connection.id);
    }
  };

  const handleReconnect = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onReconnect) {
      onReconnect(connection.id);
    }
  };

  return (
    <div className={`flex flex-col gap-3 p-3 border rounded-lg transition-colors ${isSelected && canSelect ? "border-primary bg-primary-5 cursor-pointer" : isExpired ? "border-destructive-50 bg-destructive-5 cursor-not-allowed opacity-75" : isDegraded ? "border-warning-30 bg-warning-5" : canSelect ? "border-border hover:bg-accent cursor-pointer" : "border-border cursor-not-allowed opacity-50"}`} onClick={() => canSelect && onSelect && onSelect(connection.id)}>
      <div className="flex items-center justify-between gap-2">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {/* Avatar */}
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={connection.facebook_name || "Facebook"}
              className="w-8 h-8 rounded-full object-cover flex-shrink-0"
              onError={() => {
                if (!hasTriggeredPictureRefresh.current && onRefreshPicture) {
                  hasTriggeredPictureRefresh.current = true;
                  onRefreshPicture(connection.id);
                }
              }}
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
              <IconBrandFacebook className="w-4 h-4 text-primary-foreground" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="font-medium text-sm truncate">{connection.facebook_name || connection.facebook_email || `ID: ${connection.facebook_user_id}` || "Conta do Facebook"}</div>
              {isTesting && (
                <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground font-medium flex items-center gap-1">
                  <IconLoader2 className="w-3 h-3 animate-spin" />
                  Verificando...
                </span>
              )}
              {!isTesting && isValid && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-success-20 text-success border border-success-30">
                  <IconCheck className="w-3 h-3" />
                  Conectada
                </span>
              )}
              {!isTesting && isExpired && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-warning-20 text-warning border border-warning-30">
                  <IconAlertCircle className="w-3 h-3" />
                  {connection.status === "expired" ? "Expirada" : "Inválida"}
                </span>
              )}
              {!isTesting && !isExpired && isDegraded && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-warning-20 text-warning border border-warning-30">
                  <IconShieldExclamation className="w-3 h-3" />
                  Permissões incompletas ({missingScopes.length})
                </span>
              )}
              {connection.is_primary && <span className="text-xs px-2 py-0.5 rounded bg-primary-20 text-primary font-medium">Primária</span>}
            </div>
            {connection.facebook_email && connection.facebook_email !== connection.facebook_name && <div className="text-xs text-muted-foreground truncate">{connection.facebook_email}</div>}
            {!connection.facebook_email && !connection.facebook_name && <div className="text-xs text-muted-foreground truncate">ID: {connection.facebook_user_id}</div>}
          </div>
        </div>
      </div>

      {showActions && (
        <div className="flex items-center gap-2">
          {!isTesting && isSelected && canSelect && <IconCheck className="w-4 h-4 text-primary" />}
          {isTesting ? (
            <div className="h-8 w-8 flex items-center justify-center">
              <IconLoader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : isExpired ? (
            <>
              <Button type="button" variant="default" size="sm" className="h-8 text-xs" onClick={handleReconnect} disabled={isDeleting}>
                Reconectar
              </Button>
              {onDelete && (
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive-10" onClick={handleDelete} disabled={isDeleting} title="Excluir conexão">
                  {isDeleting ? <IconLoader2 className="w-4 h-4 animate-spin" /> : <IconTrash className="w-4 h-4" />}
                </Button>
              )}
            </>
          ) : (
            <>
              {onReconnect && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-2 text-xs"
                  onClick={handleReconnect}
                  disabled={isDeleting}
                  title="Reconectar para renovar token ou solicitar novas permissões"
                >
                  Reconectar
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={handleRetest} disabled={isDeleting} title="Verificar novamente">
                <IconRefresh className="w-3.5 h-3.5 mr-1" />
                Verificar
              </Button>
              {onDelete && (
                <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive-10" onClick={handleDelete} disabled={isDeleting}>
                  <IconTrash className="w-4 h-4" />
                </Button>
              )}
            </>
          )}
        </div>
      )}
      </div>

      {!isTesting && !isExpired && isDegraded && missingScopes.length > 0 && (
        <div onClick={(e) => e.stopPropagation()}>
          <InlineNotice tone="warning" title="O que essa conexão deixa de fazer:" className="text-xs leading-relaxed">
            <ul className="mt-1 space-y-2">
            {missingScopes.map((scope) => {
              const info = getScopeImpact(scope);
              if (!info) {
                return (
                  <li key={scope} className="text-muted-foreground">
                    <span className="font-mono text-[11px]">{scope}</span>
                  </li>
                );
              }
              return (
                <li key={scope}>
                  <div className="font-medium text-foreground">{info.label}</div>
                  <div className="text-muted-foreground">{info.impact}</div>
                </li>
              );
            })}
            </ul>
            {onReconnect && (
              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={handleReconnect}
                  disabled={isDeleting}
                >
                  Atualizar permissões
                </Button>
              </div>
            )}
          </InlineNotice>
        </div>
      )}
    </div>
  );
}
