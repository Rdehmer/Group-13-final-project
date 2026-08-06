"use client";

import { Suspense, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import { TechnicianMyDay } from "@/components/technician/TechnicianMyDay";
import TechnicianSchedulePage from "./TechnicianSchedulePage";

function TechnicianPageInner() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) {
        if (!cancelled) setReady(true);
        return;
      }
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      if (!cancelled) {
        setProfile((data as Profile) ?? null);
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  if (!ready) {
    return (
      <div className="space-y-4 p-2">
        <div className="skeleton h-10 w-48" />
        <div className="skeleton h-40 w-full rounded-2xl" />
        <div className="skeleton h-40 w-full rounded-2xl" />
      </div>
    );
  }

  if (profile?.role === "technician") {
    return <TechnicianMyDay profile={profile} />;
  }

  return <TechnicianSchedulePage />;
}

export default function TechnicianPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-4 p-2">
          <div className="skeleton h-10 w-48" />
          <div className="skeleton h-40 w-full rounded-2xl" />
        </div>
      }
    >
      <TechnicianPageInner />
    </Suspense>
  );
}
