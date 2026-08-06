"use client";

import { useEffect } from "react";

/** Locks the corporate theme and clears leftover theme-picker preferences. */
export function ThemeLock() {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "corporate");
    try {
      localStorage.removeItem("esm-theme");
    } catch {
      // ignore
    }
  }, []);

  return null;
}
