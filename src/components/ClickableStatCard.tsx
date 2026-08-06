import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";

/**
 * This business faces slow follow-up risk when managers cannot jump from a summary to details.
 * Our app reduces the risk by making Manager dashboard segments keyboard-accessible links.
 */
export function ClickableStatCard({
  label,
  value,
  hint,
  href,
  danger,
  ariaLabel,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href: string;
  danger?: boolean;
  ariaLabel?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel ?? `View details for ${label}`}
      className={`stat w-full rounded-2xl border border-base-300/70 bg-base-100 shadow-none transition-colors duration-150
        cursor-pointer hover:border-primary/35 hover:bg-base-200/40
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-base-100
        ${danger ? "border-error/45 bg-error/5" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="stat-title text-xs font-medium uppercase tracking-wide text-base-content/55">
          {label}
        </div>
        <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-primary/50" aria-hidden />
      </div>
      <div
        className={`stat-value font-display text-2xl font-semibold tracking-tight ${
          danger ? "text-error" : "text-base-content"
        }`}
      >
        {value}
      </div>
      {hint ? <div className="stat-desc text-base-content/55">{hint}</div> : null}
      <div className="stat-desc mt-1 text-sm font-medium text-primary">View details</div>
    </Link>
  );
}

export function ClickableSectionCard({
  href,
  title,
  children,
  ariaLabel,
}: {
  href: string;
  title: string;
  children: ReactNode;
  ariaLabel?: string;
}) {
  return (
    <div className="card rounded-2xl border border-base-300/70 bg-base-100 shadow-none">
      <div className="card-body">
        <div className="flex items-center justify-between gap-3">
          <h2 className="card-title font-display text-base font-semibold">{title}</h2>
          <Link
            href={href}
            aria-label={ariaLabel ?? `View all for ${title}`}
            className="btn btn-ghost btn-sm gap-1 focus-visible:ring-2 focus-visible:ring-primary"
          >
            View all
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}
