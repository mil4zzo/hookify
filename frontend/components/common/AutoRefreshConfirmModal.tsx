"use client";

import React, { useState, useEffect } from "react";
import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";
import { IconCircleCheck, IconCircleX, IconCheck } from "@tabler/icons-react";
import { formatRelativeTime } from "@/lib/utils/formatRelativeTime";

// Função auxiliar para formatar data de YYYY-MM-DD para DD/MM/YYYY
const formatDate = (dateString: string) => {
  if (!dateString) return "";
  const [year, month, day] = dateString.split("-");
  return `${day}/${month}/${year}`;
};

interface AutoRefreshConfirmModalProps {
  isOpen: boolean;
  packCount: number;
  autoRefreshPacks: any[];
  onConfirm: (selectedPackIds: string[]) => void;
  onCancel: () => void;
}

export function AutoRefreshConfirmModal({ isOpen, packCount, autoRefreshPacks, onConfirm, onCancel }: AutoRefreshConfirmModalProps) {
  // Estado para controlar quais packs estão selecionados
  const [selectedPackIds, setSelectedPackIds] = useState<Set<string>>(new Set());

  // Inicializar com todos os packs selecionados quando o modal abrir
  useEffect(() => {
    if (isOpen && autoRefreshPacks.length > 0) {
      setSelectedPackIds(new Set(autoRefreshPacks.map((pack: any) => pack.id)));
    }
  }, [isOpen, autoRefreshPacks]);

  const handleTogglePack = (packId: string) => {
    setSelectedPackIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(packId)) {
        newSet.delete(packId);
      } else {
        newSet.add(packId);
      }
      return newSet;
    });
  };

  const handleConfirmClick = () => {
    onConfirm(Array.from(selectedPackIds));
  };

  // Se há apenas 1 pack, usar o comportamento simples
  if (packCount === 1) {
    return (
      <Modal isOpen={isOpen} onClose={onCancel} size="md" closeOnOverlayClick={false} closeOnEscape={false} showCloseButton={false}>
        <div className="flex flex-col items-center gap-6 py-4">
          <h2 className="text-xl font-semibold text-text">Atualizar dados de Packs</h2>

          <p className="text-center text-sm text-text-muted">Encontramos 1 pack configurado para atualização automática. Deseja atualizá-lo agora?</p>

          <div className="flex gap-4 w-full">
            <Button onClick={onCancel} variant="outline" className="flex-1 flex items-center justify-center gap-2 border-red-500/50 hover:border-red-500 hover:bg-red-500/10 text-red-500">
              <IconCircleX className="h-5 w-5" />
              Não
            </Button>

            <Button onClick={() => onConfirm(autoRefreshPacks.map((p: any) => p.id))} className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white">
              <IconCircleCheck className="h-5 w-5" />
              Sim
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  // Se há múltiplos packs, mostrar lista com checkboxes
  return (
    <Modal isOpen={isOpen} onClose={onCancel} size="md" closeOnOverlayClick={false} closeOnEscape={false} showCloseButton={false}>
      <div className="flex flex-col gap-6 py-4">
        <div>
          <h2 className="text-xl font-semibold text-text mb-2">Atualizar dados de Packs</h2>
          <p className="text-sm text-muted-foreground">Selecione quais deseja atualizar:</p>
        </div>

        <div className="space-y-2 max-h-[300px] overflow-y-auto border border-border rounded-lg p-2">
          {autoRefreshPacks.map((pack: any) => {
            const isSelected = selectedPackIds.has(pack.id);
            return (
              <button key={pack.id} type="button" onClick={() => handleTogglePack(pack.id)} className="w-full flex items-center gap-3 p-3 rounded-md hover:bg-accent transition-colors text-left">
                <div className={`flex items-center justify-center w-5 h-5 rounded border-2 transition-colors ${isSelected ? "bg-brand border-brand" : "border-border bg-background"}`}>{isSelected && <IconCheck className="h-3.5 w-3.5 text-white" />}</div>
                <div className="flex-1 min-w-0 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-text truncate">{pack.name}</p>
                    {pack.date_start && pack.date_stop && (
                      <p className="text-xs text-muted-foreground">
                        {formatDate(pack.date_start)} → {formatDate(pack.date_stop)}
                      </p>
                    )}
                  </div>
                  {pack.updated_at && <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">{formatRelativeTime(pack.updated_at)}</span>}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {selectedPackIds.size} de {packCount} pack{packCount > 1 ? "s" : ""} selecionado{selectedPackIds.size > 1 ? "s" : ""}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (selectedPackIds.size === autoRefreshPacks.length) {
                // Desmarcar todos
                setSelectedPackIds(new Set());
              } else {
                // Marcar todos
                setSelectedPackIds(new Set(autoRefreshPacks.map((p: any) => p.id)));
              }
            }}
          >
            {selectedPackIds.size === autoRefreshPacks.length ? "Desmarcar todos" : "Marcar todos"}
          </Button>
        </div>

        <div className="flex gap-4 w-full">
          <Button onClick={onCancel} variant="outline" className="flex-1 flex items-center justify-center gap-2 border-red-500/50 hover:border-red-500 hover:bg-red-500/10 text-red-500">
            <IconCircleX className="h-5 w-5" />
            Cancelar
          </Button>

          <Button onClick={handleConfirmClick} disabled={selectedPackIds.size === 0} className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white disabled:opacity-50 disabled:cursor-not-allowed">
            <IconCircleCheck className="h-5 w-5" />
            Atualizar {selectedPackIds.size > 0 ? `${selectedPackIds.size} pack${selectedPackIds.size > 1 ? "s" : ""}` : "packs"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
