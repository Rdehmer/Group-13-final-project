"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { homeForRole } from "@/lib/roles";
import {
  DEMO_PASSWORD,
  DEMO_PERSONAS,
  personaForEmail,
  type DemoPersona,
} from "@/lib/demo-personas";

export function DemoPersonaSwitcher({ currentEmail }: { currentEmail: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = personaForEmail(currentEmail);

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
    <div className="min-w-0 flex-1">
      <label className="sr-only" htmlFor="demo-persona-switcher">
        Demo persona
      </label>
      <select
        id="demo-persona-switcher"
        className="select select-warning select-sm w-full max-w-[11rem] font-semibold"
        disabled={busy}
        value={current?.id ?? ""}
        aria-label="Switch demo persona"
        onChange={(e) => {
          const persona = DEMO_PERSONAS.find((p) => p.id === e.target.value);
          if (persona) void switchTo(persona);
        }}
      >
        {!current && (
          <option value="" disabled>
            Demo view…
          </option>
        )}
        {DEMO_PERSONAS.map((persona) => (
          <option key={persona.id} value={persona.id}>
            {persona.label}
          </option>
        ))}
      </select>
      {busy && <p className="mt-1 text-[10px] opacity-70">Switching…</p>}
      {error && <p className="mt-1 text-[10px] text-error">{error}</p>}
    </div>
  );
}
