// frontend/app/test-ui/page.tsx
"use client";
import { LoadingState, ErrorState, StatePanel } from "@/components/common/States";
import { showSuccess } from "@/lib/utils/toast";

export default function TestUI() {
  return (
    <div className="min-h-screen bg-background text-foreground p-8 space-y-8">
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
        <StatePanel kind="empty" message="Sem dados para exibir" />
        <StatePanel kind="empty" message="Nenhum resultado encontrado" />
      </div>

      <button onClick={() => showSuccess("Teste de sucesso!")} className="px-4 py-2 bg-primary text-primary-foreground rounded-md">
        Testar Toast
      </button>
    </div>
  );
}
