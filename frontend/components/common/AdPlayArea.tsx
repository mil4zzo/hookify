"use client";

import { IconPhoto, IconPlayerPlayFilled } from "@tabler/icons-react";
import Image from "next/image";
import { getAdThumbnail } from "@/lib/utils/thumbnailFallback";
import { cn } from "@/lib/utils/cn";
import type { CSSProperties } from "react";

export type AdPlayAreaAspectRatio = "1:1" | "3:4" | "9:16";

interface AdPlayAreaProps {
  /** Objeto ad (será usado getAdThumbnail para obter a thumbnail) */
  ad?: any;
  /** URL da thumbnail diretamente (sobrescreve ad se fornecido) */
  thumbnailUrl?: string | null;
  /** Alt text para a imagem */
  alt?: string;
  /** Aspect ratio da thumbnail */
  aspectRatio?: AdPlayAreaAspectRatio;
  /** Tamanho customizado (width em pixels ou Tailwind class) */
  size?: number | string;
  /** Classes CSS adicionais para o container */
  className?: string;
  /** Callback quando o botão de play é clicado */
  onPlayClick?: (e: React.MouseEvent) => void;
  /** Se true, desabilita o botão de play */
  disablePlay?: boolean;
  /** Se true, mostra o botão de play sempre (não apenas no hover) */
  alwaysShowPlay?: boolean;
  /** Tamanho do botão de play (em pixels) */
  playButtonSize?: number;
}

const ASPECT_RATIO_CLASSES: Record<AdPlayAreaAspectRatio, string> = {
  "1:1": "aspect-square",
  "3:4": "aspect-[3/4]",
  "9:16": "aspect-[9/16]",
};

export function AdPlayArea({ ad, thumbnailUrl, alt, aspectRatio = "3:4", size, className, onPlayClick, disablePlay = false, alwaysShowPlay = false, playButtonSize = 24 }: AdPlayAreaProps) {
  // Obter thumbnail: priorizar thumbnailUrl, senão usar getAdThumbnail(ad)
  const thumbnail = thumbnailUrl || (ad ? getAdThumbnail(ad) : null);
  const altText = alt || (ad?.ad_name ? `${ad.ad_name} thumbnail` : "Ad thumbnail");

  // Calcular dimensões baseado em size
  const sizeStyle: CSSProperties = {};
  const sizeClass = typeof size === "string" ? size : undefined;

  if (typeof size === "number") {
    sizeStyle.width = `${size}px`;
    sizeStyle.height = `${size}px`;
  }

  const handlePlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onPlayClick && !disablePlay) {
      onPlayClick(e);
    }
  };

  return (
    <div className={cn("group relative flex-shrink-0 overflow-hidden rounded-md bg-black/40", !sizeClass && ASPECT_RATIO_CLASSES[aspectRatio], sizeClass, className)} style={Object.keys(sizeStyle).length > 0 ? sizeStyle : undefined}>
      {/* Thumbnail ou placeholder */}
      {thumbnail ? (
        <Image src={thumbnail} alt={altText} fill className="object-cover" sizes={typeof size === "number" ? `${size}px` : "96px"} />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <IconPhoto className={cn("text-muted-foreground opacity-50", typeof size === "number" && size < 60 ? "h-4 w-4" : typeof size === "number" && size < 80 ? "h-6 w-6" : "h-8 w-8")} />
        </div>
      )}

      {/* Overlay escuro suave */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-black/50 via-black/20 to-transparent" />

      {/* Overlay de background no hover */}
      <div className={cn("pointer-events-none absolute inset-0 bg-background-70 transition-opacity duration-500", alwaysShowPlay ? "opacity-100" : "opacity-0 group-hover:opacity-100")} />

      {/* Botão de play */}
      {!disablePlay && (
        <button className="absolute inset-0 flex items-center justify-center z-10 transition-opacity duration-500 opacity-100" onClick={handlePlayClick} aria-label="Reproduzir vídeo">
          <div
            className={cn(
              "flex items-center justify-center rounded-full transition-all duration-500",
              // Estado normal: cinza translúcido com blur
              "bg-gray-500/40 backdrop-blur-sm border border-border",
              // Hover: primary azul com shadow
              "group-hover:bg-primary group-hover:shadow-lg group-hover:shadow-[0_0_20px_rgba(20,71,230,0.6)]",
              // Scale no hover
              "scale-90 group-hover:scale-100"
            )}
            style={{
              width: `${playButtonSize}px`,
              height: `${playButtonSize}px`,
            }}
          >
            <IconPlayerPlayFilled
              className={cn(
                "ml-[1px] transition-colors duration-500",
                // Estado normal: branco com opacidade
                "text-white/90",
                // Hover: branco sólido
                "group-hover:text-white"
              )}
              style={{
                width: `${playButtonSize * 0.44}px`,
                height: `${playButtonSize * 0.44}px`,
              }}
            />
          </div>
        </button>
      )}
    </div>
  );
}
