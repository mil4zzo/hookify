"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useSupabaseAuth } from "./useSupabaseAuth";
import { useSettingsStore } from "@/lib/store/settings";

const DEFAULT_CURRENCY = "BRL";

interface UseCurrencyReturn {
  currency: string;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  updateCurrency: (value: string) => void;
  saveCurrency: (value: string) => Promise<void>;
}

/**
 * Hook para gerenciar a configuração de moeda do usuário
 * Sincroniza com Supabase e usa localStorage/store Zustand como fallback em caso de erro
 * 
 * @note Assume que o usuário sempre está autenticado (rotas protegidas por middleware)
 */
export function useCurrency(): UseCurrencyReturn {
  const { user } = useSupabaseAuth();
  const { settings, setCurrency: setCurrencyStore } = useSettingsStore();
  const [currency, setCurrency] = useState<string>(settings.currency || DEFAULT_CURRENCY);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasInitialLoadRef = useRef(false);
  const previousUserIdRef = useRef<string | undefined>(undefined);

  // Carregar do Supabase (usuário sempre autenticado nas páginas do app)
  const loadCurrency = useCallback(async () => {
    if (!user?.id) {
      // Se por algum motivo não houver user, usar store como fallback
      const fallbackCurrency = settings.currency || DEFAULT_CURRENCY;
      setCurrency(fallbackCurrency);
      setCurrencyStore(fallbackCurrency);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Resetar se o usuário mudou
      if (previousUserIdRef.current !== user.id) {
        hasInitialLoadRef.current = false;
        previousUserIdRef.current = user.id;
      }

      const supabase = getSupabaseClient();
      const { data, error: supabaseError } = await supabase
        .from("user_preferences")
        .select("currency")
        .eq("user_id", user.id)
        .single();

      if (supabaseError) {
        // Se não encontrar registro, criar um novo
        if (supabaseError.code === "PGRST116") {
          // Registro não existe, criar com valor do store ou padrão
          const defaultCurrency = settings.currency || DEFAULT_CURRENCY;
          const { error: upsertError } = await supabase
            .from("user_preferences")
            .upsert({
              user_id: user.id,
              currency: defaultCurrency,
              updated_at: new Date().toISOString(),
            } as any, {
              onConflict: "user_id"
            });

          if (upsertError) {
            console.warn("Erro ao criar registro de preferências:", upsertError);
            // Fallback para store/localStorage em caso de erro
            const fallbackCurrency = settings.currency || DEFAULT_CURRENCY;
            setCurrency(fallbackCurrency);
            setCurrencyStore(fallbackCurrency);
          } else {
            setCurrency(defaultCurrency);
            setCurrencyStore(defaultCurrency);
          }
        } else {
          console.warn("Erro ao carregar moeda do Supabase:", supabaseError);
          // Fallback para store/localStorage em caso de erro
          const fallbackCurrency = settings.currency || DEFAULT_CURRENCY;
          setCurrency(fallbackCurrency);
          setCurrencyStore(fallbackCurrency);
        }
      } else {
        // Sucesso ao carregar do Supabase
        const value = (data as any)?.currency;
        // Priorizar moeda do Supabase, mas usar store como fallback se não houver
        const currencyValue = value || settings.currency || DEFAULT_CURRENCY;
        setCurrency(currencyValue);
        setCurrencyStore(currencyValue);
      }
    } catch (err) {
      console.error("Erro ao carregar moeda:", err);
      setError("Erro ao carregar configuração");
      // Fallback para store/localStorage em caso de erro
      const fallbackCurrency = settings.currency || DEFAULT_CURRENCY;
      setCurrency(fallbackCurrency);
      setCurrencyStore(fallbackCurrency);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, settings.currency, setCurrencyStore]);

  // Salvar no Supabase e store/localStorage
  const saveCurrency = useCallback(async (value: string) => {
    if (!user?.id) {
      throw new Error("Usuário não autenticado");
    }

    setIsSaving(true);
    setError(null);

    try {
      // Validar valor
      if (!value || typeof value !== "string") {
        throw new Error("A moeda deve ser um código válido");
      }

      // Salvar no store Zustand primeiro (que já salva no localStorage)
      setCurrencyStore(value);
      setCurrency(value);

      // Salvar no Supabase (usuário sempre autenticado)
      const supabase = getSupabaseClient();
      const { error: upsertError } = await supabase
        .from("user_preferences")
        .upsert({
          user_id: user.id,
          currency: value,
          updated_at: new Date().toISOString(),
        } as any, {
          onConflict: "user_id"
        });

      if (upsertError) {
        console.warn("Erro ao salvar moeda no Supabase:", upsertError);
        // Não falhar, já salvou no store/localStorage
      }
    } catch (err: any) {
      console.error("Erro ao salvar moeda:", err);
      setError(err.message || "Erro ao salvar configuração");
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [user?.id, setCurrencyStore]);

  // Carregar na inicialização e quando user/session mudar
  useEffect(() => {
    if (!hasInitialLoadRef.current || (user?.id && previousUserIdRef.current !== user.id)) {
      hasInitialLoadRef.current = true;
      previousUserIdRef.current = user?.id;
      loadCurrency();
    }
  }, [loadCurrency, user?.id]);

  // Sincronizar com store quando mudar externamente
  useEffect(() => {
    if (settings.currency && settings.currency !== currency) {
      setCurrency(settings.currency);
    }
  }, [settings.currency]);

  return {
    currency,
    isLoading,
    isSaving,
    error,
    updateCurrency: setCurrency,
    saveCurrency,
  };
}

