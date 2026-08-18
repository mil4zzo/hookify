"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IconLoader2, IconInfoCircle } from "@tabler/icons-react";

import { AppDialog } from "@/components/common/AppDialog";
import { ToggleSwitch } from "@/components/common/ToggleSwitch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api/endpoints";
import { useClientPacks } from "@/lib/hooks/useClientSession";
import { useUserPreferences } from "@/lib/hooks/useUserPreferences";
import { showError, showSuccess } from "@/lib/utils/toast";
import type { AdsPack } from "@/lib/types";
import type { DiagnosticCostMetric } from "@/lib/store/userPreferences";

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

export function PackJudgmentDialog({ pack, open, onOpenChange }: PackJudgmentDialogProps) {
  const { updatePack } = useClientPacks();
  const {
    mqlLeadscoreMin: userMql,
    targetCprByActionType: userTargetCpr,
    diagnosticCostMetric: userCostMetric,
  } = useUserPreferences();

  const [isSaving, setIsSaving] = useState(false);

  // Cada campo tem um toggle "usar padrão da conta". Desligado = override ativo.
  const [overrideMql, setOverrideMql] = useState(false);
  const [mqlValue, setMqlValue] = useState("");

  const [overrideCostMetric, setOverrideCostMetric] = useState(false);
  const [costMetric, setCostMetric] = useState<DiagnosticCostMetric>("cpr");

  const [overrideTarget, setOverrideTarget] = useState(false);
  const [targets, setTargets] = useState<Record<string, string>>({});

  const conversionTypes = useMemo(
    () => (Array.isArray(pack?.conversion_types) ? pack!.conversion_types : []),
    [pack]
  );

  // Reidrata o formulário toda vez que abre — sem isto, reabrir para outro pack
  // mostraria o estado do pack anterior.
  useEffect(() => {
    if (!open || !pack) return;

    const hasMql = pack.mql_leadscore_min !== null && pack.mql_leadscore_min !== undefined;
    setOverrideMql(hasMql);
    setMqlValue(hasMql ? String(pack.mql_leadscore_min) : String(userMql ?? 0));

    const hasMetric = pack.diagnostic_cost_metric === "cpr" || pack.diagnostic_cost_metric === "cpmql";
    setOverrideCostMetric(hasMetric);
    setCostMetric(hasMetric ? (pack.diagnostic_cost_metric as DiagnosticCostMetric) : userCostMetric);

    const packTarget = pack.target_cpr && typeof pack.target_cpr === "object" ? pack.target_cpr : null;
    setOverrideTarget(Boolean(packTarget));
    const seed = packTarget ?? userTargetCpr ?? {};
    const asStrings: Record<string, string> = {};
    for (const type of conversionTypes) {
      const value = (seed as Record<string, number>)[type];
      asStrings[type] = value !== undefined && value !== null ? String(value) : "";
    }
    setTargets(asStrings);
  }, [open, pack, userMql, userCostMetric, userTargetCpr, conversionTypes]);

  const handleSave = useCallback(async () => {
    if (!pack) return;

    let mqlPayload: number | null = null;
    if (overrideMql) {
      const parsed = toNumberOrNull(mqlValue);
      if (parsed === null || parsed < 0) {
        showError("Informe um leadscore mínimo válido (número maior ou igual a zero).");
        return;
      }
      mqlPayload = parsed;
    }

    let targetPayload: Record<string, number> | null = null;
    if (overrideTarget) {
      const built: Record<string, number> = {};
      for (const [type, raw] of Object.entries(targets)) {
        const parsed = toNumberOrNull(raw);
        if (parsed === null) continue; // vazio = sem alvo para esse evento
        if (parsed <= 0) {
          showError(`O CPR alvo de "${formatActionTypeLabel(type)}" precisa ser maior que zero.`);
          return;
        }
        built[type] = parsed;
      }
      targetPayload = Object.keys(built).length > 0 ? built : null;
    }

    // `null` explícito limpa o override no backend (volta a herdar). Por isso as
    // três chaves vão sempre no payload, nunca omitidas.
    const payload = {
      mql_leadscore_min: mqlPayload,
      target_cpr: targetPayload,
      diagnostic_cost_metric: overrideCostMetric ? costMetric : null,
    };

    setIsSaving(true);
    try {
      await api.analytics.updatePackJudgment(pack.id, payload);
      updatePack(pack.id, payload as Partial<AdsPack>);
      showSuccess("Critérios do pack salvos.");
      onOpenChange(false);
    } catch (err) {
      showError(err as Error);
    } finally {
      setIsSaving(false);
    }
  }, [pack, overrideMql, mqlValue, overrideTarget, targets, overrideCostMetric, costMetric, updatePack, onOpenChange]);

  if (!pack) return null;

  return (
    <AppDialog isOpen={open} onClose={() => onOpenChange(false)} size="lg" title="Critérios de julgamento">
      <div className="space-y-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold text-text">Critérios de julgamento</h2>
          <p className="text-sm text-muted-foreground">
            Define como o pack <span className="font-medium text-text">{pack.name}</span> julga os
            anúncios. Cada critério pode herdar o padrão da sua conta ou ter um valor próprio —
            útil quando o pack tem um funil ou evento de conversão diferente dos demais.
          </p>
        </header>

        <div className="space-y-6">
          {/* ── Leadscore mínimo para MQL ── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-text">Leadscore mínimo para MQL</p>
                <p className="text-2xs text-muted-foreground">
                  Padrão da conta: {Number(userMql ?? 0).toFixed(1)}
                </p>
              </div>
              <ToggleSwitch
                id="pack-judgment-mql"
                checked={overrideMql}
                onCheckedChange={setOverrideMql}
                ariaLabel="Usar leadscore mínimo próprio neste pack"
                variant="minimal"
              />
            </div>
            {overrideMql && (
              <Input
                type="number"
                min="0"
                step="0.1"
                size="sm"
                value={mqlValue}
                onChange={(e) => setMqlValue(e.target.value)}
                placeholder="0"
                disabled={isSaving}
              />
            )}
          </section>

          {/* ── Métrica de custo do diagnóstico ── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-text">Métrica de custo do diagnóstico</p>
                <p className="text-2xs text-muted-foreground">
                  Padrão da conta: {userCostMetric === "cpmql" ? "CPMQL" : "CPR"}
                </p>
              </div>
              <ToggleSwitch
                id="pack-judgment-cost-metric"
                checked={overrideCostMetric}
                onCheckedChange={setOverrideCostMetric}
                ariaLabel="Usar métrica de custo própria neste pack"
                variant="minimal"
              />
            </div>
            {overrideCostMetric && (
              <Select value={costMetric} onValueChange={(v) => setCostMetric(v as DiagnosticCostMetric)}>
                <SelectTrigger size="sm" disabled={isSaving}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cpr">CPR — custo por resultado</SelectItem>
                  <SelectItem value="cpmql">CPMQL — custo por MQL</SelectItem>
                </SelectContent>
              </Select>
            )}
          </section>

          {/* ── CPR alvo por evento ── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-text">CPR alvo por evento</p>
                <p className="text-2xs text-muted-foreground">
                  Usado pelo plano de ação para comparar o custo real com a sua meta.
                </p>
              </div>
              <ToggleSwitch
                id="pack-judgment-target-cpr"
                checked={overrideTarget}
                onCheckedChange={setOverrideTarget}
                ariaLabel="Usar CPR alvo próprio neste pack"
                variant="minimal"
                disabled={conversionTypes.length === 0}
              />
            </div>

            {conversionTypes.length === 0 ? (
              <p className="flex items-start gap-2 text-2xs text-muted-foreground">
                <IconInfoCircle className="mt-0.5 h-3 w-3 shrink-0" />
                Este pack ainda não tem eventos de conversão registrados. Atualize o pack para
                que os eventos apareçam aqui.
              </p>
            ) : overrideTarget ? (
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
                      placeholder="sem alvo"
                      disabled={isSaving}
                    />
                  </div>
                ))}
              </div>
            ) : null}
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
              "Salvar critérios"
            )}
          </Button>
        </footer>
      </div>
    </AppDialog>
  );
}
