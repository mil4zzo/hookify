"use client";

import { useEffect, useState } from "react";
import { IconLayoutBoard, IconLoader2, IconPencil, IconPlus, IconTrash } from "@tabler/icons-react";

import { AppDialog } from "@/components/common/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Board } from "@/lib/boards/types";

const MAX_NAME_LEN = 60; // espelha o CHECK boards_name_max_len (migration 119)

export interface BoardToolbarProps {
  boards: Board[];
  activeBoardId: string | null;
  onSelectBoard: (boardId: string) => void;
  onCreateBoard: (name: string) => Promise<void> | void;
  onRenameBoard: (boardId: string, name: string) => Promise<void> | void;
  onDeleteBoard: (boardId: string) => void;
  onCreateGroup: () => void;
  isBusy?: boolean;
}

export function BoardToolbar({
  boards,
  activeBoardId,
  onSelectBoard,
  onCreateBoard,
  onRenameBoard,
  onDeleteBoard,
  onCreateGroup,
  isBusy = false,
}: BoardToolbarProps) {
  const [nameDialog, setNameDialog] = useState<"create" | "rename" | null>(null);
  const [draftName, setDraftName] = useState("");

  const activeBoard = boards.find((board) => board.id === activeBoardId) ?? null;

  useEffect(() => {
    if (nameDialog === "rename") setDraftName(activeBoard?.name ?? "");
    if (nameDialog === "create") setDraftName("");
  }, [nameDialog, activeBoard?.name]);

  const submitName = async () => {
    const name = draftName.trim();
    if (!name) return;
    if (nameDialog === "create") await onCreateBoard(name);
    else if (nameDialog === "rename" && activeBoard) await onRenameBoard(activeBoard.id, name);
    setNameDialog(null);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <IconLayoutBoard className="h-4 w-4 flex-shrink-0 text-muted-foreground" />

        {boards.length > 0 && (
          <div className="w-56">
            <Select value={activeBoardId ?? undefined} onValueChange={onSelectBoard} disabled={isBusy}>
              <SelectTrigger size="sm">
                <SelectValue placeholder="Escolha um board" />
              </SelectTrigger>
              <SelectContent>
                {boards.map((board) => (
                  <SelectItem key={board.id} value={board.id}>
                    {board.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Button type="button" variant="outline" size="sm" onClick={() => setNameDialog("create")} disabled={isBusy}>
          <IconPlus className="mr-1 h-3.5 w-3.5" />
          Novo board
        </Button>

        {activeBoard && (
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setNameDialog("rename")} disabled={isBusy} aria-label="Renomear board">
              <IconPencil className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onDeleteBoard(activeBoard.id)}
              disabled={isBusy}
              aria-label="Apagar board"
            >
              <IconTrash className="h-4 w-4 text-destructive" />
            </Button>

            <div className="ml-auto">
              <Button type="button" size="sm" onClick={onCreateGroup} disabled={isBusy}>
                <IconPlus className="mr-1 h-3.5 w-3.5" />
                Novo grupo
              </Button>
            </div>
          </>
        )}
      </div>

      <AppDialog
        isOpen={nameDialog !== null}
        onClose={() => setNameDialog(null)}
        title={nameDialog === "rename" ? "Renomear board" : "Novo board"}
        size="md"
        padding="md"
      >
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-medium text-foreground">{nameDialog === "rename" ? "Renomear board" : "Novo board"}</h2>
            <p className="text-sm text-muted-foreground">
              O board é uma lente: os packs e o período continuam vindo do filtro do topo, então ele serve qualquer recorte.
            </p>
          </div>

          <Input
            autoFocus
            value={draftName}
            maxLength={MAX_NAME_LEN}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submitName();
              }
            }}
            placeholder="Ex.: Análise de hooks"
          />

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setNameDialog(null)} disabled={isBusy}>
              Cancelar
            </Button>
            <Button type="button" onClick={submitName} disabled={isBusy || draftName.trim().length === 0}>
              {isBusy && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
              {nameDialog === "rename" ? "Salvar" : "Criar"}
            </Button>
          </div>
        </div>
      </AppDialog>
    </>
  );
}
