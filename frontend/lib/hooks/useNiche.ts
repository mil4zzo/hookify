"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useSupabaseAuth } from "./useSupabaseAuth";
import { useSettingsStore } from "@/lib/store/settings";

const DEFAULT_NICHE = "";

interface UseNicheReturn {
  niche: string;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  updateNiche: (value: string) => void;
  saveNiche: (value: string) => Promise<void>;
}

/**
 * Hook para gerenciar a configuração de nicho do usuário
 * Sincroniza com Supabase e usa localStorage/store Zustand como fallback em caso de erro
 * 
 * @note Assume que o usuário sempre está autenticado (rotas protegidas por middleware)
 */
export function useNiche(): UseNicheReturn {
  const { user } = useSupabaseAuth();
  const { settings, setNiche: setNicheStore } = useSettingsStore();
  const [niche, setNiche] = useState<string>(settings.niche || DEFAULT_NICHE);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasInitialLoadRef = useRef(false);
  const previousUserIdRef = useRef<string | undefined>(undefined);

  // Carregar do Supabase (usuário sempre autenticado nas páginas do app)
  const loadNiche = useCallback(async () => {
    if (!user?.id) {
      // Se por algum motivo não houver user, usar store como fallback
      const fallbackNiche = settings.niche || DEFAULT_NICHE;
      setNiche(fallbackNiche);
      setNicheStore(fallbackNiche);
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
        .select("niche")
        .eq("user_id", user.id)
        .single();

      if (supabaseError) {
        // Se não encontrar registro, criar um novo
        if (supabaseError.code === "PGRST116") {
          // Registro não existe, criar com valor do store ou padrão
          const defaultNiche = settings.niche || DEFAULT_NICHE;
          const { error: upsertError } = await supabase
            .from("user_preferences")
            .upsert({
              user_id: user.id,
              niche: defaultNiche,
              updated_at: new Date().toISOString(),
            } as any, {
              onConflict: "user_id"
            });

          if (upsertError) {
            console.warn("Erro ao criar registro de preferências:", upsertError);
            // Fallback para store/localStorage em caso de erro
            const fallbackNiche = settings.niche || DEFAULT_NICHE;
            setNiche(fallbackNiche);
            setNicheStore(fallbackNiche);
          } else {
            setNiche(defaultNiche);
            setNicheStore(defaultNiche);
          }
        } else {
          // Se o campo não existir (erro de coluna), usar store como fallback
          if (supabaseError.code === "42703" || supabaseError.message?.includes("column") || supabaseError.message?.includes("does not exist")) {
            console.warn("Campo 'niche' não existe na tabela user_preferences. Usando store local.");
            const fallbackNiche = settings.niche || DEFAULT_NICHE;
            setNiche(fallbackNiche);
            setNicheStore(fallbackNiche);
          } else {
            console.warn("Erro ao carregar nicho do Supabase:", supabaseError);
            // Fallback para store/localStorage em caso de erro
            const fallbackNiche = settings.niche || DEFAULT_NICHE;
            setNiche(fallbackNiche);
            setNicheStore(fallbackNiche);
          }
        }
      } else {
        // Sucesso ao carregar do Supabase
        const value = (data as any)?.niche;
        // Priorizar nicho do Supabase, mas usar store como fallback se não houver
        const nicheValue = value || settings.niche || DEFAULT_NICHE;
        setNiche(nicheValue);
        setNicheStore(nicheValue);
      }
    } catch (err) {
      console.error("Erro ao carregar nicho:", err);
      setError("Erro ao carregar configuração");
      // Fallback para store/localStorage em caso de erro
      const fallbackNiche = settings.niche || DEFAULT_NICHE;
      setNiche(fallbackNiche);
      setNicheStore(fallbackNiche);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, settings.niche, setNicheStore]);

  // Salvar no Supabase e store/localStorage
  const saveNiche = useCallback(async (value: string) => {
    if (!user?.id) {
      throw new Error("Usuário não autenticado");
    }

    setIsSaving(true);
    setError(null);

    try {
      // Validar valor (aceita string vazia)
      if (typeof value !== "string") {
        throw new Error("O nicho deve ser um texto válido");
      }

      // Salvar no store Zustand primeiro (que já salva no localStorage)
      setNicheStore(value);
      setNiche(value);

      // Salvar no Supabase (usuário sempre autenticado)
      const supabase = getSupabaseClient();
      const { error: upsertError } = await supabase
        .from("user_preferences")
        .upsert({
          user_id: user.id,
          niche: value,
          updated_at: new Date().toISOString(),
        } as any, {
          onConflict: "user_id"
        });

      if (upsertError) {
        // Se o campo não existir, apenas logar e continuar (já salvou no store)
        if (upsertError.code === "42703" || upsertError.message?.includes("column") || upsertError.message?.includes("does not exist")) {
          console.warn("Campo 'niche' não existe na tabela user_preferences. Valor salvo apenas localmente.");
        } else {
          console.warn("Erro ao salvar nicho no Supabase:", upsertError);
          // Não falhar, já salvou no store/localStorage
        }
      }
    } catch (err: any) {
      console.error("Erro ao salvar nicho:", err);
      setError(err.message || "Erro ao salvar configuração");
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [user?.id, setNicheStore]);

  // Carregar na inicialização e quando user/session mudar
  useEffect(() => {
    if (!hasInitialLoadRef.current || (user?.id && previousUserIdRef.current !== user.id)) {
      hasInitialLoadRef.current = true;
      previousUserIdRef.current = user?.id;
      loadNiche();
    }
  }, [loadNiche, user?.id]);

  // Sincronizar com store quando mudar externamente
  useEffect(() => {
    if (settings.niche !== undefined && settings.niche !== niche) {
      setNiche(settings.niche);
    }
  }, [settings.niche]);

  return {
    niche,
    isLoading,
    isSaving,
    error,
    updateNiche: setNiche,
    saveNiche,
  };
}

