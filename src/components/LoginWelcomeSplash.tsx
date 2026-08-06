"use client";

import { Wrench } from "lucide-react";
import { loadingSubtitleForRole, welcomeGreeting } from "@/lib/login-welcome";
import type { UserRole } from "@/lib/types";

type Props = {
  exiting?: boolean;
  displayName?: string | null;
  role: UserRole;
};

export function LoginWelcomeSplash({ exiting = false, displayName, role }: Props) {
  const greeting = welcomeGreeting(displayName, role);
  const subtitle = loadingSubtitleForRole(role);

  return (
    <div
      className={`customer-welcome-splash login-hero fixed inset-0 z-50 flex flex-col items-center justify-center px-6 text-primary-content ${
        exiting ? "customer-welcome-exit" : ""
      }`}
      role="status"
      aria-live="polite"
      aria-busy={!exiting}
      aria-label={subtitle}
    >
      <div className="customer-welcome-content flex w-full max-w-md flex-col items-center text-center">
        <div className="customer-welcome-logo-wrap relative mb-8">
          <span
            className="customer-welcome-ring absolute inset-0 rounded-full border-2 border-white/25"
            aria-hidden
          />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-white/10 backdrop-blur-sm">
            <Wrench className="h-9 w-9" aria-hidden />
          </div>
        </div>

        <p className="customer-welcome-brand text-xs font-semibold uppercase tracking-[0.2em] opacity-80">
          EquipmentIQ
        </p>
        <h1 className="customer-welcome-title mt-2 text-2xl font-bold sm:text-3xl">{greeting}</h1>
        <p className="customer-welcome-subtitle mt-2 text-sm opacity-80 sm:text-base">{subtitle}</p>

        <div className="customer-welcome-progress mt-10 h-1 w-full max-w-xs overflow-hidden rounded-full bg-white/15">
          <div className="customer-welcome-progress-bar h-full rounded-full bg-white/90" />
        </div>
      </div>
    </div>
  );
}
