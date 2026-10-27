"use client";

import { forwardRef, useEffect, useId, useMemo, useRef, useState, type MutableRefObject, type ReactNode, type Ref } from "react";
import { IconAlertTriangle, IconInfoCircle, IconPlus, IconTrash } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input, type InputProps } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";
import { LEAD_ECONOMICS_PRODUCT_NAME_MAX, formatLeadScore } from "@/lib/utils/leadEconomics";
import {
  addDraftBand,
  addDraftProduct,
  bandsUsingProduct,
  canAddDraftProduct,
  draftBandCeilings,
  draftBandLabels,
  draftBandMins,
  isLeadEconomicsBandMessage,
  leadEconomicsDraftErrors,
  leadEconomicsDraftFieldIssues,
  leadEconomicsDraftLiveErrors,
  removeDraftBand,
  removeDraftProduct,
  updateDraftBand,
  updateDraftProduct,
  type LeadEconomicsDraft,
  type LeadEconomicsProductDraft,
} from "@/lib/utils/leadEconomicsDraft";

export interface LeadEconomicsEditorProps {
  /** Rascunho em texto. O estado mora no diálogo, que salva tudo de uma vez. */
  value: LeadEconomicsDraft;
  onChange: (next: LeadEconomicsDraft) => void;
  /** Corte de MQL do pack — só exibido ao lado das faixas (D19), nunca imposto a elas. */
  mqlLeadscoreMin: number | null;
  /** Código da moeda da CONTA do pack ("BRL", "USD"): prefixo do ticket e teto por lead. */
  currency: string;
  /**
   * `false` quando `currency` é a preferência de quem vê, porque não deu para achar a
   * conta do pack (`resolvePackCurrency`): o editor avisa perto do ticket.
   */
  currencyFromAccount?: boolean;
  disabled?: boolean;
  /**
   * Depois de uma tentativa de salvar: mostra também o que falta preencher. Antes
   * disso só aparece engano de verdade — o formulário novo não abre acusando tudo.
   */
  showAllErrors?: boolean;
  /**
   * Primeiro campo editável (nome do 1º produto). Para
   * o diálogo levar o foco ao formulário quando ele aparece ("Configurar",
   * "Desfazer") — o botão que o abriu some, e o foco cairia no topo do diálogo.
   */
  firstFieldRef?: Ref<HTMLInputElement>;
}

// ── Peças puras (exportadas para o teste) ─────────────────────────────────────

/**
 * Nome do produto na tela. Sem nome, um substituto que NÃO parece um nome digitado
 * — o placeholder do campo é "Nome do produto", e "Produto 2" ali fazia o campo em
 * branco parecer preenchido. `unnamed` pinta o substituto no tom secundário.
 */
export function productDisplayName(product: Pick<LeadEconomicsProductDraft, "name">, index: number): { text: string; unnamed: boolean } {
  const name = product.name.trim();
  return name ? { text: name, unnamed: false } : { text: `Sem nome (produto ${index + 1})`, unnamed: true };
}

/** O mesmo nome dentro de uma frase lida pelo leitor de tela ("Ticket de produto 2 (sem nome)"). */
function productSpokenName(product: Pick<LeadEconomicsProductDraft, "name">, index: number): string {
  return product.name.trim() || `produto ${index + 1} (sem nome)`;
}

// `null` = código que o Intl recusa (vazio, malformado): cai no número puro com o código.
const moneyFormatters = new Map<string, Intl.NumberFormat | null>();
const plainMoneyFormatter = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function moneyFormatter(currency: string): Intl.NumberFormat | null {
  if (!moneyFormatters.has(currency)) {
    let formatter: Intl.NumberFormat | null = null;
    try {
      formatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency });
    } catch {
      formatter = null;
    }
    moneyFormatters.set(currency, formatter);
  }
  return moneyFormatters.get(currency) ?? null;
}

/**
 * Dinheiro da economia do lead SEMPRE no padrão brasileiro, com a moeda da conta:
 * "R$ 18,00", "US$ 1.500,00". Não usa `formatCurrency` (currency.ts) de propósito:
 * lá o locale segue a moeda, e com USD o teto saía "$1,500.00" ao lado de campos em
 * que vírgula é decimal — quem copiasse o formato para o ticket gravaria 1,5.
 */
