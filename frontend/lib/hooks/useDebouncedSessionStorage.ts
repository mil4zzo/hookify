"use client";

import { useCallback, useRef, useEffect } from "react";

/**
 * Hook to debounce session storage writes
 * Batches multiple writes within a time window to reduce I/O operations
 */
export function useDebouncedSessionStorage(delay: number = 500) {
  const timeoutRefs = useRef<Map<string, NodeJS.Timeout>>(new Map());

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      timeoutRefs.current.forEach((timeout) => clearTimeout(timeout));
      timeoutRefs.current.clear();
    };
  }, []);

  const setItem = useCallback(
    (key: string, value: string) => {
      if (typeof window === "undefined") return;

      // Clear existing timeout for this key
      const existingTimeout = timeoutRefs.current.get(key);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      // Set new timeout
      const newTimeout = setTimeout(() => {
        try {
          sessionStorage.setItem(key, value);
          timeoutRefs.current.delete(key);
        } catch (e) {
          console.error(`Error saving to sessionStorage (key: ${key}):`, e);
        }
      }, delay);

      timeoutRefs.current.set(key, newTimeout);
    },
    [delay]
  );

  const getItem = useCallback((key: string): string | null => {
    if (typeof window === "undefined") return null;
    try {
      return sessionStorage.getItem(key);
    } catch (e) {
      console.error(`Error reading from sessionStorage (key: ${key}):`, e);
      return null;
    }
  }, []);

  return { setItem, getItem };
}
