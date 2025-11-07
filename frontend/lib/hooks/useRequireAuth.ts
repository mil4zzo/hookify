"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useClientAuth } from "@/lib/hooks/useClientSession";

type GuardStatus = "checking" | "authorized" | "redirecting";

export const useRequireAuth = (redirectTo: string = "/login") => {
  const { isClient, isAuthenticated, isLoading } = useClientAuth();
  const router = useRouter();

  useEffect(() => {
    // Só redirecionar se o carregamento terminou E não está autenticado
    if (isClient && !isLoading && !isAuthenticated) {
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


