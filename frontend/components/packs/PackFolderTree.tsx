"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { IconChevronRight, IconDots, IconFolder, IconFolderOpenFilled, IconLayoutGrid } from "@tabler/icons-react";
import { SearchInputWithClear } from "@/components/common/SearchInputWithClear";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils/cn";
import type { AdsPack, PackFolder } from "@/lib/types";
import { folderPath, subtreeIds, type FolderBucket, type FolderDropEdge } from "@/lib/utils/folderTree";

/** `null` = raiz da Biblioteca; `ALL_PACKS_VIEW` = todos os packs, sem pastas. */
export type FolderView = string | null;

/** Vista "Todos os packs". Não é pasta: não existe no banco e não recebe pack. */
export const ALL_PACKS_VIEW = "__all__";

/**
 * Tipo do `dataTransfer` quando o que se arrasta é uma PASTA. Os alvos que só
 * sabem receber pack (tile de pasta, "Sem pasta") conferem esse tipo para não
 * acender — mover pasta é gesto da árvore.
 */
export const FOLDER_DRAG_TYPE = "application/x-hookify-folder";

/** Quanto tempo parado sobre uma pasta fechada, arrastando, até ela abrir. */
const HOVER_EXPAND_MS = 700;

export interface PackFolderTreeProps {
  /** Topo da árvore; cada nó traz as subpastas em `children`. */
  roots: FolderBucket[];
  loosePacks: AdsPack[];
  view: FolderView;
  search: string;
  onSearchChange: (value: string) => void;
  /** Quantos packs a busca achou, e de quantos. */
  matchCount?: number;
  totalInView?: number;
  /** Total da Biblioteca, na linha "Todos os packs". */
  allCount: number;
  /** Sem pasta nenhuma, "Todos" repetiria "Sem pasta" — a linha some. */
  showAllRow: boolean;
  onNavigate: (view: FolderView) => void;
  /** Vai até o pack: abre a pasta dele (ou a raiz) e destaca o card. */
  onSelectPack: (packId: string) => void;
  /** O `⋯` de cada pack. Recebe o pack e devolve o mesmo menu do card. */
  renderPackMenu: (pack: AdsPack) => React.ReactNode;
  /** O `⋯` de cada pasta. `packCount` já inclui as subpastas. */
  renderFolderMenu: (folder: PackFolder, packCount: number) => React.ReactNode;
  /** Soltar packs arrastados: `null` tira da pasta. */
  onDropPacks: (folderId: string | null) => void;
  isDragging: boolean;
  /** Move a pasta para antes, depois ou para dentro de `targetId`. */
  onMoveFolder: (folderId: string, targetId: string, edge: FolderDropEdge) => void;
  /**
   * Arrasto de pasta compartilhado com a grade: a árvore avisa quando começa um, e
   * recebe o que começou num TILE — dá para soltar um tile numa linha da árvore.
   */
  onFolderDragChange: (folderId: string | null) => void;
  externalDraggingFolderId: string | null;
  /** A pasta arrastada e tudo abaixo dela, calculado sobre a árvore INTEIRA. */
  externalForbiddenIds: Set<string>;
  /** Arrastar a PARTIR da árvore. Mesmos handlers dos cards — uma origem só de verdade. */
  onPackDragStart: (packId: string) => (event: React.DragEvent<HTMLDivElement>) => void;
  onPackDragEnd: () => void;
  isPackDragging: (packId: string) => boolean;
  /** Seleção: a MESMA dos cards. Duas superfícies, um estado. */
  isPackSelected: (packId: string) => boolean;
  onTogglePack: (packId: string, checked: boolean) => void;
  /**
   * `order` é a ordem ACHATADA da árvore (subpastas antes dos packs, como é
   * desenhada). O shift+clique resolve o intervalo por ela, não pela ordem da
   * grade — que é outra.
   */
  onPackCheckboxClick: (event: React.MouseEvent, packId: string, order: string[]) => void;
  hasSelection: boolean;
  className?: string;
}