export function formatLeadEconomicsMoney(value: number, currency: string): string {
  const formatter = moneyFormatter(currency);
  if (formatter) return formatter.format(value);
  const code = currency.trim();
  return code ? `${code} ${plainMoneyFormatter.format(value)}` : plainMoneyFormatter.format(value);
}

/** Símbolo da moeda no mesmo padrão ("R$", "US$", "€"), para o prefixo do ticket. */
export function leadEconomicsCurrencySymbol(currency: string): string {
  const formatter = moneyFormatter(currency);
  return formatter?.formatToParts(0).find((part) => part.type === "currency")?.value ?? currency.trim();
}

/**
 * Quem recebe o foco depois de remover a linha `index` (produto ou faixa): a
 * lixeira da vizinha de baixo, ou a de cima se a removida era a última. `null`
 * quando não sobra lixeira nenhuma (fica uma linha só, que não se remove) — aí o
 * foco vai para o "Adicionar" do bloco. Sem isto o botão focado some e o foco cai
 * no topo do diálogo.
 */
export function focusKeyAfterRemoval(keys: readonly string[], index: number): string | null {
  if (index < 0 || index >= keys.length || keys.length - 1 <= 1) return null;
  return keys[index + 1] ?? keys[index - 1] ?? null;
}

/** Pergunta "Mover para" aberta: qual produto sai e para onde vão as faixas dele. */
export interface PendingProductRemoval {
  productId: string;
  moveTo: string;
}

/**
 * Clique na lixeira de um produto. Nenhuma faixa usa → remove na hora. Com faixas →
 * abre a pergunta "Mover para" (a de outro produto, se aberta, dá lugar a esta); já
 * aberta para este mesmo produto → só devolve o foco a ela.
 *
 * `pending` é a pergunta que vale DEPOIS do clique. Remover na hora fecha a de
 * QUALQUER produto: guardada, ela sumia da tela (sobrava um produto só) e reaparecia
 * sozinha mais tarde, ao adicionar produto — e o efeito de foco roubava o foco.
 */
export function productTrashClick(
  draft: LeadEconomicsDraft,
  productId: string,
  pending: PendingProductRemoval | null,
): { removeNow: boolean; refocusQuestion: boolean; pending: PendingProductRemoval | null } {
  if (bandsUsingProduct(draft, productId).length === 0) return { removeNow: true, refocusQuestion: false, pending: null };
  if (pending?.productId === productId) return { removeNow: false, refocusQuestion: true, pending };
  const other = draft.products.find((product) => product.id !== productId);
  return { removeNow: false, refocusQuestion: false, pending: other ? { productId, moveTo: other.id } : null };
}

// ── Peças de tela ─────────────────────────────────────────────────────────────

/**
 * Borda de erro presa ao `aria-invalid`: um dono só do estado, o campo não fica
 * vermelho sem o leitor de tela saber (nem o contrário). Com foco a borda volta ao
 * azul — o foco é desenhado na própria borda, e o erro segue dito na mensagem.
 * Sem o override de foco, `aria-[invalid=true]` vem depois de `focus` no CSS e
 * apagaria o foco do campo com erro.
 */
const INVALID_INPUT = "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:border-primary";
const INVALID_TRIGGER = "aria-[invalid=true]:border-destructive aria-[invalid=true]:focus:border-primary";

/** `aria-invalid` + `aria-describedby` apontando para a mensagem curta do campo. */
function fieldErrorProps(issue: string | undefined, messageId: string) {
  return issue ? { "aria-invalid": true as const, "aria-describedby": messageId } : {};
}

/** Liga um elemento a uma chave do mapa de refs (e o tira ao desmontar). */
function refInto<T>(map: Map<string, T>, key: string) {
  return (element: T | null) => {
    if (element) map.set(key, element);
    else map.delete(key);
  };
}

