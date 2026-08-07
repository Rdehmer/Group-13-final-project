/**
 * Administrator dashboard widget catalog + localStorage layout.
 * Separate from the manager board so layouts never fight.
 */

export type AdminWidgetTypeId =
  | "company_kpi"
  | "staff_kpi"
  | "attention"
  | "managers_list"
  | "contract_status_pie"
  | "contract_value_pie"
  | "wo_trend"
  | "invoice_activity"
  | "expiring_contracts"
  | "open_work_orders"
  | "low_stock"
  | "open_ar"
  | "urgent_wos"
  | "cash_pulse"
  | "labor_health"
  | "ar_aging"
  | "portal_pulse"
  | "period_close"
  | "margin_snapshot"
  | "alert_pins"
  | "team_load"
  | "quick_links"
  | "link_users"
  | "link_permissions"
  | "link_settings"
  | "link_billing"
  | "link_payments"
  | "link_batches"
  | "link_period_close"
  | "link_reports"
  | "link_contracts"
  | "link_work_orders";

export type WidgetSize = "small" | "medium" | "large";

export type WidgetInstance = {
  id: string;
  type: AdminWidgetTypeId;
  size: WidgetSize;
  heightPx?: number;
};

export type WidgetCatalogEntry = {
  type: AdminWidgetTypeId;
  name: string;
  app: string;
  description: string;
  sizes: WidgetSize[];
  defaultSize: WidgetSize;
  accent: string;
};

