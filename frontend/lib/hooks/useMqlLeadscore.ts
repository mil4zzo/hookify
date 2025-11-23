"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useSupabaseAuth } from "./useSupabaseAuth";

const STORAGE_KEY = "hookify-mql-leadscore-min";
const DEFAULT_MQL_LEADSCORE_MIN = 0;

interface UseMqlLeadscoreReturn {
  mqlLeadscoreMin: number;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  updateMqlLeadscoreMin: (value: number) => void;
  saveMqlLeadscoreMin: (value: number) => Promise<void>;
}

/**
 * Hook para gerenciar a configuração de leadscore mínimo para MQL
 * Sincroniza com Supabase e usa localStorage como fallback
 */
export function useMqlLeadscore(): UseMqlLeadscoreReturn {
  const { user, session } = useSupabaseAuth();
  const [mqlLeadscoreMin, setMqlLeadscoreMin] = useState<number>(DEFAULT_MQL_LEADSCORE_MIN);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasInitialLoadRef = useRef(false);
  const previousUserIdRef = useRef<string | undefined>(undefined);

  // Carregar do Supabase ou localStorage
  const loadMqlLeadscoreMin = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Resetar se o usuário mudou
      if (user?.id && previousUserIdRef.current !== user.id) {
        hasInitialLoadRef.current = false;
        previousUserIdRef.current = user.id;
      }

      // Tentar carregar do Supabase primeiro (se autenticado)
      if (user && session) {
        const supabase = getSupabaseClient();
        const { data, error: supabaseError } = await supabase
          .from("user_preferences")
          .select("mql_leadscore_min")
          .eq("user_id", user.id)
          .single();

        if (supabaseError) {
          // Se não encontrar registro, criar um novo
          if (supabaseError.code === "PGRST116") {
            // Registro não existe, criar com valores padrão
            const { error: insertError } = await supabase
              .from("user_preferences")
              .insert({
                user_id: user.id,
                mql_leadscore_min: DEFAULT_MQL_LEADSCORE_MIN,
              } as any);

            if (insertError) {
              console.warn("Erro ao criar registro de preferências:", insertError);
              // Fallback para localStorage
              if (typeof window !== "undefined") {
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved) {
                  try {
                    const parsed = parseFloat(saved);
                    setMqlLeadscoreMin(isNaN(parsed) ? DEFAULT_MQL_LEADSCORE_MIN : parsed);
                  } catch {
                    setMqlLeadscoreMin(DEFAULT_MQL_LEADSCORE_MIN);
                  }
                } else {
                  setMqlLeadscoreMin(DEFAULT_MQL_LEADSCORE_MIN);
                }
              } else {
                setMqlLeadscoreMin(DEFAULT_MQL_LEADSCORE_MIN);
              }
            } else {
              setMqlLeadscoreMin(DEFAULT_MQL_LEADSCORE_MIN);
            }
          } else {
            console.warn("Erro ao carregar MQL leadscore min do Supabase:", supabaseError);
            // Fallback para localStorage
            if (typeof window !== "undefined") {
              const saved = localStorage.getItem(STORAGE_KEY);
              if (saved) {
                try {
                  const parsed = parseFloat(saved);
                  setMqlLeadscoreMin(isNaN(parsed) ? DEFAULT_MQL_LEADSCORE_MIN : parsed);
                } catch {
                  setMqlLeadscoreMin(DEFAULT_MQL_LEADSCORE_MIN);
                }
              } else {
                setMqlLeadscoreMin(DEFAULT_MQL_LEADSCORE_MIN);
              }
            } else {
              setMqlLeadscoreMin(DEFAULT_MQL_LEADSCORE_MIN);
            }
          }
        } else {
          // Sucesso ao carregar do Supabase
          const value = (data as any)?.mql_leadscore_min;
          setMqlLeadscoreMin(value !== null && value !== undefined ? Number(value) : DEFAULT_MQL_LEADSCORE_MIN);
          
          // Sincronizar com localStorage
          if (typeof window !== "undefined") {
            localStorage.setItem(STORAGE_KEY, String(value !== null && value !== undefined ? Number(value) : DEFAULT_MQL_LEADSCORE_MIN));
          }
        }
      } else {
        // Fallback para localStorage se não autenticado
        if (typeof window !== "undefined") {
          const saved = localStorage.getItem(STORAGE_KEY);
          if (saved) {
            try {
              const parsed = parseFloat(saved);
              setMqlLeadscoreMin(isNaN(parsed) ? DEFAULT_MQL_LEADSCORE_MIN : parsed);
            } catch {
              setMqlLeadscoreMin(DEFAULT_MQL_LEADSCORE_MIN);
            }
          } else {
            setMqlLeadscoreMin(DEFAULT_MQL_LEADSCORE_MIN);
          }
        } else {
          setMqlLeadscoreMin(DEFAULT_MQL_LEADSCORE_MIN);
        }
      }
    } catch (err) {
      console.error("Erro ao carregar MQL leadscore min:", err);
      setError("Erro ao carregar configuração");
      // Fallback para localStorage
      if (typeof window !== "undefined") {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          try {
            const parsed = parseFloat(saved);
            setMqlLeadscoreMin(isNaN(parsed) ? DEFAULT_MQL_LEADSCORE_MIN : parsed);
          } catch {
            setMqlLeadscoreMin(DEFAULT_MQL_LEADSCORE_MIN);
          }
        } else {
          setMqlLeadscoreMin(DEFAULT_MQL_LEADSCORE_MIN);
        }
      } else {
        setMqlLeadscoreMin(DEFAULT_MQL_LEADSCORE_MIN);
      }
    } finally {
      setIsLoading(false);
    }
  }, [user, session]);

  // Salvar no Supabase e localStorage
  const saveMqlLeadscoreMin = useCallback(async (value: number) => {
    setIsSaving(true);
    setError(null);

    try {
      // Validar valor
      if (value < 0 || isNaN(value)) {
        throw new Error("O leadscore mínimo deve ser um número >= 0");
      }

      // Salvar no localStorage primeiro (fallback)
      if (typeof window !== "undefined") {
        localStorage.setItem(STORAGE_KEY, value.toString());
      }

      // Salvar no Supabase se autenticado
      if (user && session) {
        const supabase = getSupabaseClient();
        const { error: upsertError } = await supabase
          .from("user_preferences")
          .upsert({
            user_id: user.id,
            mql_leadscore_min: value,
            updated_at: new Date().toISOString(),
          } as any, {
            onConflict: "user_id"
          });

        if (upsertError) {
          console.warn("Erro ao salvar MQL leadscore min no Supabase:", upsertError);
          // Não falhar, já salvou no localStorage
        }
      }

      setMqlLeadscoreMin(value);
    } catch (err: any) {
      console.error("Erro ao salvar MQL leadscore min:", err);
      setError(err.message || "Erro ao salvar configuração");
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [user, session]);

  // Carregar na inicialização e quando user/session mudar
  useEffect(() => {
    if (!hasInitialLoadRef.current || (user?.id && previousUserIdRef.current !== user.id)) {
      hasInitialLoadRef.current = true;
      previousUserIdRef.current = user?.id;
      loadMqlLeadscoreMin();
    }
  }, [loadMqlLeadscoreMin, user?.id]);

  return {
    mqlLeadscoreMin,
    isLoading,
    isSaving,
    error,
    updateMqlLeadscoreMin: setMqlLeadscoreMin,
    saveMqlLeadscoreMin,
  };
}

