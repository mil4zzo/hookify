"use client";

import React, { useMemo, useState } from "react";
import { IconTag, IconX } from "@tabler/icons-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TagCombobox } from "@/components/manager/TagCombobox";
import { useAssignTags, useCreateTag, useUnassignTags } from "@/lib/api/hooks";
import type { RankingsRowTag, TagItem } from "@/lib/api/schemas";
import type { TagColor } from "@/lib/tags/colors";
import { tagChipClasses } from "@/lib/tags/colors";
import { cn } from "@/lib/utils/cn";

/** Chip de leitura. Usada na célula da tabela e no resumo da seleção em massa. */
export function TagChip({
  name,
  color,
  onRemove,
  className,
}: {
  name: string;
  color?: string | null;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-medium leading-none",
        tagChipClasses(color),
        className,
      )}
    >
      <span className="truncate">{name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="shrink-0 opacity-60 transition-opacity hover:opacity-100"
          aria-label={`Remover tag ${name}`}
        >
          <IconX className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

/**
 * Tags de UM criativo.
 *
 * Aqui NÃO há seletor de ação "Adicionar/Remover" como no diálogo em massa: as
 * tags do criativo estão à vista, cada uma com o seu ×. Exigir escolher um modo
 * para remover o que já está na tela seria um passo a mais para nada.
 *
 * O clique não pode subir: a linha inteira abre o drill do anúncio.
 */
export function TagsCell({ adName, tags }: { adName: string; tags: RankingsRowTag[] }) {
  const [open, setOpen] = useState(false);
  const assign = useAssignTags();
  const unassign = useUnassignTags();
  const createTag = useCreateTag();

  const appliedIds = useMemo(() => new Set(tags.map((t) => t.id)), [tags]);

  const handleSelect = (tag: TagItem) => {
    assign.mutate({ tags: [tag], adNames: [adName] });
  };

  // Cria e aplica numa tacada: nesta superfície não existe um "confirmar" depois
  // onde a criação pudesse acontecer, então adiar não traria nada.
  //
  // O `await` no assign é o que mantém o spinner até o chip existir. Sem ele o
  // dropdown fecharia assim que a tag fosse criada e a linha ficaria um instante
  // sem o chip — o mesmo flicker de "parece que deu errado".
  const handleCreate = async (name: string, color: TagColor) => {
    const created = await createTag.mutateAsync({ name, color });
    if (created?.data) await assign.mutateAsync({ tags: [created.data], adNames: [adName] });
  };

  const handleRemove = (tag: RankingsRowTag) => {
    unassign.mutate({ tags: [{ id: tag.id, name: tag.name, color: tag.color }], adNames: [adName] });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="flex w-full flex-wrap items-center gap-1 rounded px-1 py-0.5 text-left transition-colors hover:bg-muted"
          aria-label={`Editar tags de ${adName}`}
        >
          {tags.length === 0 ? (
            <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
              <IconTag className="h-3 w-3" />
              Marcar
            </span>
          ) : (
            tags.map((tag) => <TagChip key={tag.id} name={tag.name} color={tag.color} />)
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-64 p-2" align="start" onClick={(e) => e.stopPropagation()}>
        {tags.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1 border-b border-border pb-2">
            {tags.map((tag) => (
              <TagChip key={tag.id} name={tag.name} color={tag.color} onRemove={() => handleRemove(tag)} />
            ))}
          </div>
        )}

        <TagCombobox
          excludeIds={appliedIds}
          createMode="immediate"
          onSelect={handleSelect}
          onCreate={handleCreate}
          placeholder="Adicionar tag..."
        />
      </PopoverContent>
    </Popover>
  );
}
