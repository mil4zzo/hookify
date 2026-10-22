"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconLoader2, IconInfoCircle, IconAlertTriangle, IconCalculator, IconTrash } from "@tabler/icons-react";

import { AppDialog } from "@/components/common/AppDialog";
import { BulkApplyReviewDialog } from "@/components/common/BulkApplyReviewDialog";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { StatePanel } from "@/components/common/States";
import { LeadEconomicsEditor } from "@/components/packs/LeadEconomicsEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/endpoints";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { useSettingsStore } from "@/lib/store/settings";
import { normalizeLeadEconomics, type LeadEconomics } from "@/lib/utils/leadEconomics";
import {
  decideLeadEconomicsPayload,
  editLeadEconomicsDraft,
  isLeadEconomicsEditDirty,
  leadEconomicsEditPanel,
  openLeadEconomicsEdit,
  removeLeadEconomicsEdit,
  startLeadEconomicsEdit,
  undoRemoveLeadEconomicsEdit,
  type LeadEconomicsDraft,
  type LeadEconomicsEditPanel,
  type LeadEconomicsEditState,
} from "@/lib/utils/leadEconomicsDraft";
import {
  buildPackJudgmentPayload,
  formatActionTypeLabel,
  isPackJudgmentFormDirty,
  packJudgmentFormValues,
  parseJudgmentNumber,
  resolvePackCurrency,
  type PackJudgmentFormValues,
} from "@/lib/utils/packJudgmentForm";
import {
  buildBulkPackJudgmentPayload,
  bulkFieldEffect,
  changedBulkTargets,
  bulkJudgmentStorePatch,
  describeMqlValues,
  resolveBulkPackCurrency,
  seedBulkJudgment,
  summarizeBulkJudgment,
  type BulkJudgmentSeed,
  type BulkPackJudgmentPayload,
} from "@/lib/utils/packJudgmentBulk";
import { reviewBulkJudgment, type BulkReview } from "@/lib/utils/bulkApplyReview";
import { listNames } from "@/lib/utils/bulkSheetSync";
import { showError, showSuccess, showWarning } from "@/lib/utils/toast";
import type { AdsPack } from "@/lib/types";

interface PackJudgmentDialogProps {
  pack: AdsPack | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Moeda da CONTA de anúncios do pack (`findAdAccountCurrency`), resolvida por quem
   * abre o diálogo com a lista de contas que já carrega. O ticket da economia do
   * lead é comparado com o gasto da Meta, que vem nessa moeda. Ausente (pack
   * compartilhado de conta alheia, conta ainda sem moeda) → moeda das preferências.
   */
  accountCurrency?: string | null;
  /**
   * Configuração em MASSA: os mesmos critérios para todos estes packs (dono ou
   * editor em cada um — quem abre já filtrou os de leitura). Campo não mexido fica
   * como está em cada pack; mexido vale para todos. Ignora `pack`.
   */
  bulkPacks?: AdsPack[] | null;
  /** Em massa: a moeda da conta de CADA pack, na ordem de `bulkPacks`. */
  accountCurrencies?: Array<string | null>;
}

const EMPTY_FORM: PackJudgmentFormValues = { mql: "", targets: {} };

/**
 * Configuração de julgamento do pack.
 *
 * Não há mais herança da conta (migration 110): estes valores existem só aqui.
 * Campo vazio significa NÃO DEFINIDO — e não zero. Sem corte de leadscore, MQL e
 * CPMQL ficam indisponíveis nas telas, o que é o comportamento correto: zero
 * contaria todo lead como qualificado e produziria um CPMQL excelente e falso.
 *
 * Em MASSA (`bulkPacks`), a mesma tela vale para N packs: abre pré-preenchida só
 * onde todos concordam, e o save manda apenas o que foi mexido (ver
 * `packJudgmentBulk.ts` — mexido e vazio limpa em todos).
 */
