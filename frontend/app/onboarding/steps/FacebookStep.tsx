"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { IconBrandFacebook, IconChevronRight, IconChevronLeft, IconLoader2 } from "@tabler/icons-react";
import { useFacebookAccountConnection } from "@/lib/hooks/useFacebookAccountConnection";
import { useFacebookConnectionVerification } from "@/lib/hooks/useFacebookConnectionVerification";
import { FacebookConnectionCard } from "@/components/facebook/FacebookConnectionCard";
import { FormPageSection } from "@/components/common/layout";
import { showError, showSuccess } from "@/lib/utils/toast";
import { AuthPopupError } from "@/lib/utils/authPopup";

export function FacebookStep(props: { onContinue: () => void; onBack: () => void }) {
  const { connections, connect, hasActiveConnection, disconnect, refreshPicture } = useFacebookAccountConnection();
  const { verifyConnections } = useFacebookConnectionVerification();

  useEffect(() => {
    if (connections.data && connections.data.length > 0) {
      const connectionIds = connections.data.map((c: any) => c.id);
      verifyConnections(connectionIds);
    }
  }, [connections.data, verifyConnections]);

  const handleConnect = async () => {
    try {
      const ok = await connect.mutateAsync({});
      if (ok) {
        showSuccess("Facebook conectado com sucesso!");
        props.onContinue();
      }
    } catch (e: any) {
      const authError = e as AuthPopupError;
      if (authError?.code === "AUTH_POPUP_CLOSED") return;
      showError(e);
    }
  };

  const handleReconnect = async () => {
    try {
      const ok = await connect.mutateAsync({ reauth: true });
      if (ok) {
        showSuccess("Facebook reconectado com sucesso!");
      }
    } catch (e: any) {
      const authError = e as AuthPopupError;
      if (authError?.code === "AUTH_POPUP_CLOSED") return;
      showError(e);
    }
  };

  const handleDelete = async (connectionId: string) => {
    if (!confirm("Tem certeza que deseja desconectar esta conta do Facebook?")) {
      return;
    }
    try {
      await disconnect.mutateAsync(connectionId);
      showSuccess("Conta desconectada com sucesso!");
    } catch (e: any) {
      showError(e);
    }
  };

  return (
    <FormPageSection title="Conta de anúncios do Facebook" description="Conecte sua conta do Facebook (com acesso à conta de anúncios) para carregar seus anúncios automaticamente.">
        {connections.isLoading ? (
          <div className="flex items-center justify-center py-8">
            <p className="text-sm text-muted-foreground">Carregando conexões...</p>
          </div>
        ) : connections.data && connections.data.length > 0 ? (
          <div className="space-y-2">
            <label className="text-sm font-medium">Conexões existentes</label>
            <div className="space-y-2">
              {connections.data.map((connection: any) => (
                <FacebookConnectionCard
                  key={connection.id}
                  connection={connection}
                  onReconnect={handleReconnect}
                  onRefreshPicture={async (connectionId) => {
                    try {
                      await refreshPicture.mutateAsync(connectionId);
                    } catch (e: any) {
                      showError(e);
                    }
                  }}
                  onDelete={handleDelete}
                  isDeleting={disconnect.isPending}
                  showActions={true}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
              <IconBrandFacebook className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="flex-1">
              <p className="text-sm text-muted-foreground">Nenhuma conta do Facebook conectada ainda.</p>
            </div>
          </div>
        )}

        <div className="flex gap-3">
          <Button className="flex-1 flex items-center gap-2" variant={hasActiveConnection ? "outline" : "default"} onClick={handleConnect} disabled={connect.isPending}>
            {connect.isPending ? <IconLoader2 className="w-4 h-4 animate-spin" /> : <IconBrandFacebook className="w-4 h-4" />}
            {hasActiveConnection ? "Adicionar outra conta" : connect.isPending ? "Conectando..." : "Conectar Facebook"}
          </Button>
        </div>

        <div className="flex justify-between">
          <Button variant="outline" onClick={props.onBack}>
            <IconChevronLeft className="w-4 h-4 mr-1" />
            Voltar
          </Button>
          {hasActiveConnection && (
            <Button variant="default" className="flex items-center gap-1" onClick={props.onContinue}>
              <span>Continuar</span>
              <IconChevronRight className="w-4 h-4" />
            </Button>
          )}
        </div>
    </FormPageSection>
  );
}
