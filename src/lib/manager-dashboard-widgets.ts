/**
 * Manager dashboard widget catalog + localStorage layout (iOS-style add widgets).
 */

export type WidgetTypeId =
  | "kpi_row"
  | "attention"
  | "contract_status_pie"
  | "contract_value_pie"
  | "day_schedule"
  | "wo_trend"
  | "invoice_activity"
  | "expiring_contracts"
  | "open_work_orders"
  | "low_stock"
  | "open_ar"
  | "pending_leave"
  | "urgent_wos"
  | "unscheduled"
  | "dispatch_link";

/** iOS-like size options for gallery + grid span. */
export type WidgetSize = "small" | "medium" | "large";

export type WidgetInstance = {
  /** Unique instance id on the home screen */
  id: string;
  type: WidgetTypeId;
  size: WidgetSize;
  /** Custom height after user resizes the frame (px). */
  heightPx?: number;
};

export type WidgetCatalogEntry = {
  type: WidgetTypeId;
  name: string;
  app: string;
  description: string;
  sizes: WidgetSize[];
  defaultSize: WidgetSize;
  /** Accent for gallery tile */
  accent: string;
};

export const WIDGET_CATALOG: WidgetCatalogEntry[] = [
  {
    type: "kpi_row",
    name: "Key stats",
    app: "Overview",
    description: "Customers, open work, contracts, AR",
    sizes: ["medium", "large"],
    defaultSize: "large",
    accent: "#1f5c42",
  },
  {
    type: "attention",
    name: "Needs attention",
    app: "Overview",
    description: "Live counts that need a manager’s eye",
    sizes: ["medium", "large"],
    defaultSize: "large",
    accent: "#b45309",
  },
  {
    type: "contract_status_pie",
    name: "Contracts by status",
    app: "Contracts",
    description: "Pie of portfolio status mix",
    sizes: ["small", "medium", "large"],
    defaultSize: "medium",
    accent: "#1f5c42",
  },
  {
    type: "contract_value_pie",
    name: "Active value by type",
    app: "Contracts",
    description: "Booked price for Active contracts",
    sizes: ["small", "medium", "large"],
    defaultSize: "medium",
    accent: "#0f766e",
  },
  {
    type: "day_schedule",
    name: "Daily schedule",
    app: "Technician Schedule",
    description: "Day timeline + roster linked to the day calendar",
    sizes: ["medium", "large"],
    defaultSize: "large",
    accent: "#1d4ed8",
  },
  {
    type: "wo_trend",
    name: "Work order trend",
    app: "Work Orders",
    description: "Scheduled work orders over 6 months",
    sizes: ["medium", "large"],
    defaultSize: "medium",
    accent: "#1f5c42",
  },
  {
    type: "invoice_activity",
    name: "Invoice activity",
    app: "Invoice & Cash",
    description: "Invoiced vs collected vs outstanding",
    sizes: ["medium", "large"],
    defaultSize: "medium",
    accent: "#2563eb",
  },
  {
    type: "expiring_contracts",
    name: "Expiring contracts",
    app: "Contracts",
    description: "Active contracts ending within 30 days",
    sizes: ["medium", "large"],
    defaultSize: "medium",
    accent: "#c27803",
  },
  {
    type: "open_work_orders",
    name: "Open work orders",
    app: "Work Orders",
    description: "Action list of open jobs",
    sizes: ["medium", "large"],
    defaultSize: "medium",
    accent: "#be123c",
  },
  {
    type: "low_stock",
    name: "Low stock parts",
    app: "Parts",
    description: "Parts at or below reorder",
    sizes: ["medium", "large"],
    defaultSize: "medium",
    accent: "#b45309",
  },
  {
    type: "open_ar",
    name: "Open AR",
    app: "Invoice & Cash",
    description: "Outstanding receivables total",
    sizes: ["small", "medium"],
    defaultSize: "small",
    accent: "#d97706",
  },
  {
    type: "pending_leave",
    name: "Pending leave",
    app: "Time Off",
    description: "Leave requests waiting on approval",
    sizes: ["small", "medium"],
    defaultSize: "small",
    accent: "#0f766e",
  },
  {
    type: "urgent_wos",
    name: "High / critical",
    app: "Work Orders",
    description: "Count of urgent open jobs",
    sizes: ["small", "medium"],
    defaultSize: "small",
    accent: "#be123c",
  },
  {
    type: "unscheduled",
    name: "Unscheduled open",
    app: "Technician Schedule",
    description: "Open work not yet on a day",
    sizes: ["small", "medium"],
    defaultSize: "small",
    accent: "#475569",
  },
  {
    type: "dispatch_link",
    name: "Dispatch",
    app: "Dispatch",
    description: "Jump to the live dispatch board",
    sizes: ["small", "medium"],
    defaultSize: "medium",
    accent: "#1f5c42",
  },
];

export const WIDGET_STORAGE_KEY = "esm-manager-dashboard-widgets-v1";

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `w-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultWidgets(): WidgetInstance[] {
  return [
    { id: uid(), type: "kpi_row", size: "large" },
    { id: uid(), type: "attention", size: "large" },
    { id: uid(), type: "contract_status_pie", size: "medium" },
    { id: uid(), type: "contract_value_pie", size: "medium" },
    { id: uid(), type: "day_schedule", size: "large" },
    { id: uid(), type: "wo_trend", size: "medium" },
    { id: uid(), type: "invoice_activity", size: "medium" },
    { id: uid(), type: "expiring_contracts", size: "large" },
    { id: uid(), type: "open_work_orders", size: "medium" },
    { id: uid(), type: "low_stock", size: "medium" },
  ];
}

export function catalogEntry(type: WidgetTypeId): WidgetCatalogEntry {
  return WIDGET_CATALOG.find((w) => w.type === type) ?? WIDGET_CATALOG[0];
}

export function loadWidgets(): WidgetInstance[] {
  if (typeof window === "undefined") return defaultWidgets();
  try {
    const raw = localStorage.getItem(WIDGET_STORAGE_KEY);
    if (!raw) return defaultWidgets();
    const parsed = JSON.parse(raw) as WidgetInstance[];
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultWidgets();
    return parsed.filter((w) => w.id && w.type && w.size);
  } catch {
    return defaultWidgets();
  }
}

export function saveWidgets(widgets: WidgetInstance[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(widgets));
}

export function createWidget(type: WidgetTypeId, size?: WidgetSize): WidgetInstance {
  const entry = catalogEntry(type);
  const pick = size && entry.sizes.includes(size) ? size : entry.defaultSize;
  return { id: uid(), type, size: pick };
}

export function sizeColSpan(size: WidgetSize): string {
  if (size === "large") return "col-span-12";
  if (size === "medium") return "col-span-12 md:col-span-6";
  return "col-span-12 sm:col-span-6 lg:col-span-4";
}

export function defaultHeightFor(type: WidgetTypeId, size: WidgetSize): number {
  if (type === "day_schedule") return size === "large" ? 520 : 420;
  if (type === "kpi_row") return size === "large" ? 130 : 160;
  if (type === "attention") return 110;
  if (type.includes("pie") || type === "wo_trend" || type === "invoice_activity") {
    return size === "small" ? 260 : size === "medium" ? 320 : 380;
  }
  if (
    type === "open_ar" ||
    type === "pending_leave" ||
    type === "urgent_wos" ||
    type === "unscheduled" ||
    type === "dispatch_link"
  ) {
    return size === "small" ? 120 : 150;
  }
  return size === "large" ? 320 : 280;
}
