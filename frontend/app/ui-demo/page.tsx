"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Modal } from "@/components/common/Modal";
import { useState } from "react";
import { LoadingState, ErrorState, EmptyState } from "@/components/common/States";
import { showSuccess, showError, showInfo } from "@/lib/utils/toast";

export default function UIDemo() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-text p-8">
      <div className="max-w-6xl mx-auto space-y-12">
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold">Design System Demo</h1>
          <p className="text-muted-foreground text-lg">Componentes shadcn/ui + estados padronizados</p>
        </div>

        {/* Buttons */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold">Botões</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex gap-4 flex-wrap">
            <Button size="sm">Small</Button>
            <Button size="default">Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon">🚀</Button>
          </div>
        </section>

        {/* Inputs */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold">Inputs</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
            <Input placeholder="Digite algo..." />
            <Input type="email" placeholder="email@exemplo.com" />
            <Input type="password" placeholder="Senha" />
            <Input disabled placeholder="Desabilitado" />
          </div>
        </section>

        {/* Cards */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold">Cards</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Card Simples</CardTitle>
                <CardDescription>Descrição do card</CardDescription>
              </CardHeader>
              <CardContent>
                <p>Conteúdo do card aqui.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Card com Ação</CardTitle>
                <CardDescription>Card com botão de ação</CardDescription>
              </CardHeader>
              <CardContent>
                <Button className="w-full">Ação</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Card com Métricas</CardTitle>
                <CardDescription>Exemplo de métricas</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Impressões</span>
                    <span className="font-mono">1,234</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cliques</span>
                    <span className="font-mono">567</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Skeletons */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold">Skeletons</h2>
          <div className="space-y-4">
            <div className="flex items-center space-x-4">
              <Skeleton className="h-12 w-12 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-4 w-[250px]" />
                <Skeleton className="h-4 w-[200px]" />
              </div>
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </section>

        {/* States */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold">Estados de UI</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Loading</CardTitle>
              </CardHeader>
              <CardContent>
                <LoadingState />
                <LoadingState label="Carregando dados..." />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Error</CardTitle>
              </CardHeader>
              <CardContent>
                <ErrorState message="Erro ao carregar dados" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Empty</CardTitle>
              </CardHeader>
              <CardContent>
                <EmptyState />
                <EmptyState message="Nenhum resultado encontrado" />
              </CardContent>
            </Card>
          </div>
        </section>

        {/* Dialog */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold">Modal</h2>
          <Button onClick={() => setIsModalOpen(true)}>Abrir Modal</Button>
          <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} size="lg" padding="md">
            <div className="space-y-1.5 mb-6">
              <h2 className="text-lg font-semibold leading-none tracking-tight">Exemplo de Modal</h2>
              <p className="text-sm text-muted-foreground">Este é um exemplo de modal usando o componente global.</p>
            </div>
            <div className="space-y-4">
              <p>Conteúdo do modal aqui.</p>
              <Button className="w-full">Ação</Button>
            </div>
          </Modal>
        </section>

        {/* Toasts */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold">Toasts</h2>
          <div className="flex gap-4 flex-wrap">
            <Button onClick={() => showSuccess("Sucesso!")}>Toast Sucesso</Button>
            <Button onClick={() => showError({ message: "Erro!" })} variant="destructive">
              Toast Erro
            </Button>
            <Button onClick={() => showInfo("Informação")} variant="outline">
              Toast Info
            </Button>
          </div>
        </section>

        {/* Responsive Test */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold">Teste Responsivo</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-brand">{i + 1}</div>
                    <div className="text-sm text-muted-foreground">Item {i + 1}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
