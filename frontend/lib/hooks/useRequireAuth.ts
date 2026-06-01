"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useClientAuth } from "@/lib/hooks/useClientSession";
import { getIsLoggingOut } from "@/lib/api/client";

type GuardStatus = "checking" | "authorized" | "redirecting";

export const useRequireAuth = (redirectTo: string = "/login") => {
  const { isClient, isAuthenticated, isLoading } = useClientAuth();
  const router = useRouter();

  useEffect(() => {
    // Só redirecionar se o carregamento terminou E não está autenticado
    if (isClient && !isLoading && !isAuthenticated) {
      // Durante um logout explícito (handleLogout) ou expiração de sessão
      // (AuthSessionExpiredHandler), esses fluxos já são donos da navegação e
      // redirecionam para /login com o param correto (?logout=true / ?expired=true).
      // Disparar um router.replace("/login") concorrente aqui — sem o param —
      // faz o middleware rebater /login → /packs enquanto os cookies residuais do
      // Supabase ainda não terminaram de limpar, deixando a tela de login travada.
      // Então não competimos: deixamos o fluxo de logout dono da navegação.
      if (getIsLoggingOut()) return;
      router.replace(redirectTo as any);
    }
  }, [isClient, isAuthenticated, isLoading, router, redirectTo]);

  const status: GuardStatus = !isClient || isLoading
    ? "checking"
    : isAuthenticated
    ? "authorized"
    : "redirecting";

  return {
    status,
    isClient,
    isAuthenticated,
  } as const;
};


