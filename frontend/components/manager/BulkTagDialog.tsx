"use client";

import React, { useEffect, useMemo, useState } from "react";
import { IconLoader2, IconPlus, IconX } from "@tabler/icons-react";

import { AppDialog } from "@/components/common/AppDialog";
import { Button } from "@/components/ui/button";
import { TagChip } from "@/components/manager/TagsCell";
import { TagCombobox } from "@/components/manager/TagCombobox";
import { nextTagColor } from "@/lib/tags/colors";
import { useAssignTags, useCreateTag, useTags, useUnassignTags } from "@/lib/api/hooks";
import { useTagScope } from "@/components/manager/TagScopeProvider";
import type { RankingsRowTag, TagItem } from "@/lib/api/schemas";
import { cn } from "@/lib/utils/cn";

type BulkTagMode = "add" | "remove";

/** Tag ainda não criada, escolhida via "Criar ...". Só existe até o confirmar. */
interface DraftTag {
  draftName: string;
}

type StagedTag = TagItem | DraftTag;

const isDraft = (tag: StagedTag): tag is DraftTag => "draftName" in tag;
const stagedKey = (tag: StagedTag) => (isDraft(tag) ? `draft:${tag.draftName}` : tag.id);
const stagedName = (tag: StagedTag) => (isDraft(tag) ? tag.draftName : tag.name);

interface BulkTagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Criativos selecionados: nome + as tags que cada um já tem. */
  selection: { adName: string; tags: RankingsRowTag[] }[];
  onApplied?: () => void;
}

/**
 * Marcação em massa sobre a seleção atual.
 *
 * É um formulário de AÇÃO ("adicionar estas tags" / "remover estas tags"), não um
 * editor de estado. Com N criativos não existe um estado único para editar — um
 * checkbox marcado significaria coisas diferentes para cada linha da seleção. A
 * informação que o tri-state dava ("marcada em alguns") reaparece como contagem
 * ao lado de cada tag no dropdown, que é mais preciso.
 *
 * É um SNAPSHOT: resolve os criativos selecionados agora e grava. Não cria regra —
 * um criativo que aparecer depois não herda nada.
 */
