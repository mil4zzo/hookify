"use client";

import { Button } from "@/components/ui/button";
import { IconChevronLeft, IconLoader2 } from "@tabler/icons-react";
import { SpreadsheetCombobox } from "../../SpreadsheetCombobox";
import { WorksheetCombobox } from "../../WorksheetCombobox";
import { cn } from "@/lib/utils/cn";

interface SelectSheetStepProps {
  selectedSpreadsheetId: string;
  selectedSpreadsheetName?: string;
  worksheetTitle: string;
  selectedConnectionId?: string;
  isLoadingColumns: boolean;
  isActive?: boolean;
  onSpreadsheetChange: (value: string) => void;
  onSpreadsheetNameChange?: (name: string) => void;
  onWorksheetChange: (value: string) => void;
  onBack: () => void;
  onNext: () => void;
  canLoadColumns: boolean;
}

export function SelectSheetStep({ selectedSpreadsheetId, selectedSpreadsheetName, worksheetTitle, selectedConnectionId, isLoadingColumns, isActive = true, onSpreadsheetChange, onSpreadsheetNameChange, onWorksheetChange, onBack, onNext, canLoadColumns }: SelectSheetStepProps) {
  return (
    <section className={cn("space-y-4")}>
      <h3 className="font-semibold text-lg flex items-center gap-2">Selecionar planilha e aba</h3>

      <div className="space-y-3">
        <div className="space-y-2">
          <SpreadsheetCombobox value={selectedSpreadsheetId} valueLabel={selectedSpreadsheetName} onValueChange={onSpreadsheetChange} onValueLabelChange={onSpreadsheetNameChange} placeholder="Selecione uma planilha..." connectionId={selectedConnectionId} disabled={!selectedConnectionId} active={isActive} />
        </div>

        <div className="space-y-2">
          <WorksheetCombobox spreadsheetId={selectedSpreadsheetId} value={worksheetTitle} onValueChange={onWorksheetChange} placeholder="Selecione uma aba..." disabled={!selectedSpreadsheetId} connectionId={selectedConnectionId} active={isActive} />
        </div>
      </div>

      {/* Ações do Step 2 */}
      <div className="space-y-3 pt-4 border-t border-border">
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onBack} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <IconChevronLeft className="w-4 h-4" />
            Voltar
          </Button>
          <Button type="button" variant="default" onClick={onNext} disabled={!canLoadColumns || isLoadingColumns}>
            {isLoadingColumns ? (
              <span className="flex items-center gap-2">
                <IconLoader2 className="w-4 h-4 animate-spin" />
                Carregando...
              </span>
            ) : (
              "Avançar"
            )}
          </Button>
        </div>
      </div>
    </section>
  );
}
