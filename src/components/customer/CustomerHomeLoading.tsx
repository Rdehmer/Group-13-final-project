"use client";

import { Wrench } from "lucide-react";

export function CustomerHomeLoading() {
  return (
    <div
      className="flex min-h-[40vh] flex-col items-center justify-center gap-4 px-6"
      role="status"
      aria-live="polite"
      aria-label="Loading dashboard"
    >
      <div className="relative flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <span
          className="customer-home-loading-ring absolute inset-0 rounded-full border-2 border-primary/20"
          aria-hidden
        />
        <Wrench className="h-5 w-5 text-primary" aria-hidden />
      </div>
      <p className="text-sm opacity-60">Loading your dashboard…</p>
      <div className="h-0.5 w-32 overflow-hidden rounded-full bg-base-300">
        <div className="customer-home-loading-bar h-full rounded-full bg-primary/70" />
      </div>
    </div>
  );
}
