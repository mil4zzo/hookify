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
  bodyClassName?: string;
  /** Tamanho máximo do dialog (padrão: 'lg') */
  size?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl" | "full";
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
  /** Variante de apresentação no mobile. "bottom-sheet" ancora na base da tela com slide-up. */
  mobileVariant?: "center" | "bottom-sheet";
}

const sizeClasses: Record<NonNullable<AppDialogProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "5xl": "max-w-[calc(100vw-2rem)] md:max-w-5xl mx-4",
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
export function AppDialog({ isOpen, onClose, children, className, bodyClassName, size = "lg", padding = "md", showCloseButton = true, closeOnOverlayClick = true, closeOnEscape = true, overlayOpacity = 0.8, overlayClassName, title, mobileVariant = "center" }: AppDialogProps) {
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
        <DialogPrimitive.Overlay className={cn("fixed inset-0 z-overlay bg-overlay data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0", overlayClassName)} style={overlayStyle} />
        <DialogPrimitive.Content onOpenAutoFocus={handleOpenAutoFocus} onInteractOutside={handleInteractOutside} onEscapeKeyDown={handleEscapeKeyDown} className={cn(
          // Base
          "fixed z-modal border border-border bg-card shadow-elevation-overlay duration-200 outline-none focus:outline-none focus-visible:outline-none ring-0 focus:ring-0 focus-visible:ring-0",
          "data-[state=open]:animate-in data-[state=closed]:animate-out",
          "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          // Variante mobile
          mobileVariant === "bottom-sheet"
            ? cn(
                // Mobile: bottom-sheet (full-width, anchored to bottom)
                "left-0 right-0 bottom-0 w-full rounded-t-2xl max-h-[95vh] overflow-hidden",
                "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom",
                // Desktop: centered dialog (override mobile positioning)
                "md:left-[50%] md:right-auto md:bottom-auto md:top-[50%] md:w-full",
                "md:translate-x-[-50%] md:translate-y-[-50%] md:rounded-lg md:rounded-t-lg md:max-h-[90vh] md:overflow-y-auto",
                "md:data-[state=closed]:zoom-out-95 md:data-[state=open]:zoom-in-95",
                "md:data-[state=closed]:slide-out-to-left-1/2 md:data-[state=closed]:slide-out-to-top-[48%]",
                "md:data-[state=open]:slide-in-from-left-1/2 md:data-[state=open]:slide-in-from-top-[48%]"
              )
            : cn(
                // Always centered
                "left-[50%] top-[50%] w-full translate-x-[-50%] translate-y-[-50%] rounded-lg max-h-[90vh] overflow-y-auto",
                "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
                "data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%]",
                "data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%]"
              ),
          sizeClasses[size], paddingClasses[padding], className
        )}>
          <DialogPrimitive.Title className="sr-only">{title ?? "Dialog"}</DialogPrimitive.Title>
          {showCloseButton && (
            <DialogPrimitive.Close className={cn("absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-30 disabled:cursor-not-allowed z-10 text-text", mobileVariant === "bottom-sheet" && "hidden md:flex")} aria-label="Fechar">
              <IconX className="h-4 w-4" />
            </DialogPrimitive.Close>
          )}
          <div ref={contentRef} tabIndex={-1} className={cn("outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0", bodyClassName)}>
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
