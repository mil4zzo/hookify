"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils/cn";

export interface AppDialogProps {
  /** Controla se o dialog está aberto */
  isOpen: boolean;
  /** Função chamada ao fechar o dialog */
  onClose: () => void;
  /** Conteúdo do dialog */
  children: React.ReactNode;
  /** Classe CSS customizada para o container do conteúdo */
  className?: string;
  /** Tamanho máximo do dialog (padrão: 'lg') */
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "full";
  /** Padding customizado (padrão: 'md') */
  padding?: "none" | "sm" | "md" | "lg" | "xl";
  /** Se deve mostrar o botão de fechar (padrão: true) */
  showCloseButton?: boolean;
  /** Se clicar no overlay fecha o dialog (padrão: true) */
  closeOnOverlayClick?: boolean;
  /** Se pressionar ESC fecha o dialog (padrão: true) */
  closeOnEscape?: boolean;
  /** Opacidade do background overlay (padrão: 0.8). Ignorado se overlay usar variável CSS. */
  overlayOpacity?: number;
  /** Classe CSS customizada para o overlay */
  overlayClassName?: string;
  /** Título acessível (para leitores de tela). Se não informado, usa "Dialog". */
  title?: string;
}

const sizeClasses: Record<NonNullable<AppDialogProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  full: "max-w-full mx-4",
};

const paddingClasses: Record<NonNullable<AppDialogProps["padding"]>, string> = {
  none: "p-0",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
  xl: "p-10",
};

/**
 * Wrapper de dialog que usa Radix UI por dentro e expõe API compatível com o Modal
 * (isOpen, onClose, size, padding, etc.). Garante foco inicial e focus trap para acessibilidade.
 */
export function AppDialog({ isOpen, onClose, children, className, size = "lg", padding = "md", showCloseButton = true, closeOnOverlayClick = true, closeOnEscape = true, overlayOpacity = 0.8, overlayClassName, title }: AppDialogProps) {
  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );

  const handleInteractOutside = React.useCallback(
    (e: Event) => {
      if (!closeOnOverlayClick) e.preventDefault();
    },
    [closeOnOverlayClick],
  );

  const handleEscapeKeyDown = React.useCallback(
    (e: KeyboardEvent) => {
      if (!closeOnEscape) e.preventDefault();
    },
    [closeOnEscape],
  );

  const overlayStyle = overlayOpacity !== 0.8 ? { backgroundColor: `rgba(0, 0, 0, ${overlayOpacity})` } : undefined;

  const contentRef = React.useRef<HTMLDivElement>(null);

  const handleOpenAutoFocus = React.useCallback((e: Event) => {
    e.preventDefault();
    contentRef.current?.focus();
  }, []);

  return (
    <DialogPrimitive.Root open={isOpen} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={cn("fixed inset-0 z-50 bg-overlay data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0", overlayClassName)} style={overlayStyle} />
        <DialogPrimitive.Content onOpenAutoFocus={handleOpenAutoFocus} onInteractOutside={handleInteractOutside} onEscapeKeyDown={handleEscapeKeyDown} className={cn("fixed left-[50%] top-[50%] z-50 w-full translate-x-[-50%] translate-y-[-50%]", "border border-border bg-card shadow-lg rounded-lg", "max-h-[90vh] overflow-y-auto", "duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out", "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0", "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95", "data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]", "data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]", sizeClasses[size], paddingClasses[padding], className)}>
          <DialogPrimitive.Title className="sr-only">{title ?? "Dialog"}</DialogPrimitive.Title>
          {showCloseButton && (
            <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-30 disabled:cursor-not-allowed z-10 text-text" aria-label="Fechar">
              <IconX className="h-4 w-4" />
            </DialogPrimitive.Close>
          )}
          <div ref={contentRef} tabIndex={-1} className="outline-none">
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
