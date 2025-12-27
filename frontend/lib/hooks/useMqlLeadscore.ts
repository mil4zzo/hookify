"use client";

import { useEffect, useCallback, useRef } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useSupabaseAuth } from "./useSupabaseAuth";
import { useMqlLeadscoreStore } from "@/lib/store/mqlLeadscore";

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
 * Usa Zustand store para estado global compartilhado
 * Sincroniza com Supabase e usa localStorage como fallback (via Zustand persist)
 */
export function useMqlLeadscore(): UseMqlLeadscoreReturn {
  const { user, session } = useSupabaseAuth();
  const {
    mqlLeadscoreMin,
    isLoading,
    isSaving,
    error,
    setMqlLeadscoreMin,
    setIsLoading,
    setIsSaving,
    setError,
  } = useMqlLeadscoreStore();

  const hasInitialLoadRef = useRef(false);
  const previousUserIdRef = useRef<string | undefined>(undefined);

  // Carregar do Supabase (localStorage já é gerenciado pelo Zustand persist)
  const loadMqlLeadscoreMin = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Resetar se o usuário mudou
      if (user?.id && previousUserIdRef.current !== user.id) {
        hasInitialLoadRef.current = false;
        previousUserIdRef.current = user.id;
      }

      // Tentar carregar do Supabase (se autenticado)
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
            const { error: insertError } = await supabase
              .from("user_preferences")
              .insert({
                user_id: user.id,
                mql_leadscore_min: DEFAULT_MQL_LEADSCORE_MIN,
              } as any);

            if (insertError) {
              console.warn("Erro ao criar registro de preferências:", insertError);
              // Manter valor do localStorage (já carregado pelo persist)
            } else {
              setMqlLeadscoreMin(DEFAULT_MQL_LEADSCORE_MIN);
            }
          } else {
            console.warn("Erro ao carregar MQL leadscore min do Supabase:", supabaseError);
            // Manter valor do localStorage (já carregado pelo persist)
          }
        } else {
          // Sucesso ao carregar do Supabase
          const value = (data as any)?.mql_leadscore_min;
          const finalValue = value !== null && value !== undefined ? Number(value) : DEFAULT_MQL_LEADSCORE_MIN;
          setMqlLeadscoreMin(finalValue);
        }
      }
      // Se não autenticado, usar valor do localStorage (já carregado pelo persist)
    } catch (err) {
      console.error("Erro ao carregar MQL leadscore min:", err);
      setError("Erro ao carregar configuração");
      // Manter valor do localStorage (já carregado pelo persist)
    } finally {
      setIsLoading(false);
    }
  }, [user, session, setMqlLeadscoreMin, setIsLoading, setError]);

  // Salvar no Supabase e atualizar store (localStorage é gerenciado pelo Zustand persist)
  const saveMqlLeadscoreMin = useCallback(async (value: number) => {
    setIsSaving(true);
    setError(null);

    try {
      // Validar valor
      if (value < 0 || isNaN(value)) {
        throw new Error("O leadscore mínimo deve ser um número >= 0");
      }

      // Atualizar store primeiro (isso notifica todos os componentes imediatamente)
      // O Zustand persist salva automaticamente no localStorage
      setMqlLeadscoreMin(value);

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
          // Não falhar, já atualizou o store
        }
      }
    } catch (err: any) {
      console.error("Erro ao salvar MQL leadscore min:", err);
      setError(err.message || "Erro ao salvar configuração");
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [user, session, setMqlLeadscoreMin, setIsSaving, setError]);

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

