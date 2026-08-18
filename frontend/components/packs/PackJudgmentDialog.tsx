"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconLoader2, IconInfoCircle, IconAlertTriangle } from "@tabler/icons-react";

import { AppDialog } from "@/components/common/AppDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api/endpoints";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { showError, showSuccess } from "@/lib/utils/toast";
import type { AdsPack } from "@/lib/types";

interface PackJudgmentDialogProps {
  pack: AdsPack | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Remove o prefixo "conversion:"/"action:" do label exibido. */
function formatActionTypeLabel(option: string) {
  return option.includes(":") ? option.split(":", 2)[1] : option;
}

function toNumberOrNull(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Configuração de julgamento do pack.
 *
 * Não há mais herança da conta (migration 110): estes valores existem só aqui.
 * Campo vazio significa NÃO DEFINIDO — e não zero. Sem corte de leadscore, MQL e
 * CPMQL ficam indisponíveis nas telas, o que é o comportamento correto: zero
 * contaria todo lead como qualificado e produziria um CPMQL excelente e falso.
 */
export function PackJudgmentDialog({ pack, open, onOpenChange }: PackJudgmentDialogProps) {
  const { updatePack } = useClientPacks();

  const [isSaving, setIsSaving] = useState(false);
  const [mqlValue, setMqlValue] = useState("");
  const [targets, setTargets] = useState<Record<string, string>>({});

  const conversionTypes = useMemo(
    () => (Array.isArray(pack?.conversion_types) ? pack!.conversion_types : []),
    [pack]
  );

  const hasSheetIntegration = Boolean(pack?.sheet_integration);

  // Reidrata o formulário toda vez que abre — sem isto, reabrir para outro pack
  // mostraria o estado do pack anterior.
  useEffect(() => {
    if (!open || !pack) return;

    const hasMql = pack.mql_leadscore_min !== null && pack.mql_leadscore_min !== undefined;
    setMqlValue(hasMql ? String(pack.mql_leadscore_min) : "");

    const packTarget = pack.target_cpr && typeof pack.target_cpr === "object" ? pack.target_cpr : null;
    const asStrings: Record<string, string> = {};
    for (const type of conversionTypes) {
      const value = (packTarget as Record<string, number> | null)?.[type];
      asStrings[type] = value !== undefined && value !== null ? String(value) : "";
    }
    setTargets(asStrings);
  }, [open, pack, conversionTypes]);

  const parsedMql = toNumberOrNull(mqlValue);

  const handleSave = useCallback(async () => {
    if (!pack) return;

    let mqlPayload: number | null = null;
    if (mqlValue.trim()) {
      const parsed = toNumberOrNull(mqlValue);
      if (parsed === null || parsed < 0) {
        showError("Informe um leadscore mínimo válido (número maior ou igual a zero).");
        return;
      }
      mqlPayload = parsed;
    }

    const built: Record<string, number> = {};
    for (const [type, raw] of Object.entries(targets)) {
      const parsed = toNumberOrNull(raw);
      if (parsed === null) continue; // vazio = sem meta para esse evento
      if (parsed <= 0) {
        showError(`O CPR alvo de "${formatActionTypeLabel(type)}" precisa ser maior que zero.`);
        return;
      }
      built[type] = parsed;
    }
    const targetPayload = Object.keys(built).length > 0 ? built : null;

    // As duas chaves vão sempre no payload: `null` explícito é o que LIMPA o
    // valor. Omitir a chave significaria "não mexer", que é outra coisa.
    const payload = {
      mql_leadscore_min: mqlPayload,
      target_cpr: targetPayload,
    };

    setIsSaving(true);
    try {
      await api.analytics.updatePackJudgment(pack.id, payload);
      updatePack(pack.id, payload as Partial<AdsPack>);
      showSuccess("Configuração do pack salva.");
      onOpenChange(false);
    } catch (err) {
      showError(err as Error);
    } finally {
      setIsSaving(false);
    }
  }, [pack, mqlValue, targets, updatePack, onOpenChange]);

  if (!pack) return null;

  return (
    <AppDialog isOpen={open} onClose={() => onOpenChange(false)} size="lg" title="Configuração do pack">
      <div className="space-y-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-text">Configuração do pack</h2>
          <p className="text-sm text-muted-foreground">
            Define como o pack <span className="font-medium text-text">{pack.name}</span> julga os
            anúncios. Estes critérios pertencem ao pack e acompanham quem tiver acesso a ele.
          </p>
        </header>

        <div className="space-y-6">
          {/* ── Leadscore mínimo para MQL ── */}
          <section className="space-y-2">
            <div>
              <p className="text-sm font-medium text-text">Leadscore mínimo para MQL</p>
              <p className="text-2xs text-muted-foreground">
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
                  <p className="flex items-start gap-2 text-2xs text-warning">
                    <IconAlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    Sem corte definido, MQL e CPMQL ficam indisponíveis nas telas deste pack.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="flex items-start gap-2 text-2xs text-muted-foreground">
                <IconInfoCircle className="mt-0.5 h-3 w-3 shrink-0" />
                Este pack não tem planilha integrada, então não há leadscore para qualificar.
              </p>
            )}
          </section>

          {/* ── CPR alvo por evento ── */}
          <section className="space-y-2">
            <div>
              <p className="text-sm font-medium text-text">CPR alvo por evento</p>
              <p className="text-2xs text-muted-foreground">
                Opcional. Usado pelo plano de ação para comparar o custo real com a sua meta.
              </p>
            </div>

            {conversionTypes.length === 0 ? (
              <p className="flex items-start gap-2 text-2xs text-muted-foreground">
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
        </div>

        <footer className="flex justify-end gap-2 border-t border-border pt-4">
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