/**
 * Explorer da Biblioteca: busca + árvore, integrado à página.
 *
 * A busca vive AQUI e é a única da tela — filtra a árvore e a grade ao mesmo tempo.
 *
 * Também é alvo de arrasto: soltar pack num nó move, e soltar em "Sem pasta" tira da
 * pasta. Pasta arrastada cai antes, depois ou DENTRO de outra, pelo terço da linha
 * onde o ponteiro está.
 *
 * Não mede nada nem gruda: a partir de `lg` quem rola é a grade, então a altura do
 * painel é a da coluna e a árvore rola por dentro.
 */
export function PackFolderTree({
  roots,
  loosePacks,
  view,
  search,
  onSearchChange,
  matchCount,
  totalInView,
  allCount,
  showAllRow,
  onNavigate,
  onSelectPack,
  renderPackMenu,
  renderFolderMenu,
  onDropPacks,
  isDragging,
  onMoveFolder,
  onFolderDragChange,
  externalDraggingFolderId,
  externalForbiddenIds,
  onPackDragStart,
  onPackDragEnd,
  isPackDragging,
  isPackSelected,
  onTogglePack,
  onPackCheckboxClick,
  hasSelection,
  className,
}: PackFolderTreeProps) {
  const navRef = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | "loose" | null>(null);
  // Arrasto de PASTA. As refs respondem na hora (dragover chega antes do próximo
  // render); o estado desenha. `folderDragActive` entra um tick depois do
  // dragstart: mexer no DOM dentro do próprio dragstart cancela o arrasto no Chrome.
  const draggingFolderRef = useRef<string | null>(null);
  // A pasta arrastada e tudo abaixo dela: soltar ali criaria um ciclo.
  const forbiddenRef = useRef<Set<string>>(new Set());
  const [folderDragActive, setFolderDragActive] = useState(false);
  const [insertAt, setInsertAt] = useState<{ id: string; edge: FolderDropEdge } | null>(null);
  const hoverExpandRef = useRef<{ id: string; timer: number } | null>(null);
  // Pasta arrastada, venha de onde vier: a ref cobre o arrasto que nasceu aqui
  // (responde antes do próximo render); a prop cobre o que nasceu num tile.
  const draggedFolderId = () => draggingFolderRef.current ?? externalDraggingFolderId;
  const forbiddenIds = () => (draggingFolderRef.current ? forbiddenRef.current : externalForbiddenIds);
  const isFolderDragging = folderDragActive || externalDraggingFolderId !== null;

  // O arrasto de um tile termina na GRADE (dragend dispara lá): a marca de "vai
  // cair aqui" que ficou na árvore tem de sair junto.
  useEffect(() => {
    if (externalDraggingFolderId === null) setInsertAt(null);
  }, [externalDraggingFolderId]);

  const isSearching = search.trim().length > 0;
  // FECHADO por padrão: com dezenas de packs a árvore aberta vira uma lista comprida
  // e deixa de ser o mapa das pastas. Abre-se a que interessa. Durante a busca, força
  // aberto — contagem sem os itens embaixo seria um beco.
  const isOpen = (key: string) => isSearching || expanded.has(key);
  // Arrastando pasta, os PACKS somem (as subpastas ficam): com eles na tela, "depois
  // da pasta X" ficaria a dezenas de linhas do ponteiro.
  const showPacks = !isFolderDragging;
  // Abrir a pasta pelo nome só EXPANDE: com o caret separado, recolher é papel dele.
  const expand = (key: string) => {
    setExpanded((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };
  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Abrir uma subpasta pela GRADE (tile, caminho no topo) abre o caminho até ela na
  // árvore — senão o lugar onde se está ficaria escondido dentro de pastas fechadas.
  const rootsRef = useRef(roots);
  rootsRef.current = roots;
  useEffect(() => {
    if (!view || view === ALL_PACKS_VIEW) return;
    const byId = new Map<string, FolderBucket>();
    const index = (nodes: FolderBucket[]) => nodes.forEach((n) => { byId.set(n.folder.id, n); index(n.children); });
    index(rootsRef.current);
    const ids = folderPath(byId, view).map((n) => n.folder.id);
    if (ids.length === 0) return;
    setExpanded((prev) => (ids.every((id) => prev.has(id)) ? prev : new Set([...prev, ...ids])));
  }, [view]);

  /**
   * Ordem em que a árvore DESENHA os packs — inclui os de pastas recolhidas, de
   * propósito: recolher é esconder, não desmarcar, e um intervalo que pulasse os
   * escondidos marcaria um conjunto que ninguém pediu.
   */
  const flatOrder = useMemo(() => {
    const walk = (node: FolderBucket): string[] => [...node.children.flatMap(walk), ...node.packs.map((p) => p.id)];
    return [...roots.flatMap(walk), ...loosePacks.map((pack) => pack.id)];
  }, [roots, loosePacks]);

  useEdgeAutoScroll(navRef, isDragging || isFolderDragging);

  const cancelHoverExpand = () => {
    if (hoverExpandRef.current) window.clearTimeout(hoverExpandRef.current.timer);
    hoverExpandRef.current = null;
  };
  useEffect(() => cancelHoverExpand, []);

  /** Parado sobre uma pasta fechada com subpastas, ela abre — para chegar mais fundo sem soltar. */
  const scheduleHoverExpand = (node: FolderBucket) => {
    if (node.children.length === 0 || isOpen(node.folder.id)) return;
    if (hoverExpandRef.current?.id === node.folder.id) return;
    cancelHoverExpand();
    hoverExpandRef.current = {
      id: node.folder.id,
      timer: window.setTimeout(() => {
        expand(node.folder.id);
        hoverExpandRef.current = null;
      }, HOVER_EXPAND_MS),
    };
  };

  const endFolderDrag = () => {
    draggingFolderRef.current = null;
    forbiddenRef.current = new Set();
    setFolderDragActive(false);
    setInsertAt(null);
    cancelHoverExpand();
    onFolderDragChange(null);
  };

  const folderDragProps = (node: FolderBucket) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      draggingFolderRef.current = node.folder.id;
      forbiddenRef.current = subtreeIds(node);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(FOLDER_DRAG_TYPE, node.folder.id);
      window.setTimeout(() => {
        setFolderDragActive(true);
        onFolderDragChange(node.folder.id);
      }, 0);
    },
    onDragEnd: endFolderDrag,
  });

  /**
   * Terço de cima = antes; de baixo = depois; o meio = dentro. Numa pasta ABERTA com
   * subpastas, "depois" também vira "dentro": a linha logo abaixo é a primeira filha,
   * e uma marca ali prometeria um lugar que não é o de depois da pasta.
   */
  const edgeAt = (e: React.DragEvent, node: FolderBucket): FolderDropEdge => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    const edge: FolderDropEdge = ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
    // Buscando, tudo está aberto à força e não dá para recolher: converter aqui
    // tornaria impossível soltar depois da última pasta de um grupo.
    if (edge === "after" && !isSearching && isOpen(node.folder.id) && node.children.length > 0) return "inside";
    return edge;
  };

  const folderInsertProps = (node: FolderBucket) => ({
    onDragOver: (e: React.DragEvent) => {
      const dragged = draggedFolderId();
      if (!dragged) return;
      const targetId = node.folder.id;
      if (forbiddenIds().has(targetId)) {
        // Sem preventDefault: o cursor mostra "proibido" e o drop não acontece.
        setInsertAt(null);
        cancelHoverExpand();
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const edge = edgeAt(e, node);
      if (edge === "inside") scheduleHoverExpand(node);
      else cancelHoverExpand();
      setInsertAt((prev) => (prev?.id === targetId && prev.edge === edge ? prev : { id: targetId, edge }));
    },
    onDrop: (e: React.DragEvent) => {
      const dragged = draggedFolderId();
      if (!dragged) return;
      e.preventDefault();
      // A borda sai do PRÓPRIO evento, não do estado: cruzando rápido de uma linha
      // para outra, o estado ainda seria o da anterior e o drop se perderia calado.
      if (!forbiddenIds().has(node.folder.id)) {
        const edge = edgeAt(e, node);
        onMoveFolder(dragged, node.folder.id, edge);
        if (edge === "inside") expand(node.folder.id);
      }
      endFolderDrag();
    },
  });

  /** Alt+↑/↓ no nome da pasta: reordena entre as irmãs, sem mouse. */
  const moveByKeyboard = (e: React.KeyboardEvent, siblings: FolderBucket[], index: number) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    const folderId = siblings[index].folder.id;
    if (e.key === "ArrowUp" && index > 0) onMoveFolder(folderId, siblings[index - 1].folder.id, "before");
    if (e.key === "ArrowDown" && index < siblings.length - 1) onMoveFolder(folderId, siblings[index + 1].folder.id, "after");
  };

  const dropProps = (key: string | "loose", folderId: string | null, node?: FolderBucket) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!isDragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move" as const;
      setDropTarget(key);
      if (node) scheduleHoverExpand(node);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
        setDropTarget(null);
        cancelHoverExpand();
      }
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDropTarget(null);
      cancelHoverExpand();
      onDropPacks(folderId);
    },
  });

  const renderPackRow = (pack: AdsPack) => (
    <PackRow
      key={pack.id}
      label={pack.name}
      menu={renderPackMenu(pack)}
      isDragging={isPackDragging(pack.id)}
      isSelected={isPackSelected(pack.id)}
      showCheckbox={hasSelection}
      onToggle={(checked) => onTogglePack(pack.id, checked)}
      onCheckboxClick={(e) => onPackCheckboxClick(e, pack.id, flatOrder)}
      onDragStart={onPackDragStart(pack.id)}
      onDragEnd={onPackDragEnd}
      onClick={() => onSelectPack(pack.id)}
    />
  );

  const renderFolder = (node: FolderBucket, siblings: FolderBucket[], index: number): React.ReactNode => {
    const { folder, packs, children, allPacks } = node;
    const open = isOpen(folder.id);
    const pack = dropProps(folder.id, folder.id, node);
    const order = folderInsertProps(node);
    const hasVisibleContent = children.length > 0 || showPacks;
    return (
      <div key={folder.id}>
        <TreeRow
          label={folder.name}
          count={allPacks.length}
          icon={view === folder.id ? <IconFolderOpenFilled className="h-4 w-4" /> : <IconFolder className="h-4 w-4" />}
          isCurrent={view === folder.id}
          isDropTarget={dropTarget === folder.id || (insertAt?.id === folder.id && insertAt.edge === "inside")}
          isOpen={open}
          menu={renderFolderMenu(folder, allPacks.length)}
          onClick={() => {
            onNavigate(folder.id);
            expand(folder.id);
          }}
          onToggle={() => toggle(folder.id)}
          onMainKeyDown={(e) => moveByKeyboard(e, siblings, index)}
          isDraggingSelf={isFolderDragging && draggedFolderId() === folder.id}
          insertEdge={insertAt?.id === folder.id && insertAt.edge !== "inside" ? insertAt.edge : undefined}
          {...folderDragProps(node)}
          onDragOver={(e) => { pack.onDragOver(e); order.onDragOver(e); }}
          onDragLeave={pack.onDragLeave}
          onDrop={(e) => { if (draggedFolderId()) order.onDrop(e); else pack.onDrop(e); }}
        />
        {open && hasVisibleContent && (
          <TreeChildren>
            {children.map((child, i) => renderFolder(child, children, i))}
            {showPacks &&
              (packs.length === 0 && children.length === 0 ? (
                <span className="px-2 py-1.5 text-xs text-muted-foreground">Pasta vazia</span>
              ) : (
                packs.map(renderPackRow)
              ))}
          </TreeChildren>
        )}
      </div>
    );
  };

  // Sem nada E sem busca, o explorer não tem o que mostrar. COM busca ele precisa
  // continuar na tela: some o explorer, some o campo, e não há como limpar a busca.
  if (roots.length === 0 && loosePacks.length === 0 && !isSearching) return null;

  return (
    <div className={cn("flex min-h-0 flex-col gap-4", className)}>
      <div className="flex flex-col gap-1.5">
        <SearchInputWithClear value={search} onChange={onSearchChange} placeholder="Buscar pack ou pasta..." aria-label="Buscar na Biblioteca" />
        {isSearching && typeof matchCount === "number" && typeof totalInView === "number" && (
          <span className="px-1 text-xs text-muted-foreground tabular-nums">
            {matchCount} de {totalInView} packs
          </span>
        )}
      </div>

      <nav ref={navRef} className="scroll-faded -mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain px-1 lg:pb-8" aria-label="Pastas e packs">
        {/* "Todos os packs": uma VISTA, não uma pasta — ícone de grade, sem caret
            (abrir listaria a Biblioteca inteira, o que a árvore fechada evita) e não
            recebe pack arrastado. */}
        {showAllRow && (
        <TreeRow
          label="Todos os packs"
          count={allCount}
          icon={<IconLayoutGrid className="h-4 w-4" />}
          isCurrent={view === ALL_PACKS_VIEW}
          isOpen={false}
          onClick={() => onNavigate(ALL_PACKS_VIEW)}
        />
        )}

        {roots.map((node, index) => renderFolder(node, roots, index))}

        {/* "Sem pasta": mesmo tratamento de um grupo, e é o alvo de arrasto para TIRAR
            da pasta. Só aparece se houver pack sem pasta — com tudo arquivado seria um grupo
            vazio. A exceção é DURANTE um arrasto: aí ele volta, porque é o único lugar
            onde soltar um pack que se quer desarquivar. Não tem `⋯`: renomear e desfazer
            não se aplicam a um grupo que não existe no banco. */}
        {(loosePacks.length > 0 || isDragging) && (
        <div>
          <TreeRow
            label="Sem pasta"
            count={loosePacks.length}
            icon={view === null ? <IconFolderOpenFilled className="h-4 w-4" /> : <IconFolder className="h-4 w-4" />}
            isCurrent={view === null}
            isDropTarget={dropTarget === "loose"}
            isOpen={isOpen("__loose__")}
            onClick={() => {
              onNavigate(null);
              expand("__loose__");
            }}
            onToggle={() => toggle("__loose__")}
            {...dropProps("loose", null)}
          />
          {isOpen("__loose__") && showPacks && (
            <TreeChildren>
              {loosePacks.length === 0 ? (
                <span className="px-2 py-1.5 text-xs text-muted-foreground">{isDragging ? "Solte aqui para tirar da pasta" : "Todos os packs estão em pastas"}</span>
              ) : (
                loosePacks.map(renderPackRow)
              )}
            </TreeChildren>
          )}
        </div>
        )}

        {isSearching && roots.length === 0 && loosePacks.length === 0 && (
          <span className="px-2 py-3 text-xs text-muted-foreground">Nada encontrado.</span>
        )}
      </nav>
    </div>
  );
}

