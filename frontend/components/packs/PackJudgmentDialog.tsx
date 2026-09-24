"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconLoader2, IconInfoCircle, IconAlertTriangle, IconCalculator, IconTrash } from "@tabler/icons-react";

import { AppDialog } from "@/components/common/AppDialog";
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
import { showError, showSuccess } from "@/lib/utils/toast";
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
}

const EMPTY_FORM: PackJudgmentFormValues = { mql: "", targets: {} };

/**
 * Configuração de julgamento do pack.
 *
 * Não há mais herança da conta (migration 110): estes valores existem só aqui.
 * Campo vazio significa NÃO DEFINIDO — e não zero. Sem corte de leadscore, MQL e
 * CPMQL ficam indisponíveis nas telas, o que é o comportamento correto: zero
 * contaria todo lead como qualificado e produziria um CPMQL excelente e falso.
 */
export function PackJudgmentDialog({ pack, open, onOpenChange, accountCurrency }: PackJudgmentDialogProps) {
  const { updatePack } = useClientPacks();
  // Preferência só como reserva: ela acompanha a conta apenas quando todas as contas
  // do usuário têm a mesma moeda, e em pack compartilhado é a moeda de quem vê — por
  // isso o editor avisa quando é ela que está valendo.
  const settingsCurrency = useSettingsStore((state) => state.settings.currency);
  const { code: currency, fromAccount: currencyFromAccount } = resolvePackCurrency(accountCurrency, settingsCurrency);

  const [isSaving, setIsSaving] = useState(false);
  // Como os campos abriram: é a referência de "há alteração a perder".
  const [initialForm, setInitialForm] = useState<PackJudgmentFormValues>(EMPTY_FORM);
  const [mqlValue, setMqlValue] = useState("");
  const [targets, setTargets] = useState<Record<string, string>>({});

  // Economia do lead. `economicsSaved` é o gravado já normalizado (null também
  // quando é inválido); `economicsRawExists` diz se a coluna tem QUALQUER coisa — é
  // o que deixa apagar um cadastro inválido, que o editor não consegue mostrar.
  const [economicsSaved, setEconomicsSaved] = useState<LeadEconomics | null>(null);
  const [economicsRawExists, setEconomicsRawExists] = useState(false);
  const [economics, setEconomics] = useState<LeadEconomicsEditState>(() => openLeadEconomicsEdit(null));
  const [showEconomicsErrors, setShowEconomicsErrors] = useState(false);

  const conversionTypes = useMemo(
    () => (Array.isArray(pack?.conversion_types) ? pack!.conversion_types : []),
    [pack]
  );

  const hasSheetIntegration = Boolean(pack?.sheet_integration);

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
    if (!open || !pack) return;

    const initial = packJudgmentFormValues(pack, conversionTypes);
    setInitialForm(initial);
    setMqlValue(initial.mql);
    setTargets(initial.targets);

    // Cadastro inválido conta como não configurado (mesma regra das telas que o leem).
    const savedEconomics = normalizeLeadEconomics(pack.lead_economics);
    setEconomicsSaved(savedEconomics);
    setEconomicsRawExists(pack.lead_economics !== null && pack.lead_economics !== undefined);
    setEconomics(openLeadEconomicsEdit(savedEconomics));
    setShowEconomicsErrors(false);
  }, [open, pack, conversionTypes]);

  const parsedMql = parseJudgmentNumber(mqlValue);
  const savedEconomicsInfo = useMemo(
    () => ({ valid: economicsSaved !== null, rawExists: economicsRawExists }),
    [economicsSaved, economicsRawExists]
  );
  const economicsPanel = leadEconomicsEditPanel(economics, savedEconomicsInfo);

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
  // sem pergunta. Fechar fica com Cancelar, o X e Salvar — gestos deliberados.
  const hasUnsavedChanges = isLeadEconomicsEditDirty(economics) || isPackJudgmentFormDirty(initialForm, { mql: mqlValue, targets });

  const handleSave = useCallback(async () => {
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
  }, [pack, mqlValue, targets, economicsDecision, updatePack, onOpenChange]);

  if (!pack) return null;

  return (
    // 2xl (e não lg): as tabelas de produtos e faixas da economia do lead não cabem
    // em 512px. O AppDialog já rola o corpo acima de 90vh.
    <AppDialog
      isOpen={open}
      onClose={() => onOpenChange(false)}
      size="2xl"
      title="Configuração do pack"
      closeOnEscape={!hasUnsavedChanges}
      closeOnOverlayClick={!hasUnsavedChanges}
    >
      <div className="space-y-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">Configuração do pack</h2>
          <p className="text-sm text-muted-foreground">
            Define como o pack <span className="font-medium text-foreground">{pack.name}</span> julga os
            anúncios. Estes critérios pertencem ao pack e acompanham quem tiver acesso a ele.
          </p>
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
                  onChange={(e) => setMqlValue(e.target.value)}
                  placeholder="não definido"
                  disabled={isSaving}
                />
                {parsedMql === null ? (
                  <p className="flex items-start gap-2 text-xs text-warning">
                    <IconAlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    Sem corte definido, MQL e CPMQL ficam indisponíveis nas telas deste pack.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <IconInfoCircle className="mt-0.5 h-3 w-3 shrink-0" />
                Este pack não tem planilha integrada, então não há leadscore para qualificar.
              </p>
            )}
          </section>

          {/* ── CPR alvo por evento ── */}
          <section className="space-y-2">
            <div>
              <p className="text-sm font-medium text-foreground">CPR alvo por evento</p>
              <p className="text-xs text-muted-foreground">
                Opcional. Usado pelo plano de ação para comparar o custo real com a sua meta.
              </p>
            </div>

            {conversionTypes.length === 0 ? (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <IconInfoCircle className="mt-0.5 h-3 w-3 shrink-0" />
                Este pack ainda não tem eventos de conversão registrados. Atualize o pack para
                que os eventos apareçam aqui.
              </p>
            ) : (
              <div className="space-y-2">
                {conversionTypes.map((type) => (
                  <div key={type} className="flex items-center gap-3">
                    <span className="flex-1 truncate text-xs text-muted-foreground" title={type}>
                      {formatActionTypeLabel(type)}
                    </span>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      size="sm"
                      className="w-32"
                      value={targets[type] ?? ""}
                      onChange={(e) => setTargets((prev) => ({ ...prev, [type]: e.target.value }))}
                      placeholder="sem meta"
                      disabled={isSaving}
                    />
                  </div>
                ))}
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

            {!hasSheetIntegration ? (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <IconInfoCircle className="mt-0.5 h-3 w-3 shrink-0" />
                Este pack não tem planilha integrada. Sem leadscore não há como calcular o teto de CPL nem a margem.
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
                    ? "O cadastro deste pack será apagado quando você salvar."
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
                message="A economia do lead gravada neste pack não é válida e está sendo ignorada: teto de CPL e margem ficam indisponíveis. Remova o cadastro ou configure de novo."
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              "Salvar configuração"
            )}
          </Button>
        </footer>
      </div>
    </AppDialog>
  );
}
