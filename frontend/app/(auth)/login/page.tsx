"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuthUrl, useAuthToken } from "@/lib/api/hooks";
import { showError } from "@/lib/utils/toast";
import { useAuthManager } from "@/lib/hooks/useAuthManager";
import { useClientAuth } from "@/lib/hooks/useClientSession";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const authUrlMutation = useAuthUrl();
  const authTokenMutation = useAuthToken();
  const { handleLoginSuccess } = useAuthManager();
  const { isClient } = useClientAuth();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleContinueWithFacebook = async () => {
    if (isProcessing) return; // Evitar múltiplas execuções

    try {
      setIsProcessing(true);
      const result = await authUrlMutation.mutateAsync();
      if (!result.auth_url) return;

      const popup = window.open(result.auth_url, "facebook-auth", "width=600,height=600,scrollbars=yes,resizable=yes");

      const listener = async (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === "FACEBOOK_AUTH_SUCCESS") {
          try {
            const res = await authTokenMutation.mutateAsync({
              code: event.data.code,
              redirect_uri: window.location.origin + "/callback",
            });

            // Usar o hook de gerenciamento de auth
            const success = handleLoginSuccess(res.access_token, res.user_info);
            if (success) {
              // Redirecionar para dashboard ou página principal
              router.push("/");
            }
          } catch (e: any) {
            showError(e);
          } finally {
            window.removeEventListener("message", listener);
            popup?.close();
            setIsProcessing(false);
          }
        }
        if (event.data?.type === "FACEBOOK_AUTH_ERROR") {
          showError({ message: event.data?.error_description || "Falha na autenticação" });
          window.removeEventListener("message", listener);
          popup?.close();
          setIsProcessing(false);
        }
      };

      window.addEventListener("message", listener);
    } catch (error) {
      showError(error as any);
      setIsProcessing(false);
    }
  };

  // Só renderizar quando estiver no cliente para evitar problemas de hidratação
  if (!isClient) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-md mx-auto space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold">Entrar</h1>
            <p className="text-muted">Carregando...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-16">
      <div className="max-w-md mx-auto space-y-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold">Entrar</h1>
          <p className="text-muted">Acesse sua conta para continuar</p>
        </div>

        <div className="space-y-4">
          <Button onClick={handleContinueWithFacebook} className="w-full" disabled={isProcessing || authUrlMutation.isPending}>
            {isProcessing ? "Processando..." : "Continuar com Facebook"}
          </Button>
        </div>
      </div>
    </div>
  );
}
