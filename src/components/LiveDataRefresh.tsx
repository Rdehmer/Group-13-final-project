"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Keep server-rendered dashboards in sync across roles/sessions.
 * Admin and manager both read the same Supabase rows; this refreshes
 * RSC data when the tab becomes visible again and on a short poll.
 */
export function LiveDataRefresh({
  intervalMs = 40_000,
  enabled = true,
}: {
  intervalMs?: number;
  enabled?: boolean;
}) {
  const router = useRouter();
  const cooling = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    function refresh() {
      if (cooling.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      cooling.current = true;
      router.refresh();
      window.setTimeout(() => {
        cooling.current = false;
      }, 2_000);
    }

    function onVisible() {
      if (document.visibilityState === "visible") refresh();
    }

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(refresh, intervalMs);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(id);
    };
  }, [router, intervalMs, enabled]);

  return null;
}

/**
 * Re-run a client data loader when the user returns to the tab.
 * Use on list pages that keep local state (work orders, parts, day schedule).
 */
export function useLiveReload(reload: () => void | Promise<void>, intervalMs = 45_000) {
  const cooling = useRef(false);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    function run() {
      if (cooling.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      cooling.current = true;
      void Promise.resolve(reloadRef.current()).finally(() => {
        window.setTimeout(() => {
          cooling.current = false;
        }, 1_500);
      });
    }

    function onVisible() {
      if (document.visibilityState === "visible") run();
    }

    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(run, intervalMs);
    return () => {
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(id);
    };
  }, [intervalMs]);
}
