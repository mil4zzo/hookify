"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  AUTH_SESSION_EXPIRED_EVENT,
  invalidateSessionCache,
  setAuthToken,
  setLoggingOut,
} from "@/lib/api/client";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useActiveJobsStore } from "@/lib/store/activeJobs";
import { useSessionStore } from "@/lib/store/session";

export function AuthSessionExpiredHandler() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const handlingRef = useRef(false);

  useEffect(() => {
    const handleSessionExpired = async () => {
      if (handlingRef.current) return;
      handlingRef.current = true;

      setLoggingOut(true);
      invalidateSessionCache();
      setAuthToken(null);
      queryClient.cancelQueries();
      queryClient.clear();
      useActiveJobsStore.getState().clearAll();
      useSessionStore.getState().logout();

      try {
        await getSupabaseClient().auth.signOut({ scope: "local" });
      } catch {
        // The backend already rejected the token; local cleanup is the important part here.
      }

      router.replace("/login?expired=true");
    };

    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);

    return () => {
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, [queryClient, router]);

  return null;
}
