"use client";

import React, { useMemo, useRef, useState } from "react";
import { IconChevronDown, IconLoader2, IconPlus } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePopoverWheelScroll } from "@/lib/hooks/usePopoverWheelScroll";
import { useTags } from "@/lib/api/hooks";
import { useTagScope } from "@/components/manager/TagScopeProvider";
import type { TagItem } from "@/lib/api/schemas";
import { nextTagColor, tagDotClasses, type TagColor } from "@/lib/tags/colors";
import { isTagNameTaken, normalizeTagName } from "@/lib/tags/naming";
import { cn } from "@/lib/utils/cn";

export interface TagComboboxProps {
  /** Tags que já estão escolhidas/aplicadas — saem da lista. */
  excludeIds?: Set<string>;
  /** Quando definido, só estas tags aparecem (modo "Remover": só o que a seleção tem). */
  onlyIds?: Set<string> | null;
  /** Sufixo à direita de cada tag, ex.: "em 3 de 12". */
  describeTag?: (tag: TagItem) => string | null;
  /**
   * "immediate" cria de fato ao escolher (célula: não há botão de confirmar depois).
   * "draft"     só devolve o nome, e quem cria é o submit (modal em massa).
   * "off"       sem opção de criar (modo "Remover" — não se remove o que não existe).
   */
  createMode?: "immediate" | "draft" | "off";
  onSelect: (tag: TagItem) => void;
  /** Só em createMode="immediate"; deve resolver quando a tag existir. */
  onCreate?: (name: string, color: TagColor) => Promise<void>;
  /** Só em createMode="draft". */
  onCreateDraft?: (name: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Dropdown compacto e pesquisável de tags, com "Criar ..." embutido.
 *
 * Substituiu a lista multi-select com checkboxes: em vocabulário grande a lista
 * não cabia, e a criação exigia um bloco separado com seletor de cor.
 */
export function TagCombobox({
  excludeIds,
  onlyIds,
  describeTag,
  createMode = "immediate",
  onSelect,
  onCreate,
  onCreateDraft,
  placeholder = "Buscar ou criar tag...",
  disabled = false,
  className,
}: TagComboboxProps) {
  // O vocabulario e do SILO do pack, nao do usuario: sem o escopo, o convidado
  // veria a propria lista vazia em vez das tags do pack compartilhado.
  const { packIds } = useTagScope();
  const { data, isLoading } = useTags(packIds);
  const [open, setOpen] = useState(false);
  // Roda do mouse dentro de dialogo (BulkTagDialog): ver o hook.
  const listRef = useRef<HTMLDivElement>(null);
  const listWheelRef = usePopoverWheelScroll(listRef);
  const [query, setQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const allTags = useMemo(() => data?.data ?? [], [data]);
  const trimmed = query.trim();

  const visible = useMemo(() => {
    const needle = normalizeTagName(trimmed);
    return allTags.filter((tag) => {
      if (excludeIds?.has(tag.id)) return false;
      if (onlyIds && !onlyIds.has(tag.id)) return false;
      if (!needle) return true;
      return normalizeTagName(tag.name).includes(needle);
    });
  }, [allTags, excludeIds, onlyIds, trimmed]);

  // Compara pelo slug normalizado, não pelo texto cru: "Black Friday" e
  // "black  friday" colidem no unique index do banco, então oferecer "Criar" na
  // segunda forma só produziria um 409.
  const nameTaken = useMemo(
    () => isTagNameTaken(trimmed, allTags.map((tag) => tag.name)),
    [allTags, trimmed],
  );

  const canOfferCreate = createMode !== "off" && Boolean(trimmed) && !nameTaken;

  const handleCreate = async () => {
    if (!canOfferCreate || isCreating) return;

    if (createMode === "draft") {
      onCreateDraft?.(trimmed);
      setQuery("");
      setOpen(false);
      return;
    }

    if (!onCreate) return;
    setIsCreating(true);
    try {
      await onCreate(trimmed, nextTagColor(allTags.length));
      setQuery("");
      setOpen(false);
    } finally {
      // Sempre libera: em erro o popover fica aberto com o texto, para tentar de novo.
      setIsCreating(false);
    }
  };

  const handlePick = (tag: TagItem) => {
    onSelect(tag);
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          role="combobox"
          aria-expanded={open}
          className={cn("w-full justify-between font-normal text-muted-foreground", className)}
        >
          <span className="truncate">{placeholder}</span>
          <IconChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-56 p-0 z-dropdown"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e) => {
          // Foca a busca, não o primeiro item: digitar é a ação principal aqui.
          e.preventDefault();
          inputRef.current?.focus();
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border p-2">
          <Input
            ref={inputRef}
            size="sm"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                // Enter escolhe o único resultado; se não houver nenhum, cria.
                if (visible.length === 1) handlePick(visible[0]);
                else if (visible.length === 0 && canOfferCreate) void handleCreate();
              }
              if (e.key === "Escape") setOpen(false);
            }}
            placeholder="Buscar ou criar tag..."
          />
        </div>

        <div ref={listWheelRef} className="max-h-56 overflow-y-auto p-1">
          {canOfferCreate && (
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={isCreating}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted disabled:opacity-70"
            >
              {isCreating ? (
                <IconLoader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : (
                <IconPlus className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">
                {isCreating ? "Criando" : "Criar"} &quot;{trimmed}&quot;
              </span>
            </button>
          )}

          {isLoading && <p className="px-2 py-2 text-2xs text-muted-foreground">Carregando tags...</p>}

          {!isLoading && visible.length === 0 && !canOfferCreate && (
            <p className="px-2 py-2 text-2xs text-muted-foreground">
              {trimmed ? "Nenhuma tag encontrada." : "Nenhuma tag disponível."}
            </p>
          )}

          {visible.map((tag) => {
            const description = describeTag?.(tag);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => handlePick(tag)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-muted"
              >
                <span className={cn("h-2 w-2 shrink-0 rounded-full", tagDotClasses(tag.color))} />
                <span className="truncate text-xs">{tag.name}</span>
                {description && (
                  <span className="ml-auto shrink-0 text-2xs text-muted-foreground">{description}</span>
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
