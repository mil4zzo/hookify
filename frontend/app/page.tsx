"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useClientAuth } from "@/lib/hooks/useClientSession";
import { LoadingState } from "@/components/common/States";

export default function HomePage() {
  const { isAuthenticated, isClient, isLoading } = useClientAuth();
  const router = useRouter();

  useEffect(() => {
    // Se não está autenticado, redirecionar para login
    if (isClient && !isLoading && !isAuthenticated) {
      router.push("/login");
      return;
    }

    // Se está autenticado, redirecionar para ads-loader
    if (isClient && !isLoading && isAuthenticated) {
      router.replace("/ads-loader");
    }
  }, [isClient, isAuthenticated, isLoading, router]);

  // Mostrar loading enquanto verifica autenticação
  return (
    <div>
      <LoadingState label="Redirecionando..." />
    </div>
  );
}
