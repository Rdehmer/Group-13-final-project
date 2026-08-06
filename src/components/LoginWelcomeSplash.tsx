"use client";

import { loadingSubtitleForRole, welcomeGreeting } from "@/lib/login-welcome";
import type { UserRole } from "@/lib/types";
import { EquipmentIQLogo } from "@/components/brand/EquipmentIQLogo";

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
      className={`customer-welcome-splash login-hero fixed inset-0 z-50 flex flex-col items-center justify-center px-6 pt-[7vh] text-primary-content sm:pt-[9vh] ${
        exiting ? "customer-welcome-exit" : ""
      }`}
      role="status"
      aria-live="polite"
      aria-busy={!exiting}
      aria-label={subtitle}
    >
      <div className="customer-welcome-content flex w-full max-w-md flex-col items-center text-center">
        <div className="customer-welcome-brand-block flex flex-col items-center gap-2.5">
          <EquipmentIQLogo variant="splash" onDark />
          <h1 className="customer-welcome-title !text-white text-2xl font-bold sm:text-3xl">{greeting}</h1>
        </div>

        <p className="customer-welcome-subtitle mt-2 text-sm opacity-80 sm:text-base">{subtitle}</p>

        <div className="customer-welcome-progress mt-10 h-1 w-full max-w-xs overflow-hidden rounded-full bg-white/15">
          <div className="customer-welcome-progress-bar h-full rounded-full" />
        </div>
      </div>
    </div>
  );
}