function TreeChildren({ children }: { children: React.ReactNode }) {
  return <div className="ml-[1.0625rem] flex flex-col gap-0.5 border-l border-border pl-2.5">{children}</div>;
}

interface TreeRowProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  count: number;
  icon: React.ReactNode;
  isCurrent: boolean;
  isDropTarget?: boolean;
  isOpen: boolean;
  menu?: React.ReactNode;
  /** Linha fina de "vai cair aqui" ao arrastar uma pasta ("dentro" usa o contorno). */
  insertEdge?: "before" | "after";
  isDraggingSelf?: boolean;
  onMainKeyDown?: (event: React.KeyboardEvent) => void;
  /** Abre a pasta na grade. */
  onClick: () => void;
  /** Só abre e fecha o conteúdo na árvore. Sem ele, a linha não tem caret. */
  onToggle?: () => void;
}

/**
 * Linha de pasta. Dois alvos, com papéis diferentes:
 * - o CARET só abre e fecha o conteúdo na árvore, sem abrir a pasta na grade;
 * - o resto da linha (ícone, nome, contagem) abre a pasta.
 * O caret não tem fundo de hover próprio — ele reage junto com a linha.
 *
 * O `⋯` é irmão desses botões, nunca filho: botão dentro de botão é HTML inválido e
 * o clique no menu acabaria disparando a navegação.
 */
