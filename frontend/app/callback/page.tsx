"use client";
import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoadingState, ErrorState } from "@/components/common/States";
import { useAuthToken } from "@/lib/api/hooks";
import { showError } from "@/lib/utils/toast";
import { useAuthManager } from "@/lib/hooks/useAuthManager";

function CallbackContent() {
  const search = useSearchParams();
  const router = useRouter();
  const code = search.get("code");
  const error = search.get("error") || search.get("error_reason");
  const errorDescription = search.get("error_description");
  const state = search.get("state");
  const [posted, setPosted] = useState(false);
  const authMut = useAuthToken();
  const { handleLoginSuccess } = useAuthManager();

  const origin = useMemo(() => {
    if (typeof window === "undefined") return "*";
    return window.location.origin;
  }, []);

  useEffect(() => {
    // Se veio erro do OAuth, reporte ao opener (Facebook ou Google) e encerre
    if (error) {
      try {
        if (window.opener && !posted) {
          const messageType =
            state === "google_sheets" ? "GOOGLE_SHEETS_AUTH_ERROR" : "FACEBOOK_AUTH_ERROR";
          window.opener.postMessage({ type: messageType, error, errorDescription, state }, origin);
          setPosted(true);
        }
      } catch {}
      return;
    }

    // Sem código -> nada a fazer
    if (!code) return;

    // 1) Se foi aberto como popup, apenas devolve o code ao opener e fecha
    if (window.opener && !posted) {
      try {
        const messageType =
          state === "google_sheets" ? "GOOGLE_SHEETS_AUTH_SUCCESS" : "FACEBOOK_AUTH_SUCCESS";
        window.opener.postMessage({ type: messageType, code, state }, origin);
        setPosted(true);
        // fecha após breve delay
        setTimeout(() => window.close(), 300);
        return;
      } catch {}
    }

    // 2) Fallback: trocar code por token diretamente aqui (apenas se NÃO for popup)
    // Apenas para fluxo de login com Facebook (não usado para integração Google Sheets)
    if (!window.opener && state !== "google_sheets") {
      const run = async () => {
        try {
          const res = await authMut.mutateAsync({ code, redirect_uri: window.location.origin + "/callback" });

          // Usar o hook de gerenciamento de auth
          const success = handleLoginSuccess(res.access_token, res.user_info);
          if (success) {
            router.replace("/ads-loader");
          }
        } catch (e: any) {
          showError({ message: e?.message ?? "Falha ao autenticar" });
        }
      };
      run();
    }
  }, [code, error, errorDescription, posted, origin, authMut, router, handleLoginSuccess]);

  if (error) {
    return (
      <main className="min-h-screen max-w-screen-md mx-auto px-4 md:px-6 lg:px-8 py-10">
        <h1 className="text-2xl font-semibold mb-4">Login com Facebook</h1>
        <ErrorState message={errorDescription || "Falha na autenticação."} />
      </main>
    );
  }

  return (
    <main className="min-h-screen max-w-screen-md mx-auto px-4 md:px-6 lg:px-8 py-10">
      <h1 className="text-2xl font-semibold mb-4">Login com Facebook</h1>
      <LoadingState label="Finalizando autenticação..." />
    </main>
  );
}

export default function CallbackPage() {
  return (
    <Suspense fallback={<LoadingState label="Carregando..." />}>
      <CallbackContent />
    </Suspense>
  );
}
