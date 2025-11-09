"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useSupabaseAuth } from "./useSupabaseAuth";
import { ValidationCondition } from "@/components/common/ValidationCriteriaBuilder";

const STORAGE_KEY = "hookify-validation-criteria";

interface UseValidationCriteriaReturn {
  criteria: ValidationCondition[];
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  updateCriteria: (criteria: ValidationCondition[]) => void;
  saveCriteria: (criteria: ValidationCondition[]) => Promise<void>;
}

/**
 * Hook para gerenciar critérios de validação do usuário
 * Sincroniza com Supabase e usa localStorage como fallback
 */
export function useValidationCriteria(): UseValidationCriteriaReturn {
  const { user, session } = useSupabaseAuth();
  const [criteria, setCriteria] = useState<ValidationCondition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasInitialLoadRef = useRef(false);
  const previousUserIdRef = useRef<string | undefined>(undefined);


  // Carregar critérios do Supabase ou localStorage
  const loadCriteria = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Tentar carregar do Supabase primeiro (se autenticado)
      if (user && session) {
        const supabase = getSupabaseClient();
        const { data, error: supabaseError } = await supabase
          .from("user_preferences")
          .select("validation_criteria")
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
                validation_criteria: [],
              });

            if (insertError) {
              console.warn("Erro ao criar registro de preferências:", insertError);
              // Fallback para localStorage
              if (typeof window !== "undefined") {
                const saved = localStorage.getItem(STORAGE_KEY);
                if (saved) {
                  try {
                    const parsed = JSON.parse(saved);
                    setCriteria(Array.isArray(parsed) ? parsed : []);
                  } catch {
                    setCriteria([]);
                  }
                } else {
                  setCriteria([]);
                }
              } else {
                setCriteria([]);
              }
            } else {
              setCriteria([]);
            }
          } else {
            console.warn("Erro ao carregar critérios do Supabase:", supabaseError);
            // Fallback para localStorage
            if (typeof window !== "undefined") {
              const saved = localStorage.getItem(STORAGE_KEY);
              if (saved) {
                try {
                  const parsed = JSON.parse(saved);
                  setCriteria(Array.isArray(parsed) ? parsed : []);
                } catch {
                  setCriteria([]);
                }
              } else {
                setCriteria([]);
              }
            } else {
              setCriteria([]);
            }
          }
        } else {
          // Sucesso ao carregar do Supabase
          const loadedCriteria = (data?.validation_criteria as ValidationCondition[]) || [];
          setCriteria(loadedCriteria);
          // Sincronizar com localStorage como backup
          if (typeof window !== "undefined") {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(loadedCriteria));
          }
        }
      } else {
        // Não autenticado, usar apenas localStorage
        if (typeof window !== "undefined") {
          const saved = localStorage.getItem(STORAGE_KEY);
          if (saved) {
            try {
              const parsed = JSON.parse(saved);
              setCriteria(Array.isArray(parsed) ? parsed : []);
            } catch {
              setCriteria([]);
            }
          } else {
            setCriteria([]);
          }
        } else {
          setCriteria([]);
        }
      }
    } catch (err) {
      console.error("Erro ao carregar critérios:", err);
      setError("Erro ao carregar critérios de validação");
      if (typeof window !== "undefined") {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            setCriteria(Array.isArray(parsed) ? parsed : []);
          } catch {
            setCriteria([]);
          }
        } else {
          setCriteria([]);
        }
      } else {
        setCriteria([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [user, session]);


  // Salvar critérios no Supabase
  const saveToSupabase = useCallback(
    async (criteriaToSave: ValidationCondition[]) => {
      if (!user || !session) {
        // Se não autenticado, salvar apenas no localStorage
        if (typeof window !== "undefined") {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(criteriaToSave));
        }
        return;
      }

      setIsSaving(true);
      setError(null);

      try {
        const supabase = getSupabaseClient();
        
        // Usar upsert para criar ou atualizar
        const { error: upsertError } = await supabase
          .from("user_preferences")
          .upsert(
            {
              user_id: user.id,
              validation_criteria: criteriaToSave,
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: "user_id",
            }
          );

        if (upsertError) {
          throw upsertError;
        }

        // Também salvar no localStorage como backup
        if (typeof window !== "undefined") {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(criteriaToSave));
        }
      } catch (err: any) {
        console.error("Erro ao salvar critérios no Supabase:", err);
        setError("Erro ao salvar critérios de validação");
        
        // Fallback: salvar no localStorage mesmo em caso de erro
        if (typeof window !== "undefined") {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(criteriaToSave));
        }
      } finally {
        setIsSaving(false);
      }
    },
    [user, session]
  );

  // Função para atualizar critérios (apenas estado local, sem salvar)
  const updateCriteria = useCallback((newCriteria: ValidationCondition[]) => {
    setCriteria(newCriteria);
  }, []);

  // Função para salvar critérios no Supabase
  const saveCriteria = useCallback(
    async (criteriaToSave: ValidationCondition[]) => {
      setIsSaving(true);
      setError(null);

      try {
        // Atualizar estado local
        setCriteria(criteriaToSave);

        // Salvar no localStorage imediatamente
        if (typeof window !== "undefined") {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(criteriaToSave));
        }

        // Salvar no Supabase
        await saveToSupabase(criteriaToSave);
      } catch (err) {
        console.error("Erro ao salvar critérios:", err);
        setError("Erro ao salvar critérios de validação");
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [saveToSupabase]
  );

  // Carregar critérios na inicialização e quando o usuário mudar
  useEffect(() => {
    const currentUserId = user?.id;
    const previousUserId = previousUserIdRef.current;

    // Primeira carga ou mudança de usuário
    if (!hasInitialLoadRef.current || currentUserId !== previousUserId) {
      hasInitialLoadRef.current = true;
      previousUserIdRef.current = currentUserId;

      if (currentUserId && session) {
        // Usuário autenticado, carregar do Supabase
        loadCriteria();
      } else {
        // Não autenticado, carregar do localStorage
        setIsLoading(true);
        if (typeof window !== "undefined") {
          const saved = localStorage.getItem(STORAGE_KEY);
          if (saved) {
            try {
              const parsed = JSON.parse(saved);
              setCriteria(Array.isArray(parsed) ? parsed : []);
            } catch {
              setCriteria([]);
            }
          } else {
            setCriteria([]);
          }
        } else {
          setCriteria([]);
        }
        setIsLoading(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, session]);


  return {
    criteria,
    isLoading,
    isSaving,
    error,
    updateCriteria,
    saveCriteria,
  };
}