function TreeRow({ label, count, icon, isCurrent, isDropTarget = false, isOpen, menu, insertEdge, isDraggingSelf = false, onMainKeyDown, onClick, onToggle, ...dragProps }: TreeRowProps) {
  return (
    <div
      {...dragProps}
      className={cn(
        "group/row relative flex items-center rounded-md pr-1 transition-colors",
        isDraggingSelf && "opacity-40",
        // Com o menu aberto o ponteiro está SOBRE o menu, não sobre a linha: sem o
        // `has-` o hover morre e não sobra marca de qual item foi clicado.
        !isCurrent && "hover:bg-surface has-[[data-state=open]]:bg-surface",
        // Mesmo fundo do hover, de propósito: quem carrega o estado é o ícone
        // (aberto e preenchido), o peso do texto e o tom cheio.
        isCurrent && "bg-surface text-foreground",
        isDropTarget && "bg-surface ring-1 ring-inset ring-primary",
      )}
    >
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={isOpen ? `Recolher ${label}` : `Expandir ${label}`}
          aria-expanded={isOpen}
          className="focus-inset grid h-7 w-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
        >
          <IconChevronRight className={cn("h-3.5 w-3.5 transition-transform", isOpen && "rotate-90")} />
        </button>
      ) : (
        // Mesmo recuo do caret: o ícone fica na coluna dos ícones das pastas.
        <span aria-hidden className="h-7 w-6 shrink-0" />
      )}
      <button
        type="button"
        onClick={onClick}
        onKeyDown={onMainKeyDown}
        aria-current={isCurrent ? "true" : undefined}
        className={cn("focus-inset flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 pr-1 text-left text-sm", isCurrent && "font-medium")}
      >
        <span className={cn("shrink-0", isCurrent ? "text-foreground" : "text-muted-foreground")}>{icon}</span>
        <span className="flex-1 truncate">{label}</span>
        <span className={cn("shrink-0 rounded-sm bg-surface-2 px-1.5 text-2xs font-medium tabular-nums", isCurrent ? "text-foreground" : "text-muted-foreground")}>
          {count}
        </span>
      </button>
      {menu}
      {insertEdge && (
        // Na fresta entre as linhas (gap-0.5), não em cima do texto.
        <span aria-hidden className={cn("pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-primary", insertEdge === "before" ? "-top-0.5" : "-bottom-0.5")} />
      )}
    </div>
  );
}