export const ADMIN_WIDGET_CATALOG: WidgetCatalogEntry[] = [
  {
    type: "company_kpi",
    name: "Company snapshot",
    app: "Overview",
    description: "Customers, open work, contracts, AR",
    sizes: ["medium", "large"],
    defaultSize: "large",
    accent: "#1f5c42",
  },
  {
    type: "staff_kpi",
    name: "Staff by role",
    app: "People",
    description: "Managers, techs, billing, active headcount",
    sizes: ["medium", "large"],
    defaultSize: "large",
    accent: "#0f766e",
  },
  {
    type: "attention",
    name: "Needs attention",
    app: "Overview",
    description: "Flags that need an executive decision",
    sizes: ["medium", "large"],
    defaultSize: "large",
    accent: "#b45309",
  },
  {
    type: "managers_list",
    name: "Service managers",
    app: "People",
    description: "Who is running day-to-day operations",
    sizes: ["medium", "large"],
    defaultSize: "medium",
    accent: "#1d4ed8",
  },
  {
    type: "invoice_activity",
    name: "Invoice activity",
    app: "Finance",
    description: "Invoiced vs collected vs outstanding",
    sizes: ["medium", "large"],
    defaultSize: "medium",
    accent: "#2563eb",
  },
  {
    type: "cash_pulse",
    name: "Cash pulse",
    app: "Finance",
    description: "Collected this month vs last month",
    sizes: ["small", "medium"],
    defaultSize: "medium",
    accent: "#047857",
  },
  {
    type: "ar_aging",
    name: "AR aging",
    app: "Finance",
    description: "Current / 30 / 60 / 90+ day buckets",
    sizes: ["medium", "large"],
    defaultSize: "medium",
    accent: "#d97706",
  },
  {
    type: "labor_health",
    name: "Labor & timesheets",
    app: "People",
    description: "Hours, OT exposure, pending approvals",
    sizes: ["medium", "large"],
    defaultSize: "medium",
    accent: "#7c3aed",
  },
  {
    type: "portal_pulse",
    name: "Portal pulse",
    app: "Customers",
    description: "Open jobs, unpaid accounts, contract requests",
    sizes: ["medium", "large"],
    defaultSize: "medium",
    accent: "#0369a1",
  },
  {
    type: "period_close",
    name: "Period-close readiness",
    app: "Finance",
    description: "Open batches and unbatched cash/invoices",
    sizes: ["medium", "large"],
    defaultSize: "medium",
    accent: "#7c3aed",
  },
  {
    type: "margin_snapshot",
    name: "Job margin (MTD)",
    app: "Finance",
    description: "Revenue vs job COGS this month",
    sizes: ["medium", "large"],
    defaultSize: "medium",
    accent: "#15803d",
  },
  {
    type: "alert_pins",
    name: "Pinned alerts",
    app: "Overview",
    description: "Threshold flags you set (AR, critical jobs…)",
    sizes: ["medium", "large"],
    defaultSize: "medium",
    accent: "#b91c1c",
  },
  {
    type: "team_load",
    name: "Team workload",
    app: "Operations",
    description: "Open jobs by tech + unassigned load",
    sizes: ["medium", "large"],
    defaultSize: "large",
    accent: "#1d4ed8",
  },
  {
    type: "open_ar",
    name: "Open AR",
    app: "Finance",
    description: "Outstanding receivables total",
    sizes: ["small", "medium"],
    defaultSize: "small",
    accent: "#d97706",
  },
  {
    type: "contract_status_pie",
    name: "Contracts by status",
    app: "Contracts",
    description: "Portfolio status mix",
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
    type: "expiring_contracts",
    name: "Expiring contracts",
    app: "Contracts",
    description: "Active contracts ending within 30 days",
    sizes: ["medium", "large"],
    defaultSize: "medium",
    accent: "#c27803",
  },
  {
    type: "wo_trend",
    name: "Work order trend",
    app: "Operations",
    description: "Scheduled work orders over 6 months",
    sizes: ["medium", "large"],
    defaultSize: "medium",
    accent: "#1f5c42",
  },
  {
    type: "open_work_orders",
    name: "Open work orders",
    app: "Operations",
    description: "Action list of open jobs",
    sizes: ["medium", "large"],
    defaultSize: "medium",
    accent: "#be123c",
  },
  {
    type: "urgent_wos",
    name: "High / critical",
    app: "Operations",
    description: "Count of urgent open jobs",
    sizes: ["small", "medium"],
    defaultSize: "small",
    accent: "#be123c",
  },
  {
    type: "low_stock",
    name: "Low stock parts",
    app: "Operations",
    description: "Parts at or below reorder",
    sizes: ["medium", "large"],
    defaultSize: "medium",
    accent: "#b45309",
  },
  {
    type: "quick_links",
    name: "Admin shortcuts",
    app: "Navigation",
    description: "Jump tiles to main admin areas",
    sizes: ["medium", "large"],
    defaultSize: "large",
    accent: "#334155",
  },
  {
    type: "link_users",
    name: "Users",
    app: "People",
    description: "Open the user directory",
    sizes: ["small", "medium"],
    defaultSize: "small",
    accent: "#1d4ed8",
  },
  {
    type: "link_permissions",
    name: "Permissions & rates",
    app: "People",
    description: "Employee module access",
    sizes: ["small", "medium"],
    defaultSize: "small",
    accent: "#0f766e",
  },
  {
    type: "link_settings",
    name: "Company settings",
    app: "Company",
    description: "Tax, OT, system defaults",
    sizes: ["small", "medium"],
    defaultSize: "small",
    accent: "#475569",
  },
  {
    type: "link_billing",
    name: "Billing",
    app: "Finance",
    description: "Invoice queue",
    sizes: ["small", "medium"],
    defaultSize: "small",
    accent: "#2563eb",
  },
  {
    type: "link_payments",
    name: "Payments",
    app: "Finance",
    description: "Cash collections",
    sizes: ["small", "medium"],
    defaultSize: "small",
    accent: "#047857",
  },
  {
    type: "link_batches",
    name: "Batches",
    app: "Finance",
    description: "Posting batches",
    sizes: ["small", "medium"],
    defaultSize: "small",
    accent: "#6366f1",
  },
  {
    type: "link_period_close",
    name: "Period close",
    app: "Finance",
    description: "Close accounting periods",
    sizes: ["small", "medium"],
    defaultSize: "small",
    accent: "#7c3aed",
  },
  {
    type: "link_reports",
    name: "Reports",
    app: "Finance",
    description: "Executive and GAAP reports",
    sizes: ["small", "medium"],
    defaultSize: "medium",
    accent: "#0f766e",
  },
  {
    type: "link_contracts",
    name: "Contracts",
    app: "Operations",
    description: "Service contract portfolio",
    sizes: ["small", "medium"],
    defaultSize: "small",
    accent: "#1f5c42",
  },
  {
    type: "link_work_orders",
    name: "Work orders",
    app: "Operations",
    description: "Field job list",
    sizes: ["small", "medium"],
    defaultSize: "small",
    accent: "#be123c",
  },
];

export const ADMIN_WIDGET_STORAGE_KEY = "esm-admin-dashboard-widgets-v2";
export const ADMIN_ALERT_THRESHOLDS_KEY = "esm-admin-alert-thresholds-v1";

export type AdminAlertThresholds = {
  arBalanceMax: number;
  criticalWoMax: number;
  openInvoiceMax: number;
  aging90Max: number;
  pendingApprovalsMax: number;
};

