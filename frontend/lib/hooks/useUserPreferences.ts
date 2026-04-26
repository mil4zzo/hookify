"use client";

import { useCallback, useEffect } from "react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useSupabaseAuth } from "./useSupabaseAuth";
import { useSettingsStore } from "@/lib/store/settings";
import { useMqlLeadscoreStore } from "@/lib/store/mqlLeadscore";
import {
  DEFAULT_CURRENCY,
  DEFAULT_LANGUAGE,
  DEFAULT_MQL_LEADSCORE_MIN,
  DEFAULT_NICHE,
  UserPreferencesValues,
  useUserPreferencesStore,
} from "@/lib/store/userPreferences";
import type { ValidationCondition } from "@/components/common/ValidationCriteriaBuilder";
import { logger } from "@/lib/utils/logger";

const VALIDATION_STORAGE_KEY = "hookify-validation-criteria";
const USER_PREFERENCES_COLUMNS = "locale,currency,niche,validation_criteria,mql_leadscore_min";

type DbUserPreferences = {
  locale?: string | null;
  currency?: string | null;
  niche?: string | null;
  validation_criteria?: ValidationCondition[] | null;
  mql_leadscore_min?: number | string | null;
};

type InFlightLoad = {
  userId: string;
  promise: Promise<void>;
};

let inFlightLoad: InFlightLoad | null = null;

