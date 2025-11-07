"use client";

import React from "react";
import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";
import { IconCircleCheck, IconCircleX } from "@tabler/icons-react";

interface AutoRefreshConfirmModalProps {
  isOpen: boolean;
  packCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AutoRefreshConfirmModal({
  isOpen,
  packCount,
  onConfirm,
  onCancel,
}: AutoRefreshConfirmModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      size="md"
      closeOnOverlayClick={false}
      closeOnEscape={false}
      showCloseButton={false}
    >
      <div className="flex flex-col items-center gap-6 py-4">
        <h2 className="text-xl font-semibold text-text">
          Atualizar Packs Automaticamente?
        </h2>
        
        <p className="text-center text-sm text-text-muted">
          Encontramos {packCount} pack{packCount > 1 ? "s" : ""} configurado{packCount > 1 ? "s" : ""} para atualização automática.
          Deseja atualizá-los agora?
        </p>

        <div className="flex gap-4 w-full">
          <Button
            onClick={onCancel}
            variant="outline"
            className="flex-1 flex items-center justify-center gap-2 border-red-500/50 hover:border-red-500 hover:bg-red-500/10 text-red-500"
          >
            <IconCircleX className="h-5 w-5" />
            Não
          </Button>
          
          <Button
            onClick={onConfirm}
            className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white"
          >
            <IconCircleCheck className="h-5 w-5" />
            Sim
          </Button>
        </div>
      </div>
    </Modal>
  );
}
