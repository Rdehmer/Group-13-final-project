import type { ReactNode } from "react";

const TONE: Record<string, string> = {
  success: "border-transparent bg-[#e6f7f7] text-[#007a7c]",
  warning: "border-transparent bg-[#fff4e8] text-[#b34f00]",
  error: "border-transparent bg-[#fdecea] text-[#b42318]",
  info: "border-transparent bg-[#e8f4f8] text-[#0b7ea4]",
  neutral: "border border-[#dce3ea] bg-[#f2f5f8] text-[#374151]",
  critical: "border-transparent bg-[#fdecea] text-[#b42318]",
  progress: "border-transparent bg-[#fff4e8] text-[#b34f00]",
  white: "border border-[#dce3ea] bg-white text-[#1e2a36]",
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
      className={`inline-flex max-w-full items-center rounded-md px-2 py-0.5 text-[11px] font-semibold leading-tight ${TONE[tone] ?? TONE.neutral} ${className}`.trim()}
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
    <div className="rounded-xl border border-[#dce3ea] bg-white px-8 py-12 text-center shadow-[0_1px_2px_rgba(30,42,54,0.04),0_8px_24px_rgba(30,42,54,0.06)]">
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[#00a3a6]" aria-hidden />
      <h3 className="text-base font-semibold text-[#1e2a36]">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-[#5c6b7a]">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
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
  /** Scroll to this element id after click (works alone or with onClick). */
  scrollTarget,
}: {
  label: string;
  value: string | number;
  hint?: string;
  danger?: boolean;
  onClick?: () => void;
  active?: boolean;
  scrollTarget?: string;
}) {
  const interactive = Boolean(onClick || scrollTarget);
  const className = [
    "stat w-full rounded-xl border border-[#dce3ea] bg-white text-left shadow-[0_1px_2px_rgba(30,42,54,0.04),0_8px_24px_rgba(30,42,54,0.06)]",
    danger ? "border-[#f3c4c0] bg-[#fef3f2]" : "",
    active ? "ring-2 ring-[#00a3a6]/35 border-[#00a3a6]" : "",
    interactive ? "cursor-pointer transition-all hover:-translate-y-px hover:shadow-md" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      <div className="stat-title text-[12px] font-semibold text-[#5c6b7a]">{label}</div>
      <div
        className={`stat-value text-[1.35rem] font-semibold tracking-tight ${
          danger ? "text-[#d64545]" : "text-[#1e2a36]"
        }`}
      >
        {value}
      </div>
      {hint ? <div className="stat-desc text-[12px] text-[#5c6b7a]">{hint}</div> : null}
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        className={className}
        aria-pressed={active}
        onClick={() => {
          onClick?.();
          if (!scrollTarget) return;
          const delay = onClick ? 50 : 0;
          window.setTimeout(() => {
            document
              .getElementById(scrollTarget)
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, delay);
        }}
      >
        {body}
      </button>
    );
  }

  return <div className={className}>{body}</div>;
}