function assignRef<T>(ref: Ref<T> | undefined, element: T | null) {
  if (!ref) return;
  if (typeof ref === "function") ref(element);
  else (ref as MutableRefObject<T | null>).current = element;
}

/** Célula de um campo: o campo e, embaixo, a mensagem curta dele (quando há). */
function FieldCell({ issue, messageId, alignEnd = false, children }: { issue?: string; messageId: string; alignEnd?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      {children}
      {issue && (
        <p id={messageId} className={cn("text-xs text-destructive", alignEnd && "text-right")}>
          {issue}
        </p>
      )}
    </div>
  );
}

/** Campo de número com a unidade dentro dele ("R$", "%"): deixa claro que 55 é 55%. */
const UnitInput = forwardRef<HTMLInputElement, Omit<InputProps, "size" | "inputMode"> & { prefix?: string; suffix?: string }>(function UnitInput(
  { prefix, suffix, className, ...props },
  ref,
) {
  // "US$", "MX$" e códigos de 3 letras não cabem no respiro de "R$".
  const widePrefix = (prefix?.length ?? 0) >= 3;
  return (
    <div className="relative min-w-0">
      {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{prefix}</span>}
      <Input
        ref={ref}
        size="sm"
        inputMode="decimal"
        autoComplete="off"
        className={cn("text-right tabular-nums", INVALID_INPUT, prefix && (widePrefix ? "pl-12" : "pl-10"), suffix && "pr-7", className)}
        {...props}
      />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
});

/** Nome de produto no seletor: o substituto de "sem nome" no tom secundário. */
function ProductName({ product, index }: { product: LeadEconomicsProductDraft; index: number }) {
  const { text, unnamed } = productDisplayName(product, index);
  return <span className={unnamed ? "text-muted-foreground" : undefined}>{text}</span>;
}

/**
 * Resumo com as frases do contrato. A região viva fica SEMPRE montada e só a lista
 * entra e sai: leitor de tela só anuncia mudança dentro de uma região que já existia
 * — montada junto com o conteúdo, a primeira mensagem passava calada.
 */
function ErrorSummary({ messages }: { messages: string[] }) {
  return (
    <div aria-live="polite">
      {messages.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-destructive">
          {messages.map((message) => (
            <li key={message} className="flex items-start gap-1.5">
              <IconAlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const listFormatter = new Intl.ListFormat("pt-BR", { type: "conjunction" });

/**
 * Cadastro da economia do lead: o que você vende (produtos) → quem compra (faixas
 * de nota). Componente CONTROLADO — recebe o rascunho e devolve o próximo; toda a
 * edição passa pelas funções puras de `leadEconomicsDraft.ts`, testadas lá.
 *
 * O nome do produto e a coluna "Produto" das faixas aparecem SEMPRE, também com um
 * produto só (revisão P1, 2026-09-29): nome é obrigatório, e esconder o campo com um
 * produto fazia a passagem para dois parecer outra tela. Com um produto só, a
 * lixeira dele não aparece (cadastro sem produto não existe).
 *
 * Erros em dois lugares: no CAMPO (borda, `aria-invalid` e a mensagem curta de
 * `leadEconomicsDraftFieldIssues`, que diz qual produto ou faixa) e, embaixo de cada
 * bloco, o resumo com as frases do contrato.
 *
 * Plano: documentation/plano-economia-do-lead.md, seções 6 e 13.
 */
export function LeadEconomicsEditor({
  value,
  onChange,
  mqlLeadscoreMin,
  currency,
  currencyFromAccount = true,
  disabled = false,
  showAllErrors = false,
  firstFieldRef,
}: LeadEconomicsEditorProps) {
  // Apagar produto usado por faixas pede o destino delas antes (seção 6). Qualquer
  // outra mudança de estrutura (produto ou faixa que entra ou sai) fecha a pergunta:
  // ela descreve as faixas de ANTES, e guardada reaparecia sem ninguém pedir.
  const [pendingRemoval, setPendingRemoval] = useState<PendingProductRemoval | null>(null);

  // Foco acompanhando a troca de conteúdo: lixeiras (produto `p:<id>`, faixa
  // `b:<key>`), campos que recebem o foco ao adicionar, e os botões fixos.
  const baseId = useId();
  const trashRefs = useRef(new Map<string, HTMLButtonElement>());
  const fieldRefs = useRef(new Map<string, HTMLInputElement>());
  const addProductRef = useRef<HTMLButtonElement>(null);
  const addBandRef = useRef<HTMLButtonElement>(null);
  const moveToRef = useRef<HTMLButtonElement>(null);
  const confirmRemovalRef = useRef<HTMLButtonElement>(null);
  // Campo que recebe o foco quando a linha adicionada aparecer (depois do onChange).
  const pendingFieldFocus = useRef<string | null>(null);

  const single = value.products.length === 1;
  // Escolha pendente só vale enquanto o produto existe e há outro para receber as faixas.
  const activeRemoval = pendingRemoval && !single && value.products.some((product) => product.id === pendingRemoval.productId) ? pendingRemoval : null;
  const activeRemovalId = activeRemoval?.productId ?? null;
  const currencySymbol = useMemo(() => leadEconomicsCurrencySymbol(currency), [currency]);
  const mins = useMemo(() => draftBandMins(value), [value]);
  // Rótulo e teto de todas as faixas, uma vez por mudança do rascunho: por faixa, cada
  // um relia o cadastro inteiro (O(n²) por tecla; o cadastro não tem teto de faixas).
  const labels = useMemo(() => draftBandLabels(value), [value]);
  const ceilings = useMemo(() => draftBandCeilings(value), [value]);

  const errors = useMemo(
    () => (showAllErrors ? leadEconomicsDraftErrors(value) : leadEconomicsDraftLiveErrors(value)),
    [value, showAllErrors],
  );
  const productErrors = errors.filter((message) => !isLeadEconomicsBandMessage(message));
  const bandErrors = errors.filter(isLeadEconomicsBandMessage);
  // Mesma regra de quando mostrar que o resumo: ao vivo só engano; depois de tentar
  // salvar, também o que falta.
  const issues = useMemo(() => leadEconomicsDraftFieldIssues(value, { showAll: showAllErrors }), [value, showAllErrors]);

  // Linha adicionada: foco no primeiro campo dela, assim que ela existir.
  useEffect(() => {
    const key = pendingFieldFocus.current;
    if (!key) return;
    pendingFieldFocus.current = null;
    fieldRefs.current.get(key)?.focus();
  }, [value]);

  // Pergunta "Mover para" aberta: o foco vai para ela. Antes, a lixeira focada ficava
  // desabilitada e o teclado não tinha por onde chegar à pergunta.
  useEffect(() => {
    if (!activeRemovalId) return;
    (moveToRef.current ?? confirmRemovalRef.current)?.focus();
  }, [activeRemovalId]);

  const messageId = (scope: string, index: number, field: string) => `${baseId}-${scope}-${index}-${field}`;

  /**
   * Foco para a vizinha ANTES de remover: ela já existe e sobrevive à remoção (a
   * chave do React mantém o elemento), então o foco nunca passa pelo topo do diálogo.
   */
  const focusAfterRemoval = (prefix: "p" | "b", keys: string[], index: number) => {
    const neighbor = focusKeyAfterRemoval(keys, index);
    const target = neighbor ? trashRefs.current.get(`${prefix}:${neighbor}`) : prefix === "p" ? addProductRef.current : addBandRef.current;
    target?.focus();
  };

  /** Remove o produto (a pergunta aberta, se houver, quem fecha é quem chamou). */
  const removeProductNow = (productId: string, moveTo: string | null) => {
    const next = removeDraftProduct(value, productId, moveTo);
    if (next === value) return;
    focusAfterRemoval(
      "p",
      value.products.map((product) => product.id),
      value.products.findIndex((product) => product.id === productId),
    );
    onChange(next);
  };

  const confirmRemoveProduct = (productId: string, moveTo: string) => {
    removeProductNow(productId, moveTo);
    setPendingRemoval(null);
  };

  const requestRemoveProduct = (productId: string) => {
    const click = productTrashClick(value, productId, activeRemoval);
    if (click.refocusQuestion) {
      (moveToRef.current ?? confirmRemovalRef.current)?.focus();
      return;
    }
    if (click.removeNow) removeProductNow(productId, null);
    setPendingRemoval(click.pending);
  };

  const cancelRemoveProduct = (productId: string) => {
    trashRefs.current.get(`p:${productId}`)?.focus();
    setPendingRemoval(null);
  };

  const addProduct = () => {
    const next = addDraftProduct(value);
    if (next === value) return;
    pendingFieldFocus.current = `nome:${next.products[next.products.length - 1].id}`;
    onChange(next);
    setPendingRemoval(null);
  };

  const addBand = () => {
    const next = addDraftBand(value, mqlLeadscoreMin);
    if (next === value) return;
    pendingFieldFocus.current = `corte:${next.bands[next.bands.length - 1].key}`;
    onChange(next);
    setPendingRemoval(null);
  };

  const removeBand = (index: number) => {
    const next = removeDraftBand(value, index);
    if (next === value) return;
    focusAfterRemoval(
      "b",
      value.bands.map((band) => band.key),
      index,
    );
    onChange(next);
    setPendingRemoval(null);
  };

  /** Rótulo explícito no gatilho do seletor (não depende do Radix espelhar o item). */
  const labelOfProduct = (productId: string): ReactNode => {
    const index = value.products.findIndex((product) => product.id === productId);
    return index < 0 ? undefined : <ProductName product={value.products[index]} index={index} />;
  };

  /** "ou mais" / "a menos de 80" ao lado do campo de corte. */
  const cutSuffix = (index: number): string => {
    if (index === value.bands.length - 1) return "ou mais";
    const next = mins[index + 1];
    return next === null || next === undefined ? "" : `a menos de ${formatLeadScore(next)}`;
  };

  // Largura mínima das colunas com texto (nome, nota): abaixo dela o rótulo da
  // faixa perdia o limite de cima. O contêiner rola na horizontal em tela estreita;
  // no diálogo 2xl as duas tabelas cabem sem rolar MESMO com a barra de rolagem do
  // diálogo (42rem − 2px da borda do diálogo − p-6 dos dois lados − 17px da barra −
  // 2px da borda da tabela = 603px). Por isso o `min-w` de cada tabela é a soma
  // exata das colunas + vãos + respiro: as faixas com vários produtos somam 37,5rem
  // (600px); com 38rem (608px) a tabela rolava 5px na horizontal.
  const productGrid = "grid-cols-[minmax(7.5rem,1fr)_7.5rem_6.5rem_6.5rem_2.5rem]";
  const bandGrid = "grid-cols-[minmax(11rem,1.5fr)_minmax(7.5rem,1fr)_6.5rem_6.5rem_2.5rem]";

  return (
    <div className="space-y-6">
      {/* ── O que você vende ── */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">O que você vende</p>

        {/* Cada linha é um pequeno formulário: o grupo sobe um nível (surface-2). */}
        <div className="overflow-x-auto rounded-md border border-border bg-surface-2">
          <div className="min-w-[34rem] divide-y divide-border">
            <div className={cn("grid items-end gap-2 px-3 pb-2 pt-3 text-xs text-muted-foreground", productGrid)}>
              <span>Produto</span>
              <span className="text-right">Ticket</span>
              <span className="text-right">De cada venda, quanto sobra?</span>
              <span className="text-right">Margem de lucro desejada</span>
              <span aria-hidden />
            </div>

            {value.products.map((product, index) => {
              const spoken = productSpokenName(product, index);
              const of = ` de ${spoken}`;
              const productIssues = issues.products[index] ?? {};
              const ids = {
                name: messageId("produto", index, "nome"),
                ticket: messageId("produto", index, "ticket"),
                contribution: messageId("produto", index, "sobra"),
                target: messageId("produto", index, "margem"),
              };
              const others = value.products.map((item, i) => ({ item, i })).filter(({ item }) => item.id !== product.id);
              const removal = activeRemoval?.productId === product.id ? activeRemoval : null;
              // Destino que a tela mostra é o que vale no "Mover e remover".
              const moveTo = removal && others.some(({ item }) => item.id === removal.moveTo) ? removal.moveTo : (others[0]?.item.id ?? "");
              const usedBy = removal ? bandsUsingProduct(value, product.id).map((i) => `"${labels[i]}"`) : [];

              return (
                <div key={product.id}>
                  {/* items-start: a mensagem embaixo de um campo não desalinha os outros. */}
                  <div className={cn("grid items-start gap-2 px-3 py-2", productGrid)}>
                    <FieldCell issue={productIssues.name} messageId={ids.name}>
                      <Input
                        ref={(element) => {
                          refInto(fieldRefs.current, `nome:${product.id}`)(element);
                          if (index === 0) assignRef(firstFieldRef, element);
                        }}
                        size="sm"
                        className={INVALID_INPUT}
                        value={product.name}
                        maxLength={LEAD_ECONOMICS_PRODUCT_NAME_MAX}
                        placeholder="Nome do produto"
                        aria-label={`Nome do produto ${index + 1}`}
                        {...fieldErrorProps(productIssues.name, ids.name)}
                        onChange={(e) => onChange(updateDraftProduct(value, product.id, { name: e.target.value }))}
                        disabled={disabled}
                      />
                    </FieldCell>
                    <FieldCell issue={productIssues.ticket} messageId={ids.ticket} alignEnd>
                      <UnitInput
                        prefix={currencySymbol}
                        value={product.ticket}
                        aria-label={`Ticket${of}`}
                        {...fieldErrorProps(productIssues.ticket, ids.ticket)}
                        onChange={(e) => onChange(updateDraftProduct(value, product.id, { ticket: e.target.value }))}
                        disabled={disabled}
                      />
                    </FieldCell>
                    <FieldCell issue={productIssues.contribution} messageId={ids.contribution} alignEnd>
                      <UnitInput
                        suffix="%"
                        value={product.contribution}
                        aria-label={`De cada venda de ${spoken}, quanto sobra`}
                        {...fieldErrorProps(productIssues.contribution, ids.contribution)}
                        onChange={(e) => onChange(updateDraftProduct(value, product.id, { contribution: e.target.value }))}
                        disabled={disabled}
                      />
                    </FieldCell>
                    <FieldCell issue={productIssues.target} messageId={ids.target} alignEnd>
                      <UnitInput
                        suffix="%"
                        value={product.target}
                        aria-label={`Margem de lucro desejada${of}`}
                        {...fieldErrorProps(productIssues.target, ids.target)}
                        onChange={(e) => onChange(updateDraftProduct(value, product.id, { target: e.target.value }))}
                        disabled={disabled}
                      />
                    </FieldCell>
                    {single ? (
                      <span aria-hidden />
                    ) : (
                      // Nunca desabilitada pela pergunta aberta: desabilitar o botão
                      // focado jogava o foco para fora. Outra lixeira troca a pergunta.
                      <Button
                        ref={refInto(trashRefs.current, `p:${product.id}`)}
                        size="icon"
                        variant="ghost"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remover ${spoken}`}
                        onClick={() => requestRemoveProduct(product.id)}
                        disabled={disabled}
                      >
                        <IconTrash className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  {removal && (
                    <div role="group" aria-label={`Remover ${spoken}`} className="flex flex-wrap items-center gap-3 px-3 pb-3 text-xs text-foreground">
                      <span className="min-w-0 flex-1">
                        {usedBy.length === 0
                          ? "Nenhuma faixa usa mais este produto."
                          : usedBy.length === 1
                            ? `A faixa ${usedBy[0]} usa este produto. Mover para:`
                            : `As faixas ${listFormatter.format(usedBy)} usam este produto. Mover para:`}
                      </span>
                      {usedBy.length > 0 && (
                        <Select value={moveTo} onValueChange={(next) => setPendingRemoval({ productId: product.id, moveTo: next })} disabled={disabled}>
                          <SelectTrigger ref={moveToRef} size="sm" className="w-40 text-left" aria-label="Produto que passa a receber essas faixas">
                            <SelectValue>{labelOfProduct(moveTo)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {others.map(({ item, i }) => (
                              <SelectItem key={item.id} value={item.id}>
                                <ProductName product={item} index={i} />
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      <div className="flex gap-3">
                        <Button size="sm" variant="outline" onClick={() => cancelRemoveProduct(product.id)} disabled={disabled}>
                          Cancelar
                        </Button>
                        <Button
                          ref={confirmRemovalRef}
                          size="sm"
                          variant="destructive"
                          onClick={() => confirmRemoveProduct(product.id, moveTo)}
                          disabled={disabled || (usedBy.length > 0 && !moveTo)}
                        >
                          {usedBy.length > 0 ? "Mover e remover" : "Remover"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-0.5 text-xs text-muted-foreground">
          {!currencyFromAccount && (
            <p className="flex items-start gap-2">
              <IconInfoCircle className="mt-0.5 h-3 w-3 shrink-0" />
              Ticket em {currency}, a moeda da sua preferência: não deu para confirmar a moeda da conta deste pack.
            </p>
          )}
          <p>Quanto sobra: preço menos produto, imposto, comissão e taxas — tudo, menos o anúncio.</p>
          {/* Sobre o preço (D15), não sobre o que sobra: é o que "margem de lucro" quer dizer numa DRE. */}
          <p>Margem desejada: sobre o preço de venda.</p>
        </div>
        {/* Resumo fora do space-y: vazio, ele não abre um vão embaixo do bloco. */}
        <div>
          <Button ref={addProductRef} variant="outline" size="sm" onClick={addProduct} disabled={disabled || !canAddDraftProduct(value)}>
            <IconPlus />
            Adicionar produto
          </Button>
          <ErrorSummary messages={productErrors} />
        </div>
      </div>

      {/* ── Quem compra ── */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">Quem compra</p>

        <div className="overflow-x-auto rounded-md border border-border bg-surface-2">
          <div className="min-w-[37.5rem] divide-y divide-border">
            <div className={cn("grid items-end gap-2 px-3 pb-2 pt-3 text-xs text-muted-foreground", bandGrid)}>
              <span>Nota do lead</span>
              <span>Produto</span>
              <span className="text-right">Conversão</span>
              <span className="text-right">Teto por lead</span>
              <span aria-hidden />
            </div>

            {value.bands.map((band, index) => {
              const label = labels[index];
              const ceiling = ceilings[index];
              const suffix = cutSuffix(index);
              const bandIssues = issues.bands[index] ?? {};
              // Com um produto só, a faixa é dele qualquer que seja o id guardado (o
              // documento faz o mesmo): o seletor mostra o que vai ser gravado.
              const bandProduct = single ? value.products[0].id : band.product;
              const ids = {
                min: messageId("faixa", index, "corte"),
                product: messageId("faixa", index, "produto"),
                conversion: messageId("faixa", index, "conversao"),
              };
              return (
                <div key={band.key} className={cn("grid items-start gap-2 px-3 py-2", bandGrid)}>
                  {index === 0 ? (
                    // min-h-10: a altura do campo, para o rótulo ficar na linha dos campos vizinhos.
                    <span className="flex min-h-10 min-w-0 items-center text-sm text-foreground" title={label}>
                      <span className="min-w-0 truncate">{label}</span>
                    </span>
                  ) : (
                    <FieldCell issue={bandIssues.min} messageId={ids.min}>
                      {/* w-24: cabe um corte de 6 casas ("0,654321") sem rolar dentro do campo. */}
                      <div className="flex min-w-0 items-center gap-2">
                        <Input
                          ref={refInto(fieldRefs.current, `corte:${band.key}`)}
                          size="sm"
                          inputMode="decimal"
                          autoComplete="off"
                          className={cn("w-24 shrink-0 text-right tabular-nums", INVALID_INPUT)}
                          value={band.min}
                          placeholder="nota"
                          aria-label={`Nota de corte da faixa ${index + 1}`}
                          {...fieldErrorProps(bandIssues.min, ids.min)}
                          onChange={(e) => onChange(updateDraftBand(value, index, { min: e.target.value }))}
                          disabled={disabled}
                        />
                        {/* Quebra a linha em vez de cortar: é o limite de cima da faixa, e
                            cortado ("a menos d…") só se lia passando o mouse — em toque,
                            nunca. Duas linhas curtas cabem na altura do campo. */}
                        <span className="min-w-0 break-words text-xs leading-tight text-muted-foreground" title={suffix || undefined}>
                          {suffix}
                        </span>
                      </div>
                    </FieldCell>
                  )}
                  <FieldCell issue={bandIssues.product} messageId={ids.product}>
                    {/* text-left: o gatilho é um <button>, que centraliza; nome longo
                        cortado com reticências ficava no meio, longe dos vizinhos. */}
                    <Select value={bandProduct} onValueChange={(product) => onChange(updateDraftBand(value, index, { product }))} disabled={disabled}>
                      <SelectTrigger size="sm" className={cn("text-left", INVALID_TRIGGER)} aria-label={`Produto da faixa ${label}`} {...fieldErrorProps(bandIssues.product, ids.product)}>
                        <SelectValue placeholder="Escolha">{labelOfProduct(bandProduct)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {value.products.map((product, i) => (
                          <SelectItem key={product.id} value={product.id}>
                            <ProductName product={product} index={i} />
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldCell>
                  <FieldCell issue={bandIssues.conversion} messageId={ids.conversion} alignEnd>
                    <UnitInput
                      suffix="%"
                      value={band.conversion}
                      aria-label={`Conversão da faixa ${label}`}
                      {...fieldErrorProps(bandIssues.conversion, ids.conversion)}
                      onChange={(e) => onChange(updateDraftBand(value, index, { conversion: e.target.value }))}
                      disabled={disabled}
                    />
                  </FieldCell>
                  {/* Resultado ao vivo: <output> com nome, anunciado quando muda. */}
                  <output
                    aria-live="polite"
                    aria-label={`Teto por lead da faixa ${label}`}
                    className={cn(
                      "flex min-h-10 min-w-0 items-center justify-end text-sm tabular-nums",
                      ceiling === null ? "text-muted-foreground opacity-50" : "text-foreground",
                    )}
                  >
                    {ceiling === null ? (
                      <>
                        <span aria-hidden>—</span>
                        <span className="sr-only">incompleto</span>
                      </>
                    ) : (
                      <span className="truncate" title={formatLeadEconomicsMoney(ceiling, currency)}>
                        {formatLeadEconomicsMoney(ceiling, currency)}
                      </span>
                    )}
                  </output>
                  {value.bands.length > 1 ? (
                    <Button
                      ref={refInto(trashRefs.current, `b:${band.key}`)}
                      size="icon"
                      variant="ghost"
                      className="text-muted-foreground hover:text-destructive"
                      aria-label={`Remover a faixa ${label}`}
                      onClick={() => removeBand(index)}
                      disabled={disabled}
                    >
                      <IconTrash className="h-4 w-4" />
                    </Button>
                  ) : (
                    <span aria-hidden />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Mesma ordem do bloco de cima: ajuda, depois "Adicionar" com o resumo. */}
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {/* "Conversão" aqui é lead → venda. No mesmo diálogo, o CPR alvo fala de
              "eventos de conversão" da Meta — a frase desfaz a ambiguidade. */}
          <p>Conversão: de cada 100 leads desta faixa, quantos viram venda.</p>
          <p>
            A nota exata do corte entra na faixa de cima.{" "}
            {mqlLeadscoreMin !== null ? `Seu corte de MQL é ${formatLeadScore(mqlLeadscoreMin)}.` : "Este pack não tem corte de MQL."}
          </p>
        </div>
        <div>
          <Button ref={addBandRef} variant="outline" size="sm" onClick={addBand} disabled={disabled}>
            <IconPlus />
            Adicionar faixa
          </Button>
          <ErrorSummary messages={bandErrors} />
        </div>
      </div>
    </div>
  );
}
