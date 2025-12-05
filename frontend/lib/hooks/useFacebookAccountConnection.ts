"use client";

import { useMemo } from "react";
import { useFacebookConnections } from "@/lib/hooks/useFacebookConnections";

export function useFacebookAccountConnection() {
  const connectionsState = useFacebookConnections();
  const { connections } = connectionsState;

  const activeConnections = useMemo(
    () => connections.data?.filter((conn: any) => conn.status === "active") || [],
    [connections.data]
  );

  const expiredConnections = useMemo(
    () =>
      connections.data?.filter(
        (conn: any) => conn.status === "expired" || conn.status === "invalid"
      ) || [],
    [connections.data]
  );

  const hasActiveConnection = !connections.isLoading && activeConnections.length > 0;
  const hasExpiredConnections = !connections.isLoading && expiredConnections.length > 0;

  return {
    ...connectionsState,
    activeConnections,
    expiredConnections,
    hasActiveConnection,
    hasExpiredConnections,
  };
}



