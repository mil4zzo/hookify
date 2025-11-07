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
  const [posted, setPosted] = useState(false);
  const authMut = useAuthToken();
  const { handleLoginSuccess } = useAuthManager();

  const origin = useMemo(() => {
    if (typeof window === "undefined") return "*";
    return window.location.origin;
  }, []);

  useEffect(() => {
    // Se veio erro do Facebook, reporte ao opener e encerre
    if (error) {
      try {
        if (window.opener && !posted) {
          window.opener.postMessage({ type: "FACEBOOK_AUTH_ERROR", error, errorDescription }, origin);
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
        window.opener.postMessage({ type: "FACEBOOK_AUTH_SUCCESS", code }, origin);
        setPosted(true);
        // fecha após breve delay
        setTimeout(() => window.close(), 300);
        return;
      } catch {}
    }

    // 2) Fallback: trocar code por token diretamente aqui (apenas se NÃO for popup)
    if (!window.opener) {
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