export const DEFAULT_ALERT_THRESHOLDS: AdminAlertThresholds = {
  arBalanceMax: 25000,
  criticalWoMax: 3,
  openInvoiceMax: 15,
  aging90Max: 5000,
  pendingApprovalsMax: 0,
};

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `aw-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultAdminWidgets(): WidgetInstance[] {
  return [
    { id: uid(), type: "company_kpi", size: "large" },
    { id: uid(), type: "attention", size: "large" },
    { id: uid(), type: "alert_pins", size: "medium" },
    { id: uid(), type: "ar_aging", size: "medium" },
    { id: uid(), type: "cash_pulse", size: "small" },
    { id: uid(), type: "labor_health", size: "medium" },
    { id: uid(), type: "margin_snapshot", size: "medium" },
    { id: uid(), type: "portal_pulse", size: "medium" },
    { id: uid(), type: "period_close", size: "medium" },
    { id: uid(), type: "team_load", size: "large" },
    { id: uid(), type: "staff_kpi", size: "large" },
    { id: uid(), type: "quick_links", size: "large" },
  ];
}

export function loadAlertThresholds(): AdminAlertThresholds {
  if (typeof window === "undefined") return { ...DEFAULT_ALERT_THRESHOLDS };
  try {
    const raw = localStorage.getItem(ADMIN_ALERT_THRESHOLDS_KEY);
    if (!raw) return { ...DEFAULT_ALERT_THRESHOLDS };
    const parsed = JSON.parse(raw) as Partial<AdminAlertThresholds>;
    return { ...DEFAULT_ALERT_THRESHOLDS, ...parsed };
  } catch {
    return { ...DEFAULT_ALERT_THRESHOLDS };
  }
}

export function saveAlertThresholds(t: AdminAlertThresholds) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ADMIN_ALERT_THRESHOLDS_KEY, JSON.stringify(t));
}

export function catalogEntry(type: AdminWidgetTypeId): WidgetCatalogEntry {
  return ADMIN_WIDGET_CATALOG.find((w) => w.type === type) ?? ADMIN_WIDGET_CATALOG[0];
}

export function loadAdminWidgets(): WidgetInstance[] {
  if (typeof window === "undefined") return defaultAdminWidgets();
  try {
    const raw = localStorage.getItem(ADMIN_WIDGET_STORAGE_KEY);
    if (!raw) return defaultAdminWidgets();
    const parsed = JSON.parse(raw) as WidgetInstance[];
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultAdminWidgets();
    const known = new Set(ADMIN_WIDGET_CATALOG.map((c) => c.type));
    return parsed.filter((w) => w.id && w.type && w.size && known.has(w.type));
  } catch {
    return defaultAdminWidgets();
  }
}

export function saveAdminWidgets(widgets: WidgetInstance[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(ADMIN_WIDGET_STORAGE_KEY, JSON.stringify(widgets));
}

export function createAdminWidget(type: AdminWidgetTypeId, size?: WidgetSize): WidgetInstance {
  const entry = catalogEntry(type);
  const pick = size && entry.sizes.includes(size) ? size : entry.defaultSize;
  return { id: uid(), type, size: pick };
}

export function sizeColSpan(size: WidgetSize): string {
  if (size === "large") return "col-span-12";
  if (size === "medium") return "col-span-12 md:col-span-6";
  return "col-span-12 sm:col-span-6 lg:col-span-4";
}

export function defaultHeightFor(type: AdminWidgetTypeId, size: WidgetSize): number {
  if (type === "company_kpi" || type === "staff_kpi") return size === "large" ? 140 : 180;
  if (type === "attention") return 120;
  if (type === "quick_links") return size === "large" ? 220 : 180;
  if (type === "managers_list" || type === "team_load") return size === "large" ? 340 : 300;
  if (
    type === "ar_aging" ||
    type === "labor_health" ||
    type === "portal_pulse" ||
    type === "period_close" ||
    type === "margin_snapshot" ||
    type === "alert_pins"
  ) {
    return size === "large" ? 300 : 260;
  }
  if (
    type.includes("pie") ||
    type === "wo_trend" ||
    type === "invoice_activity" ||
    type === "expiring_contracts" ||
    type === "open_work_orders" ||
    type === "low_stock"
  ) {
    return size === "small" ? 260 : size === "medium" ? 320 : 380;
  }
  if (type.startsWith("link_") || type === "open_ar" || type === "urgent_wos" || type === "cash_pulse") {
    return size === "small" ? 120 : 150;
  }
  return size === "large" ? 320 : 280;
}
