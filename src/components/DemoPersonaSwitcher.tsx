"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { homeForRole } from "@/lib/roles";
import {
  DEMO_PASSWORD,
  DEMO_PERSONAS,
  personaForEmail,
  type DemoPersona,
} from "@/lib/demo-personas";

export function DemoPersonaSwitcher({
  currentEmail,
  variant = "light",
}: {
  currentEmail: string;
  variant?: "light" | "dark";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = personaForEmail(currentEmail);
  const dark = variant === "dark";

  async function switchTo(persona: DemoPersona) {
    if (persona.email.toLowerCase() === currentEmail.trim().toLowerCase()) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: persona.email,
        password: DEMO_PASSWORD,
      });
      if (authError) {
        setError(authError.message);
        return;
      }
      router.push(homeForRole(persona.role));
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`min-w-0 w-full ${dark ? "eq-demo-persona" : ""}`}>
      <p className={dark ? "eq-demo-persona-label" : "sr-only"} id="demo-persona-label">
        Demo View
      </p>

      {dark ? (
        <DarkPersonaMenu
          current={current}
          busy={busy}
          onSelect={(persona) => void switchTo(persona)}
        />
      ) : (
        <select
          id="demo-persona-switcher"
          className="select select-warning select-sm w-full max-w-[11rem] font-semibold"
          disabled={busy}
          value={current?.id ?? ""}
          aria-labelledby="demo-persona-label"
          aria-label="Switch demo persona"
          onChange={(e) => {
            const persona = DEMO_PERSONAS.find((p) => p.id === e.target.value);
            if (persona) void switchTo(persona);
          }}
        >
          {!current && (
            <option value="" disabled className="text-slate-900">
              Demo view…
            </option>
          )}
          {DEMO_PERSONAS.map((persona) => (
            <option key={persona.id} value={persona.id} className="text-slate-900">
              {persona.label}
            </option>
          ))}
        </select>
      )}

      {busy && (
        <p className={`mt-1 text-[10px] ${dark ? "text-white/60" : "opacity-70"}`}>Switching…</p>
      )}
      {error && (
        <p className={`mt-1 text-[10px] ${dark ? "text-red-300" : "text-error"}`}>{error}</p>
      )}
    </div>
  );
}

function DarkPersonaMenu({
  current,
  busy,
  onSelect,
}: {
  current: DemoPersona | undefined;
  busy: boolean;
  onSelect: (persona: DemoPersona) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        id="demo-persona-switcher"
        className={`eq-demo-persona-select ${open ? "eq-demo-persona-select-open" : ""}`}
        disabled={busy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby="demo-persona-label"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="truncate">{current?.label ?? "Demo view…"}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-white/45 transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
          aria-hidden
        />
      </button>

      {open ? (
        <ul id={listId} role="listbox" aria-labelledby="demo-persona-label" className="eq-demo-persona-menu">
          {DEMO_PERSONAS.map((persona) => {
            const selected = persona.id === current?.id;
            return (
              <li key={persona.id} role="none">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className="eq-demo-persona-option"
                  onClick={() => {
                    setOpen(false);
                    onSelect(persona);
                  }}
                >
                  <span className="truncate">{persona.label}</span>
                  {selected ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-[#00c2c5]" strokeWidth={2.5} aria-hidden />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
