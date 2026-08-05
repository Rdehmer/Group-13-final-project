"use client";

import { StatusBadge, statusTone } from "@/components/ui";
import type { Equipment } from "@/lib/types";

const STATUS_OPTIONS: Equipment["operating_status"][] = [
  "Operational",
  "Needs Service",
  "Out of Service",
  "Retired",
];

/**
 * This business faces delayed equipment status updates risk.
 * Our app reduces the risk by letting managers change status quickly from the list.
 */
export function StatusHoverEditor({
  value,
  disabled,
  onChange,
}: {
  value: Equipment["operating_status"];
  disabled?: boolean;
  onChange: (next: Equipment["operating_status"]) => void;
}) {
  if (disabled) {
    return (
      <StatusBadge label={value} tone={statusTone(value)} className="max-w-[9rem]" />
    );
  }

  return (
    <div className="dropdown dropdown-hover dropdown-end">
      <div
        tabIndex={0}
        role="button"
        className="cursor-pointer rounded-btn outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`Change status, currently ${value}`}
      >
        <StatusBadge label={value} tone={statusTone(value)} className="max-w-[9rem]" />
      </div>
      <ul
        tabIndex={0}
        className="dropdown-content menu z-20 w-48 rounded-box border border-base-300 bg-base-100 p-2 shadow"
      >
        {STATUS_OPTIONS.map((option) => (
          <li key={option}>
            <button
              type="button"
              className={option === value ? "active" : ""}
              onClick={() => onChange(option)}
            >
              <StatusBadge label={option} tone={statusTone(option)} className="max-w-full" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
