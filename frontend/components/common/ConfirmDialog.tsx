"use client";

import React from "react";
import { Modal } from "./Modal";
import { Button } from "@/components/ui/button";
import { IconCircleCheck, IconCircleX, IconLoader2 } from "@tabler/icons-react";

export interface ConfirmDialogProps {
  /** Controla se o diálogo está aberto */
  isOpen: boolean;
  /** Função chamada ao fechar o diálogo */
  onClose: () => void;
  /** Título do diálogo */
  title: string;
  /** Mensagem/descrição do diálogo */
  message?: string | React.ReactNode;
  /** Conteúdo adicional opcional (ex: lista de itens, detalhes) */
  children?: React.ReactNode;
  /** Texto do botão de confirmação (padrão: "Confirmar") */
  confirmText?: string;
  /** Texto do botão de cancelamento (padrão: "Cancelar") */
  cancelText?: string;
  /** Variante visual do botão de confirmação */
  variant?: "default" | "destructive" | "success";
  /** Função chamada ao confirmar */
  onConfirm: () => void;
  /** Função chamada ao cancelar (opcional, usa onClose se não fornecido) */
  onCancel?: () => void;
  /** Se está em estado de loading (desabilita botões e mostra spinner) */
  isLoading?: boolean;
  /** Tamanho do diálogo (padrão: "md") */
  size?: "sm" | "md" | "lg";
  /** Se permite fechar clicando no overlay (padrão: true, exceto quando isLoading) */
  closeOnOverlayClick?: boolean;
  /** Se permite fechar pressionando ESC (padrão: true, exceto quando isLoading) */
  closeOnEscape?: boolean;
  /** Se mostra o botão de fechar (padrão: false para confirmações) */
  showCloseButton?: boolean;
  /** Ícone customizado para o botão de confirmação */
  confirmIcon?: React.ReactNode;
  /** Ícone customizado para o botão de cancelamento */
  cancelIcon?: React.ReactNode;
  /** Layout do diálogo (padrão: "centered") */
  layout?: "centered" | "left-aligned";
  /** Texto customizado para o botão quando está em loading (padrão: "Processando...") */
  loadingText?: string;
}

const variantClasses = {
  default: "bg-green-600 hover:bg-green-700 text-white",
  destructive: "bg-red-600 hover:bg-red-700 text-white",
  success: "bg-green-600 hover:bg-green-700 text-white",
};

export function ConfirmDialog({ isOpen, onClose, title, message, children, confirmText = "Confirmar", cancelText = "Cancelar", variant = "default", onConfirm, onCancel, isLoading = false, size = "md", closeOnOverlayClick, closeOnEscape, showCloseButton = false, confirmIcon, cancelIcon, layout = "centered", loadingText = "Processando..." }: ConfirmDialogProps) {
  // Se não especificado, não permite fechar durante loading
  const canClose = !isLoading;
  const effectiveCloseOnOverlayClick = closeOnOverlayClick ?? canClose;
  const effectiveCloseOnEscape = closeOnEscape ?? canClose;

  const handleCancel = () => {
    if (isLoading) return;
    if (onCancel) {
      onCancel();
    } else {
      onClose();
    }
  };

  const handleConfirm = () => {
    if (isLoading) return;
    onConfirm();
  };

  const isCentered = layout === "centered";

  return (
    <Modal isOpen={isOpen} onClose={handleCancel} size={size} padding="md" closeOnOverlayClick={effectiveCloseOnOverlayClick} closeOnEscape={effectiveCloseOnEscape} showCloseButton={showCloseButton && canClose}>
      <div className={`flex flex-col gap-6 py-4 ${isCentered ? "items-center" : "items-start"}`}>
        <h2 className={`text-xl font-semibold text-text ${isCentered ? "text-center" : ""}`}>{title}</h2>

        {message && <p className={`text-sm text-muted-foreground ${isCentered ? "text-center" : ""}`}>{message}</p>}

        {children && <div className={`w-full ${isCentered ? "" : ""}`}>{children}</div>}

        <div className="flex gap-4 w-full">
          <Button onClick={handleCancel} variant="outline" className="flex-1 flex items-center justify-center gap-2 border-red-500/50 hover:border-red-500 hover:bg-red-500/10 text-red-500" disabled={isLoading}>
            {cancelIcon || <IconCircleX className="h-5 w-5" />}
            {cancelText}
          </Button>

          <Button onClick={handleConfirm} className={`flex-1 flex items-center justify-center gap-2 ${variantClasses[variant]}`} disabled={isLoading}>
            {isLoading ? (
              <>
                <IconLoader2 className="h-4 w-4 animate-spin" />
                {loadingText}
              </>
            ) : (
              <>
                {confirmIcon || <IconCircleCheck className="h-5 w-5" />}
                {confirmText}
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}



