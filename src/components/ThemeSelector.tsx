"use client";

import { useEffect, useState } from "react";
import { Palette } from "lucide-react";

const THEMES = ["corporate", "business", "nord", "dim", "light", "dark"] as const;

export function ThemeSelector({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<string>("corporate");

  useEffect(() => {
    const saved = localStorage.getItem("esm-theme") || "corporate";
    setTheme(saved);
    document.documentElement.setAttribute("data-theme", saved);
  }, []);

  function onChange(next: string) {
    setTheme(next);
    localStorage.setItem("esm-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }

  return (
    <label className={`flex items-center gap-2 ${compact ? "" : "w-full"}`}>
      {!compact && (
        <span className="flex items-center gap-1 text-sm opacity-80">
          <Palette className="h-4 w-4" /> Theme
        </span>
      )}
      <select
        className="select select-bordered select-sm"
        value={theme}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Theme selector"
      >
        {THEMES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
}
