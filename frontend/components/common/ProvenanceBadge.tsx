"use client";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface ProvenanceBadgeProps {
  /** Nomes já resolvidos (packs ou contas). Vazio → o badge não renderiza. */
  names: string[];
  /** Singular, para desambiguar um badge que mostra só o nome. Ex.: "Pack". */
  noun: string;
  /** Plural, usado na contagem. Ex.: "Packs", "Ad Accounts". */
  pluralNoun: string;
}

/** Mesmo vocabulário visual dos badges "Agrupado"/"Individual" do header do modal. */
const BADGE_CLASS = "rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground";

/**
 * Badge de procedência (pack / conta de anúncio) para o header do modal de detalhes.
 *
 * Um valor      → mostra o nome direto; não há lista a revelar, então nada de tooltip.
 * Mais de um    → mostra a contagem e revela os nomes no hover. É o caso comum em linhas
 *                 agregadas: ~17% das linhas da aba "Por anúncio" reúnem packs diferentes e
 *                 ~14% reúnem contas diferentes.
 */
export function ProvenanceBadge({ names, noun, pluralNoun }: ProvenanceBadgeProps) {
  if (names.length === 0) return null;

  if (names.length === 1) {
    // title (nativo) e não Tooltip: só desambigua qual dimensão é esta, sem virar um hover-alvo.
    return (
      <span className={`${BADGE_CLASS} inline-block max-w-[16rem] truncate align-middle`} title={`${noun}: ${names[0]}`}>
        {names[0]}
      </span>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`${BADGE_CLASS} cursor-help`}>{`${names.length} ${pluralNoun}`}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <ul className="space-y-0.5 text-xs">
            {names.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
