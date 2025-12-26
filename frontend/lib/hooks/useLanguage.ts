"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useSupabaseAuth } from "./useSupabaseAuth";
import { useSettingsStore } from "@/lib/store/settings";

const DEFAULT_LANGUAGE = "pt-BR";

interface UseLanguageReturn {
  language: string;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  updateLanguage: (value: string) => void;
  saveLanguage: (value: string) => Promise<void>;
}

/**
 * Hook para gerenciar a configuração de idioma do usuário
 * Sincroniza com Supabase e usa localStorage/store Zustand como fallback em caso de erro
 * 
 * @note Assume que o usuário sempre está autenticado (rotas protegidas por middleware)
 */
export function useLanguage(): UseLanguageReturn {
  const { user } = useSupabaseAuth();
  const { settings, setLanguage: setLanguageStore } = useSettingsStore();
  const [language, setLanguage] = useState<string>(settings.language || DEFAULT_LANGUAGE);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasInitialLoadRef = useRef(false);
  const previousUserIdRef = useRef<string | undefined>(undefined);

  // Carregar do Supabase (usuário sempre autenticado nas páginas do app)
  const loadLanguage = useCallback(async () => {
    if (!user?.id) {
      // Se por algum motivo não houver user, usar store como fallback
      const fallbackLanguage = settings.language || DEFAULT_LANGUAGE;
      setLanguage(fallbackLanguage);
      setLanguageStore(fallbackLanguage);
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
        .select("locale")
        .eq("user_id", user.id)
        .single();

      if (supabaseError) {
        // Se não encontrar registro, criar um novo
        if (supabaseError.code === "PGRST116") {
          // Registro não existe, criar com valor do store ou padrão
          const defaultLanguage = settings.language || DEFAULT_LANGUAGE;
          const { error: upsertError } = await supabase
            .from("user_preferences")
            .upsert({
              user_id: user.id,
              locale: defaultLanguage,
              updated_at: new Date().toISOString(),
            } as any, {
              onConflict: "user_id"
            });

          if (upsertError) {
            console.warn("Erro ao criar registro de preferências:", upsertError);
            // Fallback para store/localStorage em caso de erro
            const fallbackLanguage = settings.language || DEFAULT_LANGUAGE;
            setLanguage(fallbackLanguage);
            setLanguageStore(fallbackLanguage);
          } else {
            setLanguage(defaultLanguage);
            setLanguageStore(defaultLanguage);
          }
        } else {
          console.warn("Erro ao carregar idioma do Supabase:", supabaseError);
          // Fallback para store/localStorage em caso de erro
          const fallbackLanguage = settings.language || DEFAULT_LANGUAGE;
          setLanguage(fallbackLanguage);
          setLanguageStore(fallbackLanguage);
        }
      } else {
        // Sucesso ao carregar do Supabase
        const value = (data as any)?.locale;
        // Priorizar idioma do Supabase, mas usar store como fallback se não houver
        const languageValue = value || settings.language || DEFAULT_LANGUAGE;
        setLanguage(languageValue);
        setLanguageStore(languageValue);
      }
    } catch (err) {
      console.error("Erro ao carregar idioma:", err);
      setError("Erro ao carregar configuração");
      // Fallback para store/localStorage em caso de erro
      const fallbackLanguage = settings.language || DEFAULT_LANGUAGE;
      setLanguage(fallbackLanguage);
      setLanguageStore(fallbackLanguage);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id, settings.language, setLanguageStore]);

  // Salvar no Supabase e store/localStorage
  const saveLanguage = useCallback(async (value: string) => {
    if (!user?.id) {
      throw new Error("Usuário não autenticado");
    }

    setIsSaving(true);
    setError(null);

    try {
      // Validar valor
      if (!value || typeof value !== "string") {
        throw new Error("O idioma deve ser um código válido");
      }

      // Validar se é um dos idiomas suportados
      const supportedLanguages = ["pt-BR", "en-US", "es-ES"];
      if (!supportedLanguages.includes(value)) {
        throw new Error("Idioma não suportado");
      }

      // Salvar no store Zustand primeiro (que já salva no localStorage)
      setLanguageStore(value);
      setLanguage(value);

      // Salvar no Supabase (usuário sempre autenticado)
      const supabase = getSupabaseClient();
      const { error: upsertError } = await supabase
        .from("user_preferences")
        .upsert({
          user_id: user.id,
          locale: value,
          updated_at: new Date().toISOString(),
        } as any, {
          onConflict: "user_id"
        });

      if (upsertError) {
        console.warn("Erro ao salvar idioma no Supabase:", upsertError);
        // Não falhar, já salvou no store/localStorage
      }
    } catch (err: any) {
      console.error("Erro ao salvar idioma:", err);
      setError(err.message || "Erro ao salvar configuração");
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [user?.id, setLanguageStore]);

  // Carregar na inicialização e quando user/session mudar
  useEffect(() => {
    if (!hasInitialLoadRef.current || (user?.id && previousUserIdRef.current !== user.id)) {
      hasInitialLoadRef.current = true;
      previousUserIdRef.current = user?.id;
      loadLanguage();
    }
  }, [loadLanguage, user?.id]);

  // Sincronizar com store quando mudar externamente
  useEffect(() => {
    if (settings.language && settings.language !== language) {
      setLanguage(settings.language);
    }
  }, [settings.language]);

  return {
    language,
    isLoading,
    isSaving,
    error,
    updateLanguage: setLanguage,
    saveLanguage,
  };
}