export function PackJudgmentDialog({ pack, open, onOpenChange, accountCurrency, bulkPacks, accountCurrencies }: PackJudgmentDialogProps) {
  const { updatePack } = useClientPacks();
  const isBulk = !!bulkPacks && bulkPacks.length > 0;
  // Preferência só como reserva: ela acompanha a conta apenas quando todas as contas
  // do usuário têm a mesma moeda, e em pack compartilhado é a moeda de quem vê — por
  // isso o editor avisa quando é ela que está valendo.
  const settingsCurrency = useSettingsStore((state) => state.settings.currency);
  const bulkCurrency = useMemo(
    () => (isBulk ? resolveBulkPackCurrency(accountCurrencies ?? [], settingsCurrency) : null),
    [isBulk, accountCurrencies, settingsCurrency]
  );
  const { code: currency, fromAccount: currencyFromAccount } = bulkCurrency ?? resolvePackCurrency(accountCurrency, settingsCurrency);

  const [isSaving, setIsSaving] = useState(false);
  // Como os campos abriram: é a referência de "há alteração a perder".
  const [initialForm, setInitialForm] = useState<PackJudgmentFormValues>(EMPTY_FORM);
  const [mqlValue, setMqlValue] = useState("");
  const [targets, setTargets] = useState<Record<string, string>>({});
  // Semente da abertura em massa: valores acordados, divergências, união dos eventos.
  const [bulkSeed, setBulkSeed] = useState<BulkJudgmentSeed | null>(null);

  // Economia do lead. `economicsSaved` é o gravado já normalizado (null também
  // quando é inválido); `economicsRawExists` diz se a coluna tem QUALQUER coisa — é
  // o que deixa apagar um cadastro inválido, que o editor não consegue mostrar.
  const [economicsSaved, setEconomicsSaved] = useState<LeadEconomics | null>(null);
  const [economicsRawExists, setEconomicsRawExists] = useState(false);
  const [economics, setEconomics] = useState<LeadEconomicsEditState>(() => openLeadEconomicsEdit(null));
  const [showEconomicsErrors, setShowEconomicsErrors] = useState(false);
  // "Descartar alterações?" aberto por cima (X ou Cancelar com algo a perder).
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  // Em massa, quando o save sobrescreve algo: o resumo aberto por cima, com o payload
  // já validado esperando o "Aplicar".
  const [pendingBulk, setPendingBulk] = useState<{ payload: BulkPackJudgmentPayload; review: BulkReview } | null>(null);

  const conversionTypes = useMemo(() => {
    if (isBulk) return bulkSeed?.conversionTypes ?? [];
    return Array.isArray(pack?.conversion_types) ? pack!.conversion_types : [];
  }, [isBulk, bulkSeed, pack]);

  const packCount = isBulk ? bulkPacks!.length : 1;
  // Direto dos packs (não da semente, que só existe depois do primeiro efeito): senão a
  // abertura em massa piscaria "nenhum pack tem planilha" por um quadro.
  const packsWithSheet = isBulk ? bulkPacks!.filter((p) => !!p.sheet_integration).length : pack?.sheet_integration ? 1 : 0;
  // Em massa basta UM pack com planilha para os campos de leadscore fazerem sentido;
  // os sem planilha recebem o critério e ele passa a valer quando a conectarem.
  const hasSheetIntegration = packsWithSheet > 0;
  const economicsDivergent = isBulk && !!bulkSeed?.divergent.economics;

  // Foco depois de trocar o conteúdo da seção: o botão clicado some junto com o
  // estado que o mostrava, e sem isto o foco cairia no topo do diálogo (teclado e
  // leitor de tela voltariam a atravessar corte de MQL e CPR alvo). O pedido é o
  // PAINEL que o próximo estado mostra (`leadEconomicsEditPanel`) e cada painel tem
  // um controle com ref de callback que o atende — pedido e painel saem da mesma
  // função, então nunca fica pedido sem quem atenda. Só foca com troca pendente:
  // abrir o diálogo não rouba o foco de ninguém.
  const focusPendingRef = useRef<LeadEconomicsEditPanel | null>(null);
  const focusRefs = useMemo(() => {
    const focusIfPending = (panel: LeadEconomicsEditPanel) => (element: HTMLElement | null) => {
      if (element && focusPendingRef.current === panel) {
        focusPendingRef.current = null;
        element.focus();
      }
    };
    return {
      editor: focusIfPending("editor"),
      removed: focusIfPending("removed"),
      invalid: focusIfPending("invalid"),
      empty: focusIfPending("empty"),
    };
  }, []);

  // Reidrata o formulário toda vez que abre — sem isto, reabrir para outro pack
  // mostraria o estado do pack anterior.
  useEffect(() => {
    // O componente fica montado entre aberturas (a página só troca o `pack`): pedido
    // de foco que sobrou da abertura anterior não pode roubar o foco desta. Zera
    // também ao FECHAR: na reabertura, as refs do primeiro render (ainda com o estado
    // da abertura anterior) se ligam antes deste efeito rodar.
    focusPendingRef.current = null;
    setConfirmingDiscard(false);
    setPendingBulk(null);
    if (!open) return;

    if (bulkPacks && bulkPacks.length > 0) {
      const seed = seedBulkJudgment(bulkPacks);
      setBulkSeed(seed);
      setInitialForm(seed.form);
      setMqlValue(seed.form.mql);
      setTargets(seed.form.targets);
      setEconomicsSaved(seed.economicsSaved);
      setEconomicsRawExists(seed.economicsRawExists);
      setEconomics(openLeadEconomicsEdit(seed.economicsSaved));
      setShowEconomicsErrors(false);
      return;
    }
    setBulkSeed(null);
    if (!pack) return;

    const types = Array.isArray(pack.conversion_types) ? pack.conversion_types : [];
    const initial = packJudgmentFormValues(pack, types);
    setInitialForm(initial);
    setMqlValue(initial.mql);
    setTargets(initial.targets);

    // Cadastro inválido conta como não configurado (mesma regra das telas que o leem).
    const savedEconomics = normalizeLeadEconomics(pack.lead_economics);
    setEconomicsSaved(savedEconomics);
    setEconomicsRawExists(pack.lead_economics !== null && pack.lead_economics !== undefined);
    setEconomics(openLeadEconomicsEdit(savedEconomics));
    setShowEconomicsErrors(false);
  }, [open, pack, bulkPacks]);

  const parsedMql = parseJudgmentNumber(mqlValue);
  // Em massa com packs que discordam, a seção abre como "não configurada" (com o
  // aviso de divergência), não como "cadastro gravado inválido" — mas o `Remover`
  // continua sabendo que há cadastro a apagar (`economicsRawExists`).
  const savedEconomicsInfo = useMemo(
    () => ({ valid: economicsSaved !== null, rawExists: economicsDivergent ? false : economicsRawExists }),
    [economicsSaved, economicsRawExists, economicsDivergent]
  );
  const economicsPanel = leadEconomicsEditPanel(economics, savedEconomicsInfo);

  const handleMqlChange = useCallback((value: string) => {
    setMqlValue(value);
  }, []);

  const handleTargetChange = useCallback((type: string, value: string) => {
    setTargets((prev) => ({ ...prev, [type]: value }));
  }, []);

  const handleEconomicsChange = useCallback((next: LeadEconomicsDraft) => {
    setEconomics(editLeadEconomicsDraft(next));
  }, []);

  /** Troca o estado da seção e pede o foco para o painel que ele vai mostrar. */
  const transitionEconomics = useCallback(
    (next: LeadEconomicsEditState) => {
      focusPendingRef.current = leadEconomicsEditPanel(next, savedEconomicsInfo);
      setEconomics(next);
    },
    [savedEconomicsInfo]
  );

  const startEconomics = useCallback(() => {
    // O corte do campo acima, mesmo antes de salvar: é o que a pessoa está vendo.
    transitionEconomics(startLeadEconomicsEdit(parsedMql));
    setShowEconomicsErrors(false);
  }, [parsedMql, transitionEconomics]);

  // Sem confirmação: nada é apagado aqui, e o "Desfazer" devolve o que havia na
  // tela (inclusive o que foi digitado e não salvo). Formulário que ninguém tocou,
  // sem nada gravado, volta direto a "não configurada".
  const removeEconomics = useCallback(() => {
    transitionEconomics(removeLeadEconomicsEdit(economics, { rawSavedExists: economicsRawExists }));
    setShowEconomicsErrors(false);
  }, [economics, economicsRawExists, transitionEconomics]);

  const undoRemoveEconomics = useCallback(() => {
    transitionEconomics(undoRemoveLeadEconomicsEdit(economics));
  }, [economics, transitionEconomics]);

  // Se e com o quê a chave `lead_economics` vai no save (D21) — a regra inteira é a
  // função pura, testada em leadEconomicsDraft.test.ts.
  const economicsDecision = useMemo(
    () =>
      decideLeadEconomicsPayload({
        draft: economics.draft,
        saved: economicsSaved,
        rawSavedExists: economicsRawExists,
        touched: economics.touched,
        removed: economics.removed !== null,
      }),
    [economics, economicsSaved, economicsRawExists]
  );

  // Com alteração a perder, Esc e clique fora não fecham: o cadastro inteiro sumiria
  // sem pergunta. Cancelar e o X perguntam antes de descartar (revisão P1).
  const hasUnsavedChanges = isLeadEconomicsEditDirty(economics) || isPackJudgmentFormDirty(initialForm, { mql: mqlValue, targets });

  const requestClose = useCallback(() => {
    if (hasUnsavedChanges) setConfirmingDiscard(true);
    else onOpenChange(false);
  }, [hasUnsavedChanges, onOpenChange]);

  // Funções simples (sem useCallback): o diálogo só re-renderiza ao digitar, e
  // memoizar aqui exigiria esconder dependências do lint.
  async function handleBulkSave() {
    if (!bulkPacks || bulkPacks.length === 0) return;
    const built = buildBulkPackJudgmentPayload({ mql: mqlValue, targets }, initialForm, economicsDecision);
    if (built.kind === "error") {
      if (built.field === "economics") setShowEconomicsErrors(true);
      showError(built.message);
      return;
    }
    if (built.kind === "empty") {
      showWarning("Nenhum critério foi alterado. Mexa no que deve valer para todos os packs.");
      return;
    }
    // Sobrescreve algo que algum pack tinha: mostra o resumo antes de gravar.
    const review = reviewBulkJudgment(bulkPacks, built.payload);
    if (review.needsConfirm) {
      setPendingBulk({ payload: built.payload, review });
      return;
    }
    await sendBulk(built.payload);
  }

  async function sendBulk(payload: BulkPackJudgmentPayload) {
    if (!bulkPacks || bulkPacks.length === 0) return;
    setIsSaving(true);
    try {
      const response = await api.analytics.updatePackJudgmentBulk({ pack_ids: bulkPacks.map((p) => p.id), ...payload });
      for (const result of response.results) {
        if (result.status === "updated" && result.judgment) updatePack(result.pack_id, bulkJudgmentStorePatch(result.judgment));
      }
      const names = Object.fromEntries(bulkPacks.map((p) => [p.id, p.name]));
      const summary = summarizeBulkJudgment(response.results, names);
      if (summary.failed.length > 0) {
        showError(new Error(`${summary.headline}. Falhou em: ${summary.failed.map((f) => `${f.name} (${f.error})`).join("; ")}`));
      } else if (summary.skipped.length > 0) {
        showWarning(`${summary.headline}. Sem permissão em: ${listNames(summary.skipped)}.`);
      } else {
        showSuccess(`Critérios aplicados: ${summary.headline}.`);
      }
      onOpenChange(false);
    } catch (err) {
      showError(err as Error);
    } finally {
      setIsSaving(false);
    }
  }

  const handleSave = useCallback(async () => {
    if (isBulk) {
      await handleBulkSave();
      return;
    }
    if (!pack) return;

    // Validação e montagem do payload são a função pura (packJudgmentForm.test.ts
    // prende a chave `lead_economics` AUSENTE quando a economia não mudou — D21).
    const built = buildPackJudgmentPayload({ mql: mqlValue, targets }, economicsDecision);
    if (built.kind === "error") {
      if (built.field === "economics") setShowEconomicsErrors(true);
      showError(built.message);
      return;
    }
    const { payload } = built;

    setIsSaving(true);
    try {
      const response = await api.analytics.updatePackJudgment(pack.id, payload);
      const patch: Partial<AdsPack> = { mql_leadscore_min: payload.mql_leadscore_min, target_cpr: payload.target_cpr };
      if ("lead_economics" in payload) {
        // O backend devolve o documento canônico que gravou. O local passou pelo
        // mesmo validador e é o mesmo canônico — serve de reserva se a chave não vier.
        const sent = payload.lead_economics ?? null;
        const returned = response?.judgment?.lead_economics;
        patch.lead_economics = returned === undefined ? sent : (normalizeLeadEconomics(returned) ?? sent);
      }
      updatePack(pack.id, patch);
      showSuccess("Configuração do pack salva.");
      onOpenChange(false);
    } catch (err) {
      showError(err as Error);
    } finally {
      setIsSaving(false);
    }
  }, [isBulk, handleBulkSave, pack, mqlValue, targets, economicsDecision, updatePack, onOpenChange]);

  if (!pack && !isBulk) return null;

  const packsNoun = packCount === 1 ? "pack" : "packs";
  const mqlEffect = isBulk ? bulkFieldEffect(initialForm.mql, mqlValue) : null;
  const changedTargets = isBulk ? changedBulkTargets(initialForm, { mql: mqlValue, targets }) : [];

  return (
    // 2xl (e não lg): as tabelas de produtos e faixas da economia do lead não cabem
    // em 512px. O AppDialog já rola o corpo acima de 90vh.
    <AppDialog
      isOpen={open}
      onClose={requestClose}
      size="2xl"
      title={isBulk ? "Configuração dos packs" : "Configuração do pack"}
      closeOnEscape={!hasUnsavedChanges}
      closeOnOverlayClick={!hasUnsavedChanges}
    >
      <div className="space-y-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">{isBulk ? "Configuração dos packs" : "Configuração do pack"}</h2>
          {isBulk ? (
            <p className="text-sm text-muted-foreground">
              Os mesmos critérios para{" "}
              <span className="font-medium text-foreground">
                {packCount} {packsNoun}
              </span>{" "}
              ({listNames(bulkPacks!.map((p) => p.name))}). O que você mexer aqui vale para todos; o que não mexer fica
              como está em cada pack.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Define como o pack <span className="font-medium text-foreground">{pack!.name}</span> julga os
              anúncios. Estes critérios pertencem ao pack e acompanham quem tiver acesso a ele.
            </p>
          )}
        </header>

        <div className="space-y-6">
          {/* ── Leadscore mínimo para MQL ── */}
          <section className="space-y-2">
            <div>
              <p className="text-sm font-medium text-foreground">Leadscore mínimo para MQL</p>
              <p className="text-xs text-muted-foreground">
                Leads com leadscore maior ou igual a este valor contam como MQL. A escala vem da
                planilha integrada.
              </p>
            </div>

            {hasSheetIntegration ? (
              <>
                <Input
                  type="number"
                  min="0"
                  step="0.1"
                  size="sm"
                  value={mqlValue}
                  onChange={(e) => handleMqlChange(e.target.value)}
                  placeholder={isBulk && bulkSeed?.divergent.mql ? "os packs discordam" : "não definido"}
                  disabled={isSaving}
                />
                {isBulk && bulkSeed?.divergent.mql && mqlEffect === "keep" ? (
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <IconInfoCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    Hoje os packs têm cortes diferentes ({describeMqlValues(bulkSeed.mqlValues)}). Sem mexer aqui,
                    cada um mantém o seu.
                  </p>
                ) : null}
                {isBulk && packsWithSheet < packCount ? (
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <IconInfoCircle className="mt-0.5 h-3 w-3 shrink-0" />
                    {packCount - packsWithSheet} {packCount - packsWithSheet === 1 ? "pack ainda não tem" : "packs ainda não têm"}{" "}
                    planilha: {packCount - packsWithSheet === 1 ? "recebe" : "recebem"} o critério mesmo assim, e ele
                    passa a valer quando a planilha for conectada.
                  </p>
                ) : null}
                {mqlEffect === "set" ? (
                  <p className="text-xs text-muted-foreground">
                    Define o corte {parsedMql ?? mqlValue} nos {packCount} {packsNoun}.
                  </p>
                ) : mqlEffect === "clear" ? (
                  <p className="flex items-start gap-2 text-xs text-warning">
                    <IconAlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    Limpa o corte nos {packCount} {packsNoun}: MQL e CPMQL ficam indisponíveis em todos.
                  </p>
                ) : parsedMql === null && !(isBulk && bulkSeed?.divergent.mql) ? (
                  <p className="flex items-start gap-2 text-xs text-warning">
                    <IconAlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    Sem corte definido, MQL e CPMQL ficam indisponíveis nas telas {isBulk ? "destes packs" : "deste pack"}.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <IconInfoCircle className="mt-0.5 h-3 w-3 shrink-0" />
                {isBulk
                  ? "Nenhum destes packs tem planilha integrada, então não há leadscore para qualificar."
                  : "Este pack não tem planilha integrada, então não há leadscore para qualificar."}
              </p>
            )}
          </section>

          {/* ── CPR alvo por evento ── */}
          <section className="space-y-2">
            <div>
              <p className="text-sm font-medium text-foreground">CPR alvo por evento</p>
              <p className="text-xs text-muted-foreground">
                Opcional. Usado pelo plano de ação para comparar o custo real com a sua meta.
                {isBulk ? " Só os eventos que você mexer mudam nos packs; os outros ficam como estão em cada um." : ""}
              </p>
            </div>

            {conversionTypes.length === 0 ? (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <IconInfoCircle className="mt-0.5 h-3 w-3 shrink-0" />
                {isBulk
                  ? "Estes packs ainda não têm eventos de conversão registrados. Atualize os packs para que os eventos apareçam aqui."
                  : "Este pack ainda não tem eventos de conversão registrados. Atualize o pack para que os eventos apareçam aqui."}
              </p>
            ) : (
              <div className="space-y-2">
                {conversionTypes.map((type) => {
                  const diverges = isBulk && !!bulkSeed?.divergent.targetKeys.includes(type) && !changedTargets.includes(type);
                  return (
                    <div key={type} className="flex items-center gap-3">
                      <span className="flex-1 truncate text-xs text-muted-foreground" title={type}>
                        {formatActionTypeLabel(type)}
                        {diverges ? <span className="opacity-50"> · os packs discordam</span> : null}
                      </span>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        size="sm"
                        className="w-32"
                        value={targets[type] ?? ""}
                        onChange={(e) => handleTargetChange(type, e.target.value)}
                        placeholder="sem meta"
                        disabled={isSaving}
                      />
                    </div>
                  );
                })}
                {changedTargets.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {changedTargets.length === 1 ? "1 evento alterado" : `${changedTargets.length} eventos alterados`}: a meta vale
                    para os {packCount} {packsNoun} (campo vazio remove a meta desse evento em todos).
                  </p>
                ) : null}
              </div>
            )}
          </section>

          {/* ── Economia do lead ── */}
          <section className="space-y-3">
            {/* Quebra de linha em vez de espremer: em tela estreita o botão desce e o
                texto fica com a largura toda (piso de 12rem antes de quebrar). */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-[12rem] flex-1">
                <p className="text-sm font-medium text-foreground">Economia do lead</p>
                <p className="text-xs text-muted-foreground">
                  Dá o teto de CPL e a margem de cada anúncio, a partir do que você vende e de quem compra.
                  {isBulk && economicsSaved ? ` Os ${packCount} ${packsNoun} têm o mesmo cadastro; o que você salvar vale para todos.` : ""}
                </p>
              </div>
              {hasSheetIntegration && economics.draft ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  aria-label="Remover economia do lead"
                  onClick={removeEconomics}
                  disabled={isSaving}
                >
                  <IconTrash />
                  Remover
                </Button>
              ) : null}
            </div>

            {bulkCurrency && bulkCurrency.mixed.length > 1 && hasSheetIntegration ? (
              <p className="flex items-start gap-2 text-xs text-warning">
                <IconAlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                Os packs estão em contas com moedas diferentes ({bulkCurrency.mixed.join(", ")}). O ticket é um número só,
                lido na moeda de cada conta: confira se o mesmo valor faz sentido para todos.
              </p>
            ) : null}

            {!hasSheetIntegration ? (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <IconInfoCircle className="mt-0.5 h-3 w-3 shrink-0" />
                {isBulk
                  ? "Nenhum destes packs tem planilha integrada. Sem leadscore não há como calcular o teto de CPL nem a margem."
                  : "Este pack não tem planilha integrada. Sem leadscore não há como calcular o teto de CPL nem a margem."}
              </p>
            ) : economicsPanel === "editor" && economics.draft ? (
              <LeadEconomicsEditor
                value={economics.draft}
                onChange={handleEconomicsChange}
                mqlLeadscoreMin={parsedMql}
                currency={currency}
                currencyFromAccount={currencyFromAccount}
                disabled={isSaving}
                showAllErrors={showEconomicsErrors}
                firstFieldRef={focusRefs.editor}
              />
            ) : economicsPanel === "removed" ? (
              // Removida nesta sessão, ainda não salva: dá para voltar atrás aqui mesmo,
              // com o que estava na tela (não o gravado).
              <StatePanel
                kind="empty"
                density="compact"
                icon={IconCalculator}
                title="Economia do lead removida"
                message={
                  economicsRawExists
                    ? isBulk
                      ? "O cadastro será apagado de todos os packs que o têm quando você salvar."
                      : "O cadastro deste pack será apagado quando você salvar."
                    : "O que foi preenchido aqui não será salvo."
                }
                action={
                  <Button ref={focusRefs.removed} variant="outline" size="sm" onClick={undoRemoveEconomics} disabled={isSaving}>
                    Desfazer
                  </Button>
                }
              />
            ) : economicsPanel === "invalid" ? (
              // Gravado fora do contrato: as telas o ignoram (teto e margem somem), e
              // sem isto não haveria como limpá-lo — o editor não consegue abri-lo.
              <StatePanel
                kind="warning"
                density="compact"
                title="Cadastro gravado inválido"
                message={
                  isBulk
                    ? "Algum destes packs tem uma economia do lead gravada que não é válida e está sendo ignorada: teto de CPL e margem ficam indisponíveis nele. Remova de todos ou configure de novo para todos."
                    : "A economia do lead gravada neste pack não é válida e está sendo ignorada: teto de CPL e margem ficam indisponíveis. Remova o cadastro ou configure de novo."
                }
                action={
                  <div className="flex flex-wrap justify-center gap-3">
                    <Button ref={focusRefs.invalid} variant="outline" size="sm" onClick={removeEconomics} disabled={isSaving}>
                      <IconTrash />
                      Remover cadastro
                    </Button>
                    <Button variant="outline" size="sm" onClick={startEconomics} disabled={isSaving}>
                      Configurar de novo
                    </Button>
                  </div>
                }
              />
            ) : economicsDivergent ? (
              // Em massa, com cadastros diferentes entre os packs (ou só alguns com
              // cadastro): não há o que pré-preencher. Configurar substitui em todos;
              // remover apaga de todos. Sem mexer, cada pack fica com o seu.
              <StatePanel
                kind="empty"
                density="compact"
                icon={IconCalculator}
                title="Os packs discordam na economia do lead"
                message="Cada pack tem um cadastro diferente, ou alguns não têm. Configurar aqui substitui o cadastro em todos; remover apaga de todos. Sem mexer, cada pack mantém o seu."
                action={
                  <div className="flex flex-wrap justify-center gap-3">
                    <Button ref={focusRefs.empty} variant="outline" size="sm" onClick={startEconomics} disabled={isSaving}>
                      Configurar para todos
                    </Button>
                    <Button variant="outline" size="sm" onClick={removeEconomics} disabled={isSaving}>
                      <IconTrash />
                      Remover de todos
                    </Button>
                  </div>
                }
              />
            ) : (
              <StatePanel
                kind="empty"
                density="compact"
                icon={IconCalculator}
                title="Economia do lead não configurada"
                message="Cadastre o que você vende e quanto cada faixa de nota vira venda. Com isso, cada anúncio ganha um teto de quanto você pode pagar por lead."
                action={
                  <Button ref={focusRefs.empty} variant="outline" size="sm" onClick={startEconomics} disabled={isSaving}>
                    Configurar economia do lead
                  </Button>
                }
              />
            )}
          </section>
        </div>

        <footer className="flex justify-end gap-3 border-t border-border pt-4">
          <Button variant="outline" onClick={requestClose} disabled={isSaving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : isBulk ? (
              `Aplicar aos ${packCount} ${packsNoun}`
            ) : (
              "Salvar configuração"
            )}
          </Button>
        </footer>
      </div>

      <BulkApplyReviewDialog
        review={pendingBulk?.review ?? null}
        packCount={packCount}
        onCancel={() => setPendingBulk(null)}
        onConfirm={() => {
          const payload = pendingBulk?.payload;
          setPendingBulk(null);
          if (payload) void sendBulk(payload);
        }}
      />

      <ConfirmDialog
        isOpen={confirmingDiscard}
        onClose={() => setConfirmingDiscard(false)}
        title="Descartar alterações?"
        message={
          isBulk
            ? "O que você mudou na configuração destes packs ainda não foi salvo e vai se perder."
            : "O que você mudou na configuração deste pack ainda não foi salvo e vai se perder."
        }
        cancelText="Continuar editando"
        confirmText="Descartar"
        variant="destructive"
        size="sm"
        nested
        onConfirm={() => {
          setConfirmingDiscard(false);
          onOpenChange(false);
        }}
      />
    </AppDialog>
  );
}
