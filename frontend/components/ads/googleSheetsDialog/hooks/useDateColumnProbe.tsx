"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/endpoints";
import { logger } from "@/lib/utils/logger";
import type { DateColumnProbe } from "@/lib/api/schemas";

/** Espera o usuário parar de trocar de coluna antes de gastar uma leitura no Google. */
const DEBOUNCE_MS = 400;

export interface UseDateColumnProbeResult {
  probe: DateColumnProbe | null;
  isProbing: boolean;
  /** Falha na sondagem não impede importar — some da tela, não vira erro bloqueante. */
  failed: boolean;
}

/**
 * Sonda a coluna de data escolhida: lê SÓ essa coluna e devolve o formato provado
 * pelos dados e a janela real de datas da planilha.
 *
 * Roda no wizard porque é lá que o erro é cometido. Sem isso, formato errado só
 * aparece depois do sync — e, pior, aparece como dado deslocado, não como falha:
 * com o formato trocado os dias 1–12 parseiam e vão para o dia errado em silêncio.
 */
export function useDateColumnProbe(params: {
  spreadsheetId: string;
  worksheetTitle: string;
  columnIndex: number | null;
  connectionId?: string;
  enabled: boolean;
}): UseDateColumnProbeResult {
  const { spreadsheetId, worksheetTitle, columnIndex, connectionId, enabled } = params;
  const [probe, setProbe] = useState<DateColumnProbe | null>(null);
  const [isProbing, setIsProbing] = useState(false);
  const [failed, setFailed] = useState(false);

  // Resposta lenta de uma coluna que o usuário já trocou não pode sobrescrever a
  // atual: cada disparo carimba um id e só o mais recente tem direito de escrever.
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled || !spreadsheetId || !worksheetTitle || columnIndex == null || columnIndex < 0) {
      setProbe(null);
      setFailed(false);
      setIsProbing(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setIsProbing(true);
    setFailed(false);

    const timer = setTimeout(() => {
      api.integrations.google
        .probeDateColumn(spreadsheetId, worksheetTitle, columnIndex, connectionId)
        .then((result) => {
          if (requestIdRef.current !== requestId) return;
          setProbe(result);
          setIsProbing(false);
        })
        .catch((err) => {
          if (requestIdRef.current !== requestId) return;
          logger.warn("Falha ao sondar a coluna de data:", err);
          setProbe(null);
          setFailed(true);
          setIsProbing(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [enabled, spreadsheetId, worksheetTitle, columnIndex, connectionId]);

  return { probe, isProbing, failed };
}
