import type { ReactNode } from "react";

const TONE: Record<string, string> = {
  success: "badge-success",
  warning: "badge-warning",
  error: "badge-error",
  info: "badge-info",
  neutral: "badge-ghost",
  critical: "badge-error",
};

export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: keyof typeof TONE;
}) {
  return <span className={`badge badge-sm ${TONE[tone]}`}>{label}</span>;
}

export function statusTone(status: string): keyof typeof TONE {
  const s = status.toLowerCase();
  if (["critical", "past due", "disputed", "out of service", "canceled"].some((x) => s.includes(x)))
    return "error";
  if (
    ["emergency", "high", "waiting", "pending", "on hold", "low stock", "overdue", "needs review"].some((x) =>
      s.includes(x),
    )
  )
    return "warning";
  if (["completed", "paid", "active", "approved", "operational", "renewed", "reviewed"].some((x) => s.includes(x)))
    return "success";
  if (["draft", "requested", "scheduled", "sent"].some((x) => s.includes(x))) return "info";
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
    <div className="rounded-box border border-dashed border-base-300 bg-base-200/40 p-10 text-center">
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm opacity-70">{description}</p>
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
    "stat rounded-box bg-base-100 shadow text-left w-full",
    danger ? "border border-error/40" : "",
    active ? "ring-2 ring-primary border-primary" : "",
    onClick ? "cursor-pointer hover:bg-base-200/60 transition-colors" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      <div className="stat-title">{label}</div>
      <div className={`stat-value text-2xl ${danger ? "text-error" : ""}`}>{value}</div>
      {hint ? <div className="stat-desc">{hint}</div> : null}
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