/**
 * Linha de pack. Mesma regra do `⋯`: irmão do botão, não filho.
 *
 * A linha INTEIRA é o punho de arrasto, não um ícone dedicado: na árvore os alvos
 * (as pastas) ficam a poucos pixels dali, então exigir mira num punho pequeno só
 * encareceria o gesto. Arrastar não atrapalha o clique — o navegador só inicia o
 * arrasto depois do movimento.
 *
 * Cursor de CLIQUE, não `grab`, e na linha toda. `grab` promete "isto existe para
 * ser arrastado", e aqui a ação principal é clicar; arrastar é secundária. É o que
 * Finder, Explorer e VS Code fazem com item de lista arrastável. Com `grab` só no
 * contêiner o cursor também alternava entre as bordas e o nome, sem padrão legível.
 */
function PackRow({
  label,
  menu,
  isDragging = false,
  isSelected = false,
  showCheckbox = false,
  onToggle,
  onCheckboxClick,
  onDragStart,
  onDragEnd,
  onClick,
}: {
  label: string;
  menu?: React.ReactNode;
  isDragging?: boolean;
  isSelected?: boolean;
  showCheckbox?: boolean;
  onToggle?: (checked: boolean) => void;
  onCheckboxClick?: (event: React.MouseEvent) => void;
  onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  onClick: () => void;
}) {
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group/row flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md pl-2 transition-colors hover:bg-surface has-[[data-state=open]]:bg-surface",
        isSelected && "bg-surface",
        isDragging && "opacity-40",
      )}
    >
      {/* Some quando não há seleção nenhuma: com dezenas de linhas, um checkbox fixo
          em cada uma vira ruído. Volta a aparecer assim que algo é marcado, para o
          que está selecionado ficar legível de relance. */}
      <span
        className={cn(
          // `flex`: como span inline, o checkbox (inline-block) sentava na linha de
          // base do texto e sobrava o espaço da descendente embaixo — ficava ~2px acima.
          "flex transition-opacity",
          // `focus-visible` e não `focus-within`: o clique do mouse também dá foco, e
          // com `focus-within` o checkbox ficava aceso depois de desmarcar, até o foco
          // sair. Com `focus-visible` só o foco de TECLADO o mantém — que é o caso em
          // que escondê-lo seria de fato um problema.
          isSelected || showCheckbox ? "opacity-100" : "opacity-0 has-[:focus-visible]:opacity-100 group-hover/row:opacity-100",
        )}
        // O arrasto da linha não pode começar em cima do checkbox, senão marcar
        // vira um gesto ambíguo.
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={(v) => onToggle?.(!!v)}
          onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
          onClick={onCheckboxClick}
          aria-label={`Selecionar ${label}`}
        />
      </span>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "focus-inset flex min-w-0 flex-1 items-center rounded-md py-1.5 text-left text-xs transition-colors group-hover/row:text-foreground group-has-[[data-state=open]]/row:text-foreground",
          isSelected ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span className="truncate">{label}</span>
      </button>
      {menu}
    </div>
  );
}

