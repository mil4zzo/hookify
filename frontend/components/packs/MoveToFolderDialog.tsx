"use client";

import React from "react";
import { IconArrowBackUp, IconFolder, IconFolderPlus } from "@tabler/icons-react";
import { AppDialog } from "@/components/common/AppDialog";
import { StatePanel } from "@/components/common/States";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import type { FolderBucket } from "@/lib/utils/folderTree";

const MAX_NAME_LEN = 60; // espelha o CHECK folders_name_max_len da migration 168

export interface MoveToFolderDialogProps {
  isOpen: boolean;
  /** Packs a mover. O nome só aparece quando é um só — com N, o número é a informação. */
  packIds: string[];
  singlePackName?: string | null;
  /** Topo da árvore; cada nó traz as subpastas em `children` (`rootBuckets` do useFolders). */
  rootBuckets: FolderBucket[];
  /** Vínculo atual {pack_id: folder_id} — decide o "atual" e se cabe "Tirar da pasta". */
  folderIdByPack: Record<string, string>;
  onClose: () => void;
  /** Mover para uma pasta existente; `null` tira da pasta. */
  onMove: (folderId: string | null) => void;
  /** Criar a pasta e já mover para dentro dela. */
  onCreateAndMove: (name: string) => void;
}

/**
 * Escolhe a pasta de destino. Existe porque arrastar é o gesto bom para dois ou três
 * cards que estão na tela, e péssimo para vinte selecionados ou para um pack que está
 * no fim da rolagem: some o alvo, ou some o card.
 *
 * Escolher a pasta JÁ MOVE — não há um segundo botão "Confirmar". Mover é reversível
 * (o toast traz "Desfazer", igual ao arrasto), e confirmar o que já foi escolhido só
 * adiciona um clique. A exceção é a pasta nova, que precisa do nome antes.
 */
export function MoveToFolderDialog({ isOpen, packIds, singlePackName, rootBuckets, folderIdByPack, onClose, onMove, onCreateAndMove }: MoveToFolderDialogProps) {
  const [isNaming, setIsNaming] = React.useState(false);
  const [name, setName] = React.useState("");

  // Reabrir sempre começa na lista: o estado do "nova pasta" é da sessão do diálogo.
  React.useEffect(() => {
    if (!isOpen) return;
    setIsNaming(false);
    setName("");
  }, [isOpen]);

  const count = packIds.length;
  const currentFolderIds = new Set(packIds.map((id) => folderIdByPack[id]).filter(Boolean));
  // "Atual" só existe quando TODOS vieram da mesma pasta — com origens diferentes,
  // nenhuma delas é a origem da seleção.
  const commonFolderId = currentFolderIds.size === 1 ? Array.from(currentFolderIds)[0] : null;
  const someInFolder = currentFolderIds.size > 0;

  const trimmed = name.trim();
  const siblingNames = rootBuckets.map((b) => b.folder.name);
  const isDuplicate = trimmed.length > 0 && siblingNames.some((n) => n.toLocaleLowerCase("pt-BR") === trimmed.toLocaleLowerCase("pt-BR"));
  const canCreate = trimmed.length > 0 && trimmed.length <= MAX_NAME_LEN && !isDuplicate;

  const subject = count === 1 ? (singlePackName ? `“${singlePackName}”` : "1 pack") : `${count} packs`;

  const handleMove = (folderId: string | null) => {
    onMove(folderId);
    onClose();
  };

  const handleCreate = () => {
    if (!canCreate) return;
    onCreateAndMove(trimmed);
    onClose();
  };

  /** Subpasta entra recuada com o mesmo fio da árvore da Biblioteca — o mesmo desenho
      que a pessoa acabou de ver na página, para a hierarquia ser a mesma coisa nos dois. */
  const renderBucket = (bucket: FolderBucket): React.ReactNode => {
    const isCurrent = bucket.folder.id === commonFolderId;
    const total = bucket.allPacks.length;
    return (
      <React.Fragment key={bucket.folder.id}>
        <button
          type="button"
          disabled={isCurrent}
          onClick={() => handleMove(bucket.folder.id)}
          className={cn(
            "focus-inset flex h-control-default items-center gap-2.5 rounded-md border border-border bg-surface-2 px-3 text-left text-sm transition-colors",
            isCurrent ? "cursor-default opacity-50" : "hover:border-primary hover:bg-primary-10",
          )}
        >
          <IconFolder className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium text-foreground">{bucket.folder.name}</span>
          <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{isCurrent ? "atual" : `${total} ${total === 1 ? "pack" : "packs"}`}</span>
        </button>
        {bucket.children.length > 0 ? <div className="ml-4 flex flex-col gap-1.5 border-l border-border pl-3">{bucket.children.map(renderBucket)}</div> : null}
      </React.Fragment>
    );
  };

  return (
    <AppDialog isOpen={isOpen} onClose={onClose} title="Mover para pasta" size="md" padding="md" closeOnOverlayClick closeOnEscape showCloseButton>
      <div className="flex flex-col gap-6">
        {/* O `title` do AppDialog é só para leitor de tela — o título visível é este. */}
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">Mover para pasta</h2>
          <p className="text-sm text-muted-foreground">
            {subject} {count === 1 ? "vai" : "vão"} para a pasta que você escolher. Um pack mora em uma pasta só — mover para cá o tira de onde estava.
          </p>
        </header>

        {isNaming ? (
          <div className="flex flex-col gap-2">
            <label htmlFor="move-new-folder" className="text-xs font-medium text-foreground">
              Nome da pasta
            </label>
            <Input
              id="move-new-folder"
              value={name}
              autoFocus
              maxLength={MAX_NAME_LEN}
              placeholder="Ex.: Cliente · Lançamento"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreate();
                }
              }}
              aria-invalid={isDuplicate}
            />
            {isDuplicate ? <span className="text-xs text-destructive">Já existe uma pasta com esse nome na raiz.</span> : <span className="text-xs text-muted-foreground">A pasta nasce na raiz da Biblioteca.</span>}
          </div>
        ) : rootBuckets.length === 0 ? (
          <StatePanel kind="empty" title="Nenhuma pasta ainda" message="Crie a primeira e os packs selecionados já entram nela." icon={IconFolder} frame="none" density="compact" />
        ) : (
          /* Lista de opções dentro do diálogo: nível 2 da escada ("opção não escolhida"),
             com rolagem quando a árvore passa de umas seis pastas. */
          <div className="-mx-1 flex max-h-72 flex-col gap-1.5 overflow-y-auto px-1">{rootBuckets.map(renderBucket)}</div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3">
          {/* Tirar da pasta é o oposto do movimento, não uma pasta da lista: fica com os
              botões, à esquerda, longe do alvo que a pessoa está mirando. */}
          {!isNaming && someInFolder ? (
            <Button variant="outline" className="mr-auto" onClick={() => handleMove(null)}>
              <IconArrowBackUp />
              Tirar da pasta
            </Button>
          ) : null}

          {isNaming ? (
            <>
              <Button variant="outline" onClick={() => setIsNaming(false)}>
                Voltar
              </Button>
              <Button onClick={handleCreate} disabled={!canCreate}>
                {`Criar e mover ${count}`}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button onClick={() => setIsNaming(true)}>
                <IconFolderPlus />
                Nova pasta
              </Button>
            </>
          )}
        </div>
      </div>
    </AppDialog>
  );
}