export function BulkTagDialog({ open, onOpenChange, selection, onApplied }: BulkTagDialogProps) {
  const assign = useAssignTags();
  const unassign = useUnassignTags();
  const createTag = useCreateTag();
  const { packIds } = useTagScope();
  const { data: tagsData } = useTags(packIds);

  const [mode, setMode] = useState<BulkTagMode>("add");
  const [staged, setStaged] = useState<StagedTag[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const adNames = useMemo(() => selection.map((s) => s.adName), [selection]);

  // Quantos da seleção já têm cada tag. Alimenta o "em 3 de 12" no dropdown e
  // define quais tags o modo "Remover" pode oferecer.
  const usageInSelection = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of selection) {
      for (const tag of item.tags) counts.set(tag.id, (counts.get(tag.id) ?? 0) + 1);
    }
    return counts;
  }, [selection]);

  const presentIds = useMemo(() => new Set(usageInSelection.keys()), [usageInSelection]);
  const stagedIds = useMemo(
    () => new Set(staged.filter((t): t is TagItem => !isDraft(t)).map((t) => t.id)),
    [staged],
  );

  // Trocar de modo zera a escolha: "adicionar X" e "remover X" são intenções
  // opostas, e carregar a seleção de uma para a outra é convite a engano.
  const handleModeChange = (next: BulkTagMode) => {
    if (next === mode) return;
    setMode(next);
    setStaged([]);
  };

  useEffect(() => {
    if (!open) {
      setStaged([]);
      setMode("add");
    }
  }, [open]);

  const describeTag = (tag: TagItem) => {
    const count = usageInSelection.get(tag.id) ?? 0;
    if (count === 0) return null;
    if (count === selection.length) return "em todos";
    return `em ${count} de ${selection.length}`;
  };

  const handleSubmit = async () => {
    if (staged.length === 0 || adNames.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (mode === "remove") {
        // Draft não existe no modo remover — nada a criar.
        const tags = staged.filter((t): t is TagItem => !isDraft(t));
        if (tags.length > 0) await unassign.mutateAsync({ tags, adNames, packIds });
      } else {
        // As tags novas nascem só agora: quem desistiu no meio não deixou lixo.
        const resolved: TagItem[] = [];
        let colorSeed = tagsData?.data?.length ?? 0;
        for (const tag of staged) {
          if (!isDraft(tag)) {
            resolved.push(tag);
            continue;
          }
          const created = await createTag.mutateAsync({
            name: tag.draftName,
            color: nextTagColor(colorSeed++),
            packIds,
          });
          if (created?.data) resolved.push(created.data);
        }
        if (resolved.length > 0) await assign.mutateAsync({ tags: resolved, adNames, packIds });
      }
      onApplied?.();
      onOpenChange(false);
    } catch {
      // showError já foi disparado pelo hook; mantém o diálogo aberto com a seleção
      // intacta para o usuário tentar de novo sem remontar tudo.
    } finally {
      setIsSubmitting(false);
    }
  };

  const noun = selection.length === 1 ? "criativo" : "criativos";
  const actionLabel = mode === "add" ? "Adicionar" : "Remover";
  const nothingToRemove = mode === "remove" && presentIds.size === 0;

  return (
    <AppDialog
      isOpen={open}
      onClose={() => onOpenChange(false)}
      size="sm"
      title={`Tags de ${selection.length} ${noun}`}
    >
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">
          Tags de {selection.length} {noun}
        </h2>

        {/* Seletor de ação. Sem ele, um checkbox teria significado diferente em
            cada linha da seleção — "marcado" não descreve N criativos. */}
        <div className="flex rounded-md border border-border p-0.5" role="tablist">
          {(["add", "remove"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={mode === option}
              onClick={() => handleModeChange(option)}
              className={cn(
                "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors",
                mode === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option === "add" ? "Adicionar tag" : "Remover tag"}
            </button>
          ))}
        </div>

        {staged.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {staged.map((tag) => (
              <TagChip
                key={stagedKey(tag)}
                name={stagedName(tag)}
                color={isDraft(tag) ? undefined : tag.color}
                className={isDraft(tag) ? "border-dashed" : undefined}
                onRemove={() => setStaged((prev) => prev.filter((t) => stagedKey(t) !== stagedKey(tag)))}
              />
            ))}
          </div>
        )}

        {nothingToRemove ? (
          <p className="text-2xs text-muted-foreground">
            Nenhum dos criativos selecionados tem tag para remover.
          </p>
        ) : (
          <TagCombobox
            excludeIds={stagedIds}
            // No modo remover só faz sentido oferecer o que a seleção realmente tem.
            onlyIds={mode === "remove" ? presentIds : null}
            describeTag={describeTag}
            // "Criar" não existe ao remover: não se remove o que não existe.
            createMode={mode === "remove" ? "off" : "draft"}
            onSelect={(tag) => setStaged((prev) => [...prev, tag])}
            onCreateDraft={(name) =>
              setStaged((prev) =>
                prev.some((t) => stagedName(t).toLowerCase() === name.toLowerCase())
                  ? prev
                  : [...prev, { draftName: name }],
              )
            }
            placeholder={mode === "add" ? "Escolher ou criar tag..." : "Escolher tag para remover..."}
            disabled={isSubmitting}
          />
        )}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            variant={mode === "remove" ? "destructive" : "default"}
            size="sm"
            onClick={() => void handleSubmit()}
            disabled={staged.length === 0 || isSubmitting}
          >
            {isSubmitting ? (
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
            ) : mode === "add" ? (
              <IconPlus className="h-3.5 w-3.5" />
            ) : (
              <IconX className="h-3.5 w-3.5" />
            )}
            {actionLabel}
          </Button>
        </div>
      </div>
    </AppDialog>
  );
}