/**
 * Rolagem automática ao arrastar perto das bordas da árvore.
 *
 * Sem isto, mover um pack para uma pasta fora da área visível é impossível: o
 * arrasto não rola nada e não há como chegar no alvo sem soltar antes.
 *
 * O `dragover` é ouvido no DOCUMENTO, não no nó: durante o arrasto o ponteiro
 * passa por cima dos filhos e sai do elemento o tempo todo, e um listener local
 * perderia metade dos quadros.
 */
function useEdgeAutoScroll(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  const frameRef = useRef(0);
  const speedRef = useRef(0);

  useEffect(() => {
    if (!active) return;

    const EDGE_PX = 52;   // faixa sensível em cada ponta
    const MAX_STEP = 16;  // px por quadro no limite da faixa

    const step = () => {
      const node = ref.current;
      if (node && speedRef.current !== 0) node.scrollTop += speedRef.current;
      frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);

    const onDragOver = (event: DragEvent) => {
      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      // Fora da coluna na horizontal: o ponteiro está na grade, não aqui.
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
        speedRef.current = 0;
        return;
      }
      const fromTop = event.clientY - rect.top;
      const fromBottom = rect.bottom - event.clientY;
      // Velocidade proporcional: quanto mais perto da borda, mais rápido.
      if (fromTop < EDGE_PX) speedRef.current = -Math.ceil(((EDGE_PX - fromTop) / EDGE_PX) * MAX_STEP);
      else if (fromBottom < EDGE_PX) speedRef.current = Math.ceil(((EDGE_PX - fromBottom) / EDGE_PX) * MAX_STEP);
      else speedRef.current = 0;
    };

    const stop = () => { speedRef.current = 0; };

    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", stop);
    document.addEventListener("dragend", stop);
    return () => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      speedRef.current = 0;
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", stop);
      document.removeEventListener("dragend", stop);
    };
  }, [ref, active]);
}

/**
 * Gatilho dos menus da árvore — serve para pack e para pasta. Escondido até o
 * hover: com dezenas de linhas na tela, um `⋯` fixo em cada uma vira ruído.
 */
export const TreeRowMenuTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string }>(
  function TreeRowMenuTrigger({ label = "Ações", className, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        {...props}
        className={cn(
          // Largura ZERO em repouso: um `⋯` só invisível continuaria ocupando 24px e
          // empurraria o contador para longe da borda direita. No hover a largura
          // cresce e o contador desliza para a esquerda, abrindo espaço para ele.
          "focus-inset grid h-6 w-0 shrink-0 place-items-center overflow-hidden rounded-sm text-muted-foreground opacity-0 transition-[width,opacity,margin] duration-200 ease-out hover:text-foreground",
          "group-hover/row:ml-0.5 group-hover/row:w-6 group-hover/row:opacity-100",
          "focus-visible:ml-0.5 focus-visible:w-6 focus-visible:opacity-100",
          "data-[state=open]:ml-0.5 data-[state=open]:w-6 data-[state=open]:opacity-100",
          className,
        )}
      >
        <IconDots className="h-3.5 w-3.5" />
      </button>
    );
  },
);
