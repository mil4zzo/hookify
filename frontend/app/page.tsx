"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useClientAuth } from "@/lib/hooks/useClientSession";
import { LoadingState } from "@/components/common/States";

export default function HomePage() {
  const { isAuthenticated, isClient } = useClientAuth();
  const router = useRouter();

  useEffect(() => {
    if (isClient && !isAuthenticated) {
      router.push("/login");
    }
  }, [isClient, isAuthenticated, router]);

  // Show loading while checking authentication
  if (!isClient) {
    return (
      <div className="container mx-auto px-4 py-8">
        <LoadingState label="Verificando autenticação..." />
      </div>
    );
  }

  // If not authenticated, show loading while redirecting
  if (!isAuthenticated) {
    return (
      <div className="container mx-auto px-4 py-8">
        <LoadingState label="Redirecionando para login..." />
      </div>
    );
  }

  // If authenticated, show the home page
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold">Hookify</h1>
        <p className="text-muted">Bem-vindo ao Hookify! Escolha uma das opções abaixo:</p>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <a href="/ads-loader" className="p-6 border border-surface2 rounded-lg hover:bg-surface2 transition-colors">
            <h3 className="text-lg font-semibold mb-2">📊 ADs Loader</h3>
            <p className="text-sm text-muted">Carregue e gerencie seus packs de anúncios</p>
          </a>

          <a href="/dashboard" className="p-6 border border-surface2 rounded-lg hover:bg-surface2 transition-colors">
            <h3 className="text-lg font-semibold mb-2">📈 Dashboard</h3>
            <p className="text-sm text-muted">Visualize métricas e gráficos dos seus anúncios</p>
          </a>

          <a href="/rankings" className="p-6 border border-surface2 rounded-lg hover:bg-surface2 transition-colors">
            <h3 className="text-lg font-semibold mb-2">🏆 Rankings</h3>
            <p className="text-sm text-muted">Compare performance e analise rankings dos anúncios</p>
          </a>

          <a href="/api-test" className="p-6 border border-surface2 rounded-lg hover:bg-surface2 transition-colors">
            <h3 className="text-lg font-semibold mb-2">🧪 API Test</h3>
            <p className="text-sm text-muted">Teste as APIs e visualize dados em tempo real</p>
          </a>
        </div>
      </div>
    </div>
  );
}
