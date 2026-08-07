"use client";

import { useEffect } from "react";

/** Locks the EquipmentIQ theme and clears leftover theme-picker preferences. */
export function ThemeLock() {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "equipmentiq");
    try {
      localStorage.removeItem("esm-theme");
    } catch {
      // ignore
    }
  }, []);

  return null;
}
