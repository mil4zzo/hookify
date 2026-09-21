"use client";

import React, { useId } from "react";
import { IconUsers } from "@tabler/icons-react";
import { MetaIcon, GoogleSheetsIcon } from "@/components/icons";
import { cn } from "@/lib/utils/cn";

/**
 * O desenho da pasta. Duas camadas em SVG, cada uma com o seu relevo.
 *
 * A camada de TRÁS tem o topo reto; o recorte de aba que se vê é ela aparecendo
 * ACIMA da frente. A camada da FRENTE é alta à esquerda e desce em S com a
 * inflexão no centro horizontal (x=85 de 170) — é esse degrau que lê como pasta.
 * Desenhar a aba na camada de trás (o caminho intuitivo) produz uma caixa, não
 * uma pasta.
 *
 * Cor: `--folder-back` / `--folder-front`, definidos em globals.css. Eles NÃO
 * saem da escada de superfícies de propósito — ver o comentário lá.
 */

const VIEW_BOX = "0 0 170 128";

const BACK_PATH = "M18 10H144Q156 10 156 22V94Q156 107 143 107H18Q6 107 6 94V22Q6 10 18 10Z";
const FRONT_PATH = "M6 29Q6 16 19 16H62C70 16 77 18 85 24C93 30 98 31 108 31H143Q157 31 157 44V98Q157 112 143 112H19Q6 112 6 99Z";

/**
 * Recuo dos selos medido DENTRO da lombada, não da caixa: 13 unidades do viewBox
 * a partir da borda esquerda (x=6) e da base (y=112) da camada da frente. Em
 * porcentagem para acompanhar a pasta quando ela muda de tamanho.
 */
const BADGE_LEFT = `${(19 / 170) * 100}%`;
const BADGE_BOTTOM = `${(29 / 128) * 100}%`;

export interface FolderGlyphProps {
  /** Selos do que existe dentro, sem precisar abrir. */
  hasSheet?: boolean;
  hasShared?: boolean;
  /** Alvo de arrasto ativo: a lombada inclina e o contorno acende. */
  isDropTarget?: boolean;
  /** Pasta aberta no momento. */
  isCurrent?: boolean;
  className?: string;
}

export function FolderGlyph({ hasSheet = false, hasShared = false, isDropTarget = false, isCurrent = false, className }: FolderGlyphProps) {
  // Um degradê por instância: id duplicado no documento resolve para o primeiro
  // e amarraria todas as pastas ao ciclo de vida da que montou primeiro.
  const rawId = useId();
  const litId = `folder-lit-${rawId.replace(/:/g, "")}`;

  return (
    <div className={cn("relative w-full", className)} style={{ aspectRatio: "170 / 128" }}>
      {/* Camada de trás */}
      <svg viewBox={VIEW_BOX} aria-hidden="true" className="absolute inset-0 h-full w-full">
        <defs>
          {/* Luz na diagonal. Mesma receita do `.control-lit`, com o dobro da
              intensidade: a pasta é uma área grande e escura, onde o véu de um
              controle de 40px some. As paradas vêm de `.folder-glyph-lit`. */}
          <linearGradient id={litId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--lit-start)" />
            <stop offset="0.52" stopColor="var(--lit-mid)" />
            <stop offset="1" stopColor="var(--lit-end)" />
          </linearGradient>
        </defs>
        <path d={BACK_PATH} fill="var(--folder-back)" />
        <path d={BACK_PATH} fill={`url(#${litId})`} className="folder-glyph-lit" />
      </svg>

      {/* Camada da frente — inclina quando é alvo de arrasto */}
      <svg
        viewBox={VIEW_BOX}
        aria-hidden="true"
        className={cn(
          "absolute inset-0 h-full w-full origin-bottom transition-transform duration-500 ease-out",
          isDropTarget && "[transform:perspective(300px)_rotateX(-12deg)]",
        )}
      >
        <path d={FRONT_PATH} fill="var(--folder-front)" />
        <path d={FRONT_PATH} fill={`url(#${litId})`} className="folder-glyph-lit" />
        <path
          d={FRONT_PATH}
          fill="none"
          strokeWidth={2.5}
          className={cn("transition-[stroke] duration-200", isDropTarget || isCurrent ? "stroke-primary" : "stroke-transparent")}
        />
      </svg>

      {/* Selos sobre a lombada */}
      <div className="absolute z-10 flex items-center" style={{ left: BADGE_LEFT, bottom: BADGE_BOTTOM }}>
        <FolderBadge title="Meta Ads">
          <MetaIcon className="h-2.5 w-2.5 text-primary" />
        </FolderBadge>
        {hasSheet && (
          <FolderBadge title="Algum pack tem planilha conectada">
            <GoogleSheetsIcon className="h-2.5 w-2.5 text-success" />
          </FolderBadge>
        )}
        {hasShared && (
          <FolderBadge title="Algum pack é compartilhado">
            <IconUsers className="h-2.5 w-2.5 text-primary" />
          </FolderBadge>
        )}
      </div>
    </div>
  );
}

/**
 * Nível 0 sobre a lombada: o selo lê como um furo até a página, nos dois temas.
 * Sobrepostos, como numa pilha de etiquetas.
 */
function FolderBadge({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <span
      title={title}
      className="-mr-1 grid h-[18px] w-[18px] place-items-center rounded-full border border-border bg-background shadow-elevation-raised last:mr-0"
    >
      {children}
    </span>
  );
}
