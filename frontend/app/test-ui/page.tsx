// frontend/app/test-ui/page.tsx
"use client";
import { LoadingState, ErrorState, EmptyState } from "@/components/common/States";
import { showError, showSuccess, showInfo } from "@/lib/utils/toast";

export default function TestUI() {
  return (
    <div className="min-h-screen bg-background text-text p-8 space-y-8">
      <h1 className="text-2xl font-bold">Teste de Componentes</h1>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Estados de Loading</h2>
        <LoadingState />
        <LoadingState label="Carregando dados..." />
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Estados de Erro</h2>
        <ErrorState message="Erro ao carregar dados" />
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Estados Vazios</h2>
        <EmptyState />
        <EmptyState message="Nenhum resultado encontrado" />
      </div>

      <button onClick={() => showSuccess("Teste de sucesso!")} className="px-4 py-2 bg-brand text-white rounded-md">
        Testar Toast
      </button>
    </div>
  );
}
