"use client";

import { useEffect } from "react";

/** Locks the Ridley workshop theme and clears leftover theme-picker preferences. */
export function ThemeLock() {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "ridley");
    try {
      localStorage.removeItem("esm-theme");
    } catch {
      // ignore
    }
  }, []);

  return null;
}
