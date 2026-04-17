import { useState, useEffect } from "react";

/**
 * Netzwerk-Status Hook.
 *
 * Verwendet NICHT navigator.onLine allein (zu unzuverlässig),
 * sondern verifiziert mit einem echten HEAD-Request zu Supabase.
 * Nur wenn der Request fehlschlägt UND das offline-Event gefeuert hat,
 * gilt die App als offline.
 */
export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    let mounted = true;

    const checkConnection = async () => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        if (!supabaseUrl) return;
        const res = await fetch(`${supabaseUrl}/rest/v1/`, {
          method: "HEAD",
          cache: "no-store",
          signal: AbortSignal.timeout(5000),
        });
        if (mounted) setIsOnline(res.ok || res.status < 500);
      } catch {
        if (mounted) setIsOnline(false);
      }
    };

    const handleOnline = () => {
      if (mounted) setIsOnline(true);
      checkConnection();
    };
    const handleOffline = () => {
      // Erst checken bevor wir "offline" anzeigen
      checkConnection();
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      mounted = false;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return isOnline;
}
