import type { ReactNode } from "react";

const TONE: Record<string, string> = {
  success: "badge-success",
  warning: "badge-warning",
  error: "badge-error",
  info: "badge-info",
  neutral: "badge-ghost border border-base-300",
  critical: "badge-error",
  /** In Progress — amber yellow, distinct from Daisy warning */
  progress: "border-amber-400/80 bg-amber-300 text-amber-950",
  /** Waiting on Parts — white / light */
  white: "border border-base-300 bg-white text-base-content",
};

export function StatusBadge({
  label,
  tone = "neutral",
  className = "",
}: {
  label: string;
  tone?: keyof typeof TONE;
  className?: string;
}) {
  return (
    <span
      className={`badge badge-sm h-auto max-w-full whitespace-normal break-words py-1 text-center font-medium leading-tight ${TONE[tone] ?? TONE.neutral} ${className}`.trim()}
    >
      {label}
    </span>
  );
}

export function statusTone(status: string): keyof typeof TONE {
  const s = status.toLowerCase();
  if (["critical", "past due", "disputed", "out of service", "canceled"].some((x) => s.includes(x)))
    return "error";
  if (s.includes("waiting on parts") || s === "waiting for parts") return "white";
  if (s.includes("in progress")) return "progress";
  if (
    ["emergency", "high", "pending", "on hold", "low stock", "overdue", "needs review"].some((x) =>
      s.includes(x),
    )
  )
    return "warning";
  if (
    ["completed", "paid", "active", "approved", "operational", "renewed", "reviewed", "exported", "posted"].some(
      (x) => s.includes(x),
    )
  )
    return "success";
  if (["draft", "requested", "scheduled", "sent", "open"].some((x) => s.includes(x))) return "info";
  return "neutral";
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-base-300 bg-base-100/80 p-10 text-center">
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-base-content/60">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  danger,
  onClick,
  active,
}: {
  label: string;
  value: string | number;
  hint?: string;
  danger?: boolean;
  onClick?: () => void;
  active?: boolean;
}) {
  const className = [
    "stat rounded-2xl border border-base-300/70 bg-base-100 text-left w-full shadow-none",
    danger ? "border-error/45 bg-error/5" : "",
    active ? "ring-2 ring-primary border-primary" : "",
    onClick ? "cursor-pointer transition-colors hover:bg-base-200/50" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      <div className="stat-title text-xs font-medium uppercase tracking-wide text-base-content/55">
        {label}
      </div>
      <div
        className={`stat-value font-display text-2xl font-semibold tracking-tight ${
          danger ? "text-error" : "text-base-content"
        }`}
      >
        {value}
      </div>
      {hint ? <div className="stat-desc text-base-content/55">{hint}</div> : null}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick} aria-pressed={active}>
        {body}
      </button>
    );
  }

  return <div className={className}>{body}</div>;
}
