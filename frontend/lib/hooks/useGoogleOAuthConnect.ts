import { useState, useCallback } from "react";
import { api } from "@/lib/api/endpoints";
import { env } from "@/lib/config/env";
import { openAuthPopup, AuthPopupError } from "@/lib/utils/authPopup";
import { showSuccess, showError } from "@/lib/utils/toast";

interface GoogleOAuthConnectResult {
  success: boolean;
  connectionId?: string;
  error?: string;
}

/**
 * Hook para conectar/reconectar conta do Google via OAuth.
 * Pode ser usado de qualquer lugar na aplicação.
 *
 * Quando a conexão é bem-sucedida, dispara o evento "google-connected"
 * que é escutado pelo useGoogleReconnectHandler para retomar jobs pausados.
 */
export function useGoogleOAuthConnect() {
  const [isConnecting, setIsConnecting] = useState(false);

  const connect = useCallback(async (options?: {
    silent?: boolean; // Se true, não mostra toast de sucesso
  }): Promise<GoogleOAuthConnectResult> => {
    if (isConnecting) {
      return { success: false, error: "Conexão já em andamento" };
    }

    try {
      setIsConnecting(true);
      const redirectUri = typeof window !== "undefined"
        ? `${window.location.origin}/callback`
        : env.FB_REDIRECT_URI;

      // Obter URL de autenticação
      let res;
      try {
        res = await api.integrations.google.getAuthUrl("google_sheets", redirectUri);
      } catch (error: any) {
        console.error("[useGoogleOAuthConnect] Erro ao obter URL de autenticação:", error);
        throw new Error(error?.message || "Erro ao conectar com o servidor.");
      }

      if (!res?.auth_url) {
        throw new Error("Resposta inválida do servidor ao obter URL de autenticação.");
      }

      // Abrir popup OAuth
      const messageData = await openAuthPopup<{
        type?: string;
        code?: string;
        error?: string;
        errorDescription?: string;
        state?: string;
      }>({
        url: res.auth_url,
        windowName: "hookify-google-sheets-auth",
        windowFeatures: "width=600,height=700",
        successType: "GOOGLE_SHEETS_AUTH_SUCCESS",
        errorType: "GOOGLE_SHEETS_AUTH_ERROR",
        expectedState: "google_sheets",
        timeoutMs: 5 * 60 * 1000,
      });

      if (!messageData.code) {
        throw new Error("Código de autorização não recebido do Google.");
      }

      // Trocar código por token
      let connectionData: any;
      try {
        connectionData = await api.integrations.google.exchangeCode(messageData.code, redirectUri);
      } catch (e: any) {
        console.error("[useGoogleOAuthConnect] Erro ao trocar código por token:", e);
        let errorMessage = "Erro ao finalizar autenticação.";

        if (e?.message) {
          errorMessage = e.message;
        } else if (e?.code === "ERR_NETWORK" || e?.code === "ECONNREFUSED") {
          errorMessage = "Não foi possível conectar ao servidor.";
        } else if (e?.status === 401) {
          errorMessage = "Sessão expirada. Faça login novamente.";
        } else if (e?.status === 500) {
          errorMessage = "Erro interno do servidor.";
        }

        throw new Error(errorMessage);
      }

      const connectionId = connectionData?.connection?.id;

      // Mostrar sucesso (se não for silencioso)
      if (!options?.silent) {
        showSuccess("Google reconectado com sucesso!");
      }

      // Disparar evento para retomar jobs pausados
      window.dispatchEvent(new CustomEvent("google-connected", {
        detail: { connectionId }
      }));

      return { success: true, connectionId };
    } catch (e: any) {
      const authError = e as AuthPopupError;

      // Usuário fechou o popup - não é erro
      if (authError?.code === "AUTH_POPUP_CLOSED") {
        return { success: false, error: "cancelled" };
      }

      // Timeout
      if (authError?.code === "AUTH_POPUP_TIMEOUT") {
        showError(new Error("Tempo limite para autenticação atingido."));
        return { success: false, error: "timeout" };
      }

      const errorMessage = e?.message || "Erro ao conectar com Google";
      showError(new Error(errorMessage));
      return { success: false, error: errorMessage };
    } finally {
      setIsConnecting(false);
    }
  }, [isConnecting]);

  return {
    connect,
    isConnecting,
  };
}
