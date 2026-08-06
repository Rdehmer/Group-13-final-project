"use client";

export type ColumnSortMode = "text" | "numeric" | "date";

export const SORT_ASC = "__sort_asc";
export const SORT_DESC = "__sort_desc";

type Props = {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  /** text: A–Z / Z–A; numeric: Low→High / High→Low; date: Oldest→Newest / Newest→Oldest */
  sortMode?: ColumnSortMode;
  activeSort?: { direction: "asc" | "desc" } | null;
  className?: string;
};

function sortLabels(mode: ColumnSortMode) {
  if (mode === "numeric") {
    return { asc: "Sort Low → High", desc: "Sort High → Low" };
  }
  if (mode === "date") {
    return { asc: "Sort Oldest → Newest", desc: "Sort Newest → Oldest" };
  }
  return { asc: "Sort A–Z", desc: "Sort Z–A" };
}

/**
 * Per-column filter dropdown with built-in sort options.
 * Used on manager/admin list pages (customers, equipment, contracts).
 */
export function ColumnFilterSelect({
  label,
  value,
  options,
  onChange,
  sortMode = "text",
  activeSort = null,
  className = "select select-bordered select-xs w-full min-w-0",
}: Props) {
  const labels = sortLabels(sortMode);
  const sorting = Boolean(activeSort);
  return (
    <select
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={`Filter or sort ${label}`}
    >
      <option value="">All</option>
      <option value={SORT_ASC}>
        {labels.asc}
        {sorting && activeSort?.direction === "asc" ? " ✓" : ""}
      </option>
      <option value={SORT_DESC}>
        {labels.desc}
        {sorting && activeSort?.direction === "desc" ? " ✓" : ""}
      </option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

/** Returns true if the select value was a sort sentinel (and applies it via callback). */
export function applyColumnSortValue(
  value: string,
  onSort: (direction: "asc" | "desc") => void,
): boolean {
  if (value === SORT_ASC) {
    onSort("asc");
    return true;
  }
  if (value === SORT_DESC) {
    onSort("desc");
    return true;
  }
  return false;
}
