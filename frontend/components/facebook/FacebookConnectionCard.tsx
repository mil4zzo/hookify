"use client";

import { Button } from "@/components/ui/button";
import { IconBrandFacebook, IconCheck, IconLoader2, IconRefresh, IconTrash, IconAlertCircle } from "@tabler/icons-react";
import { useFacebookConnectionVerification } from "@/lib/hooks/useFacebookConnectionVerification";

interface FacebookConnection {
  id: string;
  facebook_name?: string | null;
  facebook_email?: string | null;
  facebook_user_id: string;
  facebook_picture_url?: string | null;
  status?: string;
  is_primary?: boolean;
}

interface FacebookConnectionCardProps {
  connection: FacebookConnection;
  isSelected?: boolean;
  onSelect?: (connectionId: string) => void;
  onDelete?: (connectionId: string) => void;
  onReconnect?: (connectionId: string) => void;
  onSetPrimary?: (connectionId: string) => void;
  isDeleting?: boolean;
  showActions?: boolean;
}

export function FacebookConnectionCard({
  connection,
  isSelected = false,
  onSelect,
  onDelete,
  onReconnect,
  onSetPrimary,
  isDeleting = false,
  showActions = true,
}: FacebookConnectionCardProps) {
  const { testingConnections, expiredConnections, handleRetestConnection } = useFacebookConnectionVerification();

  const isTesting = testingConnections.has(connection.id);
  const isExpired = expiredConnections.has(connection.id) || connection.status === "expired" || connection.status === "invalid";
  const isValid = connection.status === "active" && !isExpired;
  const canSelect = !isExpired && !isTesting;

  const handleRetest = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await handleRetestConnection(connection.id);
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
    <div
      className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${
        isSelected && canSelect
          ? "border-primary bg-primary-5 cursor-pointer"
          : isExpired
          ? "border-destructive-50 bg-destructive-5 cursor-not-allowed opacity-75"
          : canSelect
          ? "border-border hover:bg-accent cursor-pointer"
          : "border-border cursor-not-allowed opacity-50"
      }`}
      onClick={() => canSelect && onSelect && onSelect(connection.id)}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {/* Avatar */}
          {connection.facebook_picture_url ? (
            <img
              src={connection.facebook_picture_url}
              alt={connection.facebook_name || "Facebook"}
              className="w-8 h-8 rounded-full object-cover flex-shrink-0"
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
              <IconBrandFacebook className="w-4 h-4 text-white" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <div className="font-medium text-sm truncate">
                {connection.facebook_name || connection.facebook_email || `ID: ${connection.facebook_user_id}` || "Conta do Facebook"}
              </div>
              {isTesting && (
                <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground font-medium flex items-center gap-1">
                  <IconLoader2 className="w-3 h-3 animate-spin" />
                  Verificando...
                </span>
              )}
              {!isTesting && isValid && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/20 text-green-500 border border-green-500/30">
                  <IconCheck className="w-3 h-3" />
                  Conectada
                </span>
              )}
              {!isTesting && isExpired && (
                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-500 border border-yellow-500/30">
                  <IconAlertCircle className="w-3 h-3" />
                  {connection.status === "expired" ? "Expirada" : "Inválida"}
                </span>
              )}
              {connection.is_primary && (
                <span className="text-xs px-2 py-0.5 rounded bg-primary-20 text-primary font-medium">Primária</span>
              )}
            </div>
            {connection.facebook_email && connection.facebook_email !== connection.facebook_name && (
              <div className="text-xs text-muted-foreground truncate">{connection.facebook_email}</div>
            )}
            {!connection.facebook_email && !connection.facebook_name && (
              <div className="text-xs text-muted-foreground truncate">ID: {connection.facebook_user_id}</div>
            )}
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
            <Button type="button" variant="default" size="sm" className="h-8 text-xs" onClick={handleReconnect} disabled={isDeleting}>
              Reconectar
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                onClick={handleRetest}
                disabled={isDeleting}
                title="Verificar novamente"
              >
                <IconRefresh className="w-3.5 h-3.5 mr-1" />
                Verificar
              </Button>
              {onDelete && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive-10"
                  onClick={handleDelete}
                  disabled={isDeleting}
                >
                  <IconTrash className="w-4 h-4" />
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

