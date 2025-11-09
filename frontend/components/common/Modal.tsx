"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";

export interface ModalProps {
  /** Controla se o modal está aberto */
  isOpen: boolean;
  /** Função chamada ao fechar o modal */
  onClose: () => void;
  /** Conteúdo do modal (variável) */
  children: React.ReactNode;
  /** Classe CSS customizada para o container do modal */
  className?: string;
  /** Tamanho máximo do modal (padrão: 'lg') */
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "full";
  /** Padding customizado (padrão: '6') */
  padding?: "none" | "sm" | "md" | "lg" | "xl";
  /** Se deve mostrar o botão de fechar (padrão: true) */
  showCloseButton?: boolean;
  /** Se clicar no overlay fecha o modal (padrão: true) */
  closeOnOverlayClick?: boolean;
  /** Se pressionar ESC fecha o modal (padrão: true) */
  closeOnEscape?: boolean;
  /** Opacidade do background overlay (padrão: 0.8) */
  overlayOpacity?: number;
  /** Classe CSS customizada para o overlay */
  overlayClassName?: string;
}

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  full: "max-w-full mx-4",
};

const paddingClasses = {
  none: "p-0",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
  xl: "p-10",
};

export function Modal({ isOpen, onClose, children, className, size = "lg", padding = "md", showCloseButton = true, closeOnOverlayClick = true, closeOnEscape = true, overlayOpacity = 0.8, overlayClassName }: ModalProps) {
  // Fechar ao pressionar ESC
  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, closeOnEscape, onClose]);

  // Prevenir scroll do body quando o modal está aberto
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (closeOnOverlayClick && e.target === e.currentTarget) {
      onClose();
    }
  };

  const overlayStyle = {
    backgroundColor: `rgba(0, 0, 0, ${overlayOpacity})`,
  };

  const modalContent = (
    <div className={cn("fixed inset-0 z-[9999] flex items-center justify-center", overlayClassName)} style={overlayStyle} onClick={handleOverlayClick}>
      <div className={cn("m-0 relative bg-card border border-border rounded-lg shadow-lg", "max-h-[90vh] overflow-y-auto custom-scrollbar w-full", sizeClasses[size], paddingClasses[padding], className)} onClick={(e) => e.stopPropagation()}>
        {showCloseButton && (
          <button onClick={onClose} className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 z-10" aria-label="Fechar modal">
            <IconX className="h-4 w-4 text-text" />
          </button>
        )}
        {children}
      </div>
    </div>
  );

  // Use portal to render modal at body level to avoid z-index and positioning issues
  if (typeof window !== "undefined") {
    return createPortal(modalContent, document.body);
  }

  return null;
}