function loadValidationCriteriaFromStorage(): ValidationCondition[] {
  if (typeof window === "undefined") return [];

  const saved = localStorage.getItem(VALIDATION_STORAGE_KEY);
  if (!saved) return [];

  try {
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveValidationCriteriaToStorage(criteria: ValidationCondition[]) {
  if (typeof window !== "undefined") {
    localStorage.setItem(VALIDATION_STORAGE_KEY, JSON.stringify(criteria));
  }
}

function normalizePreferences(data: DbUserPreferences | null, fallbackSettings: { language?: string; currency?: string; niche?: string }): UserPreferencesValues {
  const storageCriteria = loadValidationCriteriaFromStorage();
  const mqlValue = data?.mql_leadscore_min;

  return {
    language: data?.locale || fallbackSettings.language || DEFAULT_LANGUAGE,
    currency: data?.currency || fallbackSettings.currency || DEFAULT_CURRENCY,
    niche: data?.niche || fallbackSettings.niche || DEFAULT_NICHE,
    validationCriteria: Array.isArray(data?.validation_criteria) ? data.validation_criteria : storageCriteria,
    mqlLeadscoreMin: mqlValue !== null && mqlValue !== undefined ? Number(mqlValue) : DEFAULT_MQL_LEADSCORE_MIN,
  };
}

function toDbPatch(values: Partial<UserPreferencesValues>) {
  const patch: Record<string, unknown> = {};

  if (values.language !== undefined) patch.locale = values.language;
  if (values.currency !== undefined) patch.currency = values.currency;
  if (values.niche !== undefined) patch.niche = values.niche;
  if (values.validationCriteria !== undefined) patch.validation_criteria = values.validationCriteria;
  if (values.mqlLeadscoreMin !== undefined) patch.mql_leadscore_min = values.mqlLeadscoreMin;

  return patch;
}

async function ensureUserPreferencesLoaded(userId: string, fallbackSettings: { language?: string; currency?: string; niche?: string }) {
  const state = useUserPreferencesStore.getState();
  if (state.hasLoaded && state.loadedUserId === userId) return;
  if (inFlightLoad?.userId === userId) return inFlightLoad.promise;

  const promise = (async () => {
    const store = useUserPreferencesStore.getState();
    store.setIsLoading(true);
    store.setError(null);

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from("user_preferences")
        .select(USER_PREFERENCES_COLUMNS)
        .eq("user_id", userId)
        .maybeSingle();

      if (error) {
        logger.warn("Erro ao carregar preferências do Supabase:", error);
        const fallback = normalizePreferences(null, fallbackSettings);
        useUserPreferencesStore.getState().setPreferences(fallback, userId);
        saveValidationCriteriaToStorage(fallback.validationCriteria);
        return;
      }

      const preferences = normalizePreferences((data as DbUserPreferences | null) ?? null, fallbackSettings);

      if (!data) {
        const { error: upsertError } = await supabase
          .from("user_preferences")
          .upsert(
            {
              user_id: userId,
              locale: preferences.language,
              currency: preferences.currency,
              niche: preferences.niche,
              validation_criteria: preferences.validationCriteria,
              mql_leadscore_min: preferences.mqlLeadscoreMin,
              updated_at: new Date().toISOString(),
            } as any,
            { onConflict: "user_id" }
          );

        if (upsertError) {
          logger.warn("Erro ao criar registro de preferências:", upsertError);
        }
      }

      useUserPreferencesStore.getState().setPreferences(preferences, userId);
      saveValidationCriteriaToStorage(preferences.validationCriteria);
    } catch (err) {
      logger.error("Erro ao carregar preferências:", err);
      useUserPreferencesStore.getState().setError("Erro ao carregar configuração");
      const fallback = normalizePreferences(null, fallbackSettings);
      useUserPreferencesStore.getState().setPreferences(fallback, userId);
    } finally {
      useUserPreferencesStore.getState().setIsLoading(false);
      inFlightLoad = null;
    }
  })();

  inFlightLoad = { userId, promise };
  return promise;
}

export function useUserPreferences() {
  const { user, session, isLoading: isAuthLoading } = useSupabaseAuth();
  const preferences = useUserPreferencesStore();
  const { settings, updateSettings } = useSettingsStore();
  const setMqlLeadscoreMin = useMqlLeadscoreStore((state) => state.setMqlLeadscoreMin);

  useEffect(() => {
    const fallbackSettings = {
      language: settings.language,
      currency: settings.currency,
      niche: settings.niche,
    };

    if (isAuthLoading) return;

    if (!user?.id || !session) {
      const currentPreferences = useUserPreferencesStore.getState();
      if (!currentPreferences.loadedUserId) {
        currentPreferences.setPreferences(
          {
            language: fallbackSettings.language || DEFAULT_LANGUAGE,
            currency: fallbackSettings.currency || DEFAULT_CURRENCY,
            niche: fallbackSettings.niche || DEFAULT_NICHE,
            validationCriteria: loadValidationCriteriaFromStorage(),
            mqlLeadscoreMin: useMqlLeadscoreStore.getState().mqlLeadscoreMin || DEFAULT_MQL_LEADSCORE_MIN,
          },
          null
        );
      }
      return;
    }

    ensureUserPreferencesLoaded(user.id, fallbackSettings);
  }, [user?.id, Boolean(session), isAuthLoading, settings.language, settings.currency, settings.niche]);

  useEffect(() => {
    if (!preferences.hasLoaded) return;

    const currentSettings = useSettingsStore.getState().settings;
    if (
      currentSettings.language !== preferences.language ||
      currentSettings.currency !== preferences.currency ||
      currentSettings.niche !== preferences.niche
    ) {
      updateSettings({
        language: preferences.language,
        currency: preferences.currency,
        niche: preferences.niche,
      });
    }

    if (useMqlLeadscoreStore.getState().mqlLeadscoreMin !== preferences.mqlLeadscoreMin) {
      setMqlLeadscoreMin(preferences.mqlLeadscoreMin);
    }
    saveValidationCriteriaToStorage(preferences.validationCriteria);
  }, [
    preferences.hasLoaded,
    preferences.language,
    preferences.currency,
    preferences.niche,
    preferences.mqlLeadscoreMin,
    preferences.validationCriteria,
    updateSettings,
    setMqlLeadscoreMin,
  ]);

  const updatePreferences = useCallback((values: Partial<UserPreferencesValues>) => {
    useUserPreferencesStore.getState().setPreferences(values);
    if (values.validationCriteria !== undefined) {
      saveValidationCriteriaToStorage(values.validationCriteria);
    }
  }, []);

  const savePreferences = useCallback(
    async (values: Partial<UserPreferencesValues>) => {
      if (!user?.id || !session) {
        updatePreferences(values);
        return;
      }

      const store = useUserPreferencesStore.getState();
      store.setIsSaving(true);
      store.setError(null);
      updatePreferences(values);

      try {
        const supabase = getSupabaseClient();
        const { error } = await supabase
          .from("user_preferences")
          .upsert(
            {
              user_id: user.id,
              ...toDbPatch(values),
              updated_at: new Date().toISOString(),
            } as any,
            { onConflict: "user_id" }
          );

        if (error) {
          logger.warn("Erro ao salvar preferências no Supabase:", error);
        }
      } catch (err) {
        logger.error("Erro ao salvar preferências:", err);
        useUserPreferencesStore.getState().setError("Erro ao salvar configuração");
        throw err;
      } finally {
        useUserPreferencesStore.getState().setIsSaving(false);
      }
    },
    [session, updatePreferences, user?.id]
  );

  return {
    ...preferences,
    updatePreferences,
    savePreferences,
  };
}
