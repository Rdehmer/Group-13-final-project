"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { differenceInCalendarDays, isBefore, parseISO, startOfDay } from "date-fns";
import { Grip, Plus, Replace, Settings2, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ClickableStatCard, ClickableSectionCard } from "@/components/ClickableStatCard";
import {
  ContractPieCard,
  InvoiceActivityChart,
  WorkOrderTrendChart,
  type DashboardPieSlice,
  type InvoiceActivityPoint,
} from "@/components/DashboardCharts";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import { relatedName } from "@/lib/relations";
import type { AdminDashboardData } from "@/components/AdminDashboardHome";
import {
  ADMIN_WIDGET_CATALOG,
  catalogEntry,
  createAdminWidget,
  DEFAULT_ALERT_THRESHOLDS,
  defaultAdminWidgets,
  defaultHeightFor,
  loadAdminWidgets,
  loadAlertThresholds,
  saveAdminWidgets,
  saveAlertThresholds,
  sizeColSpan,
  type AdminAlertThresholds,
  type AdminWidgetTypeId,
  type WidgetInstance,
  type WidgetSize,
} from "@/lib/admin-dashboard-widgets";
import { batchedInvoiceIds, batchedPaymentIds, listBatches } from "@/lib/batches";
import { createClient } from "@/lib/supabase/client";
import { LiveDataRefresh } from "@/components/LiveDataRefresh";

export type AdminDashboardStudioData = AdminDashboardData & {
  customerCount: number;
  openWoCount: number;
  criticalCount: number;
  activeContracts: number;
  pendingApprovals: number;
  expiringSoonCount: number;
  arBalance: number;
  arLabel: string;
  cashThisMonth: number;
  cashLastMonth: number;
  openInvoiceCount: number;
  attentionTiles: { label: string; value: number; href: string; danger: boolean }[];
  contractStatusSlices: DashboardPieSlice[];
  contractValueSlices: DashboardPieSlice[];
  workOrderTrend: { month: string; count: number }[];
  invoiceActivity: InvoiceActivityPoint[];
  chartError: string | null;
  expiringSoon: {
    id: string;
    name: string;
    end_date: string | null;
    contract_price: number | null;
    contract_type: string | null;
    customers?: unknown;
  }[];
  openWorkOrders: {
    id: string;
    work_order_number: string;
    priority: string;
    status: string;
    scheduled_date: string | null;
    customers?: unknown;
  }[];
  lowStockParts: {
    id: string;
    name: string;
    part_number: string;
    quantity_on_hand: number;
    reorder_level: number;
  }[];
  hasPartsCatalog: boolean;
  laborHealth: {
    totalHours: number;
    regularHours: number;
    overtimeHours: number;
    billableHours: number;
    pendingApproval: number;
    exceptionCount: number;
  };
  arAging: {
    current: number;
    d30: number;
    d60: number;
    d90: number;
    gross: number;
  };
  portalPulse: {
    openJobs: number;
    unpaidCustomers: number;
    pendingContractRequests: number;
    openInvoiceCount: number;
  };
  marginSnapshot: {
    revenue: number;
    cogs: number;
    profit: number;
    marginPct: number | null;
    jobCount: number;
    jobLossCount: number;
  };
  teamLoad: {
    unassignedOpen: number;
    techs: { id: string; name: string; openJobs: number }[];
  };
  /** Invoice/payment ids for client-side period-close batch readiness. */
  periodCloseSeed: {
    invoiceIds: string[];
    paymentIds: string[];
  };
};

function reorderWidgets(list: WidgetInstance[], fromId: string, toId: string): WidgetInstance[] {
  if (fromId === toId) return list;
  const from = list.findIndex((w) => w.id === fromId);
  const to = list.findIndex((w) => w.id === toId);
  if (from < 0 || to < 0) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  const insertAt = next.findIndex((w) => w.id === toId);
  if (insertAt < 0) {
    next.push(item);
    return next;
  }
  next.splice(insertAt, 0, item);
  return next;
}

function ResizableFrame({
  widget,
  editMode,
  onHeight,
  onRemove,
  onReplace,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  isDropTarget,
  isDragging,
  children,
}: {
  widget: WidgetInstance;
  editMode: boolean;
  onHeight: (id: string, h: number) => void;
  onRemove: (id: string) => void;
  onReplace: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent, id: string) => void;
  onDrop: (e: DragEvent, id: string) => void;
  isDropTarget: boolean;
  isDragging: boolean;
  children: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const catalog = catalogEntry(widget.type);
  const defaultH = defaultHeightFor(widget.type, widget.size);
  const height = widget.heightPx ?? defaultH;
  const saving = useRef(false);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    function commit() {
      if (!frameRef.current || saving.current) return;
      const h = Math.round(frameRef.current.getBoundingClientRect().height);
      if (Math.abs(h - height) < 6) return;
      saving.current = true;
      onHeight(widget.id, h);
      window.setTimeout(() => {
        saving.current = false;
      }, 80);
    }
    el.addEventListener("pointerup", commit);
    el.addEventListener("mouseup", commit);
    return () => {
      el.removeEventListener("pointerup", commit);
      el.removeEventListener("mouseup", commit);
    };
  }, [widget.id, height, onHeight]);

  function beginDrag(e: DragEvent) {
    e.dataTransfer.setData("text/plain", widget.id);
    e.dataTransfer.effectAllowed = "move";
    onDragStart(widget.id);
  }

  return (
    <div
      ref={frameRef}
      className={`group relative flex min-h-[7rem] w-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-base-100 shadow-none transition-shadow ${
        editMode ? "border-primary/40 ring-1 ring-primary/15" : "border-base-300/70"
      } ${isDropTarget ? "ring-2 ring-primary ring-offset-2 ring-offset-base-100" : ""} ${
        isDragging ? "opacity-40" : ""
      }`}
      style={{ height, resize: editMode ? "both" : "vertical" }}
      onDragOver={(e) => onDragOver(e, widget.id)}
      onDrop={(e) => onDrop(e, widget.id)}
    >
      {editMode ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-primary/20 bg-primary/10 px-2 py-1">
          <button
            type="button"
            draggable
            onDragStart={beginDrag}
            onDragEnd={onDragEnd}
            className="flex min-w-0 cursor-grab items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-primary active:cursor-grabbing"
            aria-label={`Drag to reorder ${catalog.name}`}
          >
            <Grip className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{catalog.name}</span>
          </button>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              className="btn btn-ghost btn-xs"
              aria-label={`Replace ${catalog.name}`}
              title="Replace widget"
              onClick={() => onReplace(widget.id)}
            >
              <Replace className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-xs text-error"
              aria-label={`Remove ${catalog.name}`}
              onClick={() => onRemove(widget.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="pointer-events-none absolute left-2 top-2 z-20 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
          <button
            type="button"
            draggable
            onDragStart={beginDrag}
            onDragEnd={onDragEnd}
            className="btn btn-ghost btn-xs cursor-grab gap-1 border border-base-300/80 bg-base-100/95 shadow-sm active:cursor-grabbing"
            aria-label={`Drag to reorder ${catalog.name}`}
          >
            <Grip className="h-3.5 w-3.5" aria-hidden />
            Move
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="h-full min-h-0 w-full overflow-auto">{children}</div>
      </div>
      <div
        className={`pointer-events-none absolute bottom-1 right-1 z-10 h-3 w-3 border-b-2 border-r-2 opacity-40 ${
          editMode ? "border-primary" : "border-base-content"
        }`}
        aria-hidden
      />
    </div>
  );
}

function StatTile({
  label,
  value,
  href,
  danger,
  hint,
}: {
  label: string;
  value: string | number;
  href: string;
  danger?: boolean;
  hint?: string;
}) {
  return (
    <Link
      href={href}
      className={`flex h-full min-h-0 flex-col justify-center overflow-hidden rounded-2xl border px-3 py-3 transition-colors hover:border-primary/40 hover:bg-base-200/40 ${
        danger ? "border-error/40 bg-error/5" : "border-base-300/70 bg-base-100"
      }`}
    >
      <p className="truncate text-xs font-medium uppercase tracking-wide text-base-content/55">{label}</p>
      <p
        className={`truncate font-display text-2xl font-semibold tabular-nums ${
          danger ? "text-error" : "text-base-content"
        }`}
      >
        {value}
      </p>
      {hint ? <p className="line-clamp-2 text-xs text-base-content/55">{hint}</p> : null}
      <p className="mt-1 truncate text-xs font-medium text-primary">Open →</p>
    </Link>
  );
}

function LinkTile({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex h-full min-h-0 flex-col justify-center overflow-hidden rounded-2xl border-2 border-primary/20 bg-primary/5 px-4 py-4 transition-colors hover:border-primary/45 hover:bg-primary/10"
    >
      <p className="text-sm font-semibold uppercase tracking-wide text-primary/80">{title}</p>
      <p className="mt-1 text-sm text-base-content/70">{description}</p>
      <p className="mt-2 text-sm font-medium text-primary">Open →</p>
    </Link>
  );
}

const QUICK_LINKS: { href: string; title: string; blurb: string }[] = [
  { href: "/users", title: "Users", blurb: "Roles & accounts" },
  { href: "/settings/employees", title: "Permissions", blurb: "Module access & rates" },
  { href: "/settings", title: "Settings", blurb: "Company defaults" },
  { href: "/reports", title: "Reports", blurb: "Executive & GAAP" },
  { href: "/billing", title: "Billing", blurb: "Invoice queue" },
  { href: "/payments", title: "Payments", blurb: "Collections" },
  { href: "/batches", title: "Batches", blurb: "Posting batches" },
  { href: "/accounting/close", title: "Period close", blurb: "Close the books" },
  { href: "/contracts", title: "Contracts", blurb: "Portfolio" },
  { href: "/work-orders", title: "Work orders", blurb: "Field jobs" },
  { href: "/timesheets", title: "Timesheets", blurb: "Labor approvals" },
];

function AgingBar({ label, amount, total, href }: { label: string; amount: number; total: number; href: string }) {
  const pct = total > 0 ? Math.min(100, (amount / total) * 100) : 0;
  return (
    <Link href={href} className="block space-y-1 rounded-lg px-1 py-1 transition-colors hover:bg-base-200/50">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-base-content/70">{label}</span>
        <span className="tabular-nums font-semibold">{formatMoney(amount)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-base-200">
        <div className="h-full rounded-full bg-warning" style={{ width: `${pct}%` }} />
      </div>
    </Link>
  );
}

function PeriodCloseWidget({ seed }: { seed: AdminDashboardStudioData["periodCloseSeed"] }) {
  const [state, setState] = useState<{
    loading: boolean;
    openBatches: number;
    postedBatches: number;
    unbatchedInvoices: number;
    unbatchedPayments: number;
  }>({ loading: true, openBatches: 0, postedBatches: 0, unbatchedInvoices: 0, unbatchedPayments: 0 });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [{ data: batches }, invBatched, payBatched] = await Promise.all([
        listBatches(supabase, "all"),
        batchedInvoiceIds(supabase),
        batchedPaymentIds(supabase),
      ]);
      if (cancelled) return;
      const openBatches = batches.filter((b) => b.status === "Open").length;
      const postedBatches = batches.filter((b) => b.status === "Posted").length;
      const unbatchedInvoices = seed.invoiceIds.filter((id) => !invBatched.ids.has(id)).length;
      const unbatchedPayments = seed.paymentIds.filter((id) => !payBatched.ids.has(id)).length;
      setState({
        loading: false,
        openBatches,
        postedBatches,
        unbatchedInvoices,
        unbatchedPayments,
      });
    })().catch(() => {
      if (!cancelled) setState((s) => ({ ...s, loading: false }));
    });
    return () => {
      cancelled = true;
    };
  }, [seed.invoiceIds, seed.paymentIds]);

  if (state.loading) {
    return <p className="p-4 text-sm opacity-60">Checking period-close items…</p>;
  }

  const rows = [
    {
      label: "Open batches",
      value: state.openBatches,
      href: "/batches",
      danger: state.openBatches > 0,
      hint: "Still editable",
    },
    {
      label: "Posted (awaiting export)",
      value: state.postedBatches,
      href: "/batches",
      danger: false,
      hint: "Ready for export",
    },
    {
      label: "Unbatched invoices",
      value: state.unbatchedInvoices,
      href: "/batches",
      danger: state.unbatchedInvoices > 0,
      hint: "Batchable not yet grouped",
    },
    {
      label: "Unbatched payments",
      value: state.unbatchedPayments,
      href: "/batches",
      danger: state.unbatchedPayments > 0,
      hint: "Cash not yet batched",
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-2">
      <ClickableSectionCard
        href="/accounting/close"
        title="Period-close readiness"
        ariaLabel="Open period close"
        fillParent
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map((r) => (
            <Link
              key={r.label}
              href={r.href}
              className={`rounded-xl border px-3 py-2 transition-colors hover:border-primary/40 ${
                r.danger ? "border-error/40 bg-error/5" : "border-base-300/70"
              }`}
            >
              <p className="text-[11px] font-medium uppercase tracking-wide text-base-content/55">{r.label}</p>
              <p className={`font-display text-xl font-semibold tabular-nums ${r.danger ? "text-error" : ""}`}>
                {r.value}
              </p>
              <p className="text-xs text-base-content/55">{r.hint}</p>
            </Link>
          ))}
        </div>
        <p className="mt-3 text-xs text-base-content/55">
          Also review deferred revenue and unbilled completions in{" "}
          <Link href="/accounting/close" className="link link-primary">
            Period close
          </Link>
          .
        </p>
      </ClickableSectionCard>
    </div>
  );
}

function AlertPinsWidget({
  live,
}: {
  live: {
    arBalance: number;
    criticalCount: number;
    openInvoiceCount: number;
    aging90: number;
    pendingApprovals: number;
  };
}) {
  const [thresholds, setThresholds] = useState<AdminAlertThresholds>(DEFAULT_ALERT_THRESHOLDS);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AdminAlertThresholds>(DEFAULT_ALERT_THRESHOLDS);

  useEffect(() => {
    const t = loadAlertThresholds();
    setThresholds(t);
    setDraft(t);
  }, []);

  function save() {
    saveAlertThresholds(draft);
    setThresholds(draft);
    setEditing(false);
  }

  const pins = [
    {
      label: "Open AR over",
      threshold: thresholds.arBalanceMax,
      actual: live.arBalance,
      format: (n: number) => formatMoney(n),
      href: "/billing",
      breached: live.arBalance > thresholds.arBalanceMax,
      key: "arBalanceMax" as const,
    },
    {
      label: "Critical / high WOs over",
      threshold: thresholds.criticalWoMax,
      actual: live.criticalCount,
      format: (n: number) => String(n),
      href: "/work-orders?filter=urgent",
      breached: live.criticalCount > thresholds.criticalWoMax,
      key: "criticalWoMax" as const,
    },
    {
      label: "Open invoices over",
      threshold: thresholds.openInvoiceMax,
      actual: live.openInvoiceCount,
      format: (n: number) => String(n),
      href: "/billing",
      breached: live.openInvoiceCount > thresholds.openInvoiceMax,
      key: "openInvoiceMax" as const,
    },
    {
      label: "61+ day AR over",
      threshold: thresholds.aging90Max,
      actual: live.aging90,
      format: (n: number) => formatMoney(n),
      href: "/reports",
      breached: live.aging90 > thresholds.aging90Max,
      key: "aging90Max" as const,
    },
    {
      label: "Pending contract approvals over",
      threshold: thresholds.pendingApprovalsMax,
      actual: live.pendingApprovals,
      format: (n: number) => String(n),
      href: "/contracts?status=Pending%20Approval",
      breached: live.pendingApprovals > thresholds.pendingApprovalsMax,
      key: "pendingApprovalsMax" as const,
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-base-content/50">Pinned alerts</p>
        <button
          type="button"
          className="btn btn-ghost btn-xs"
          onClick={() => (editing ? save() : setEditing(true))}
        >
          {editing ? "Save thresholds" : "Edit thresholds"}
        </button>
      </div>
      {editing ? (
        <div className="mb-3 space-y-2 rounded-xl border border-base-300 bg-base-200/30 p-2">
          {(
            [
              ["arBalanceMax", "AR balance max ($)"],
              ["criticalWoMax", "Critical WO max"],
              ["openInvoiceMax", "Open invoice max"],
              ["aging90Max", "61+ aging max ($)"],
              ["pendingApprovalsMax", "Pending approvals max"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex items-center justify-between gap-2 text-xs">
              <span className="opacity-70">{label}</span>
              <input
                type="number"
                className="input input-bordered input-xs w-28"
                value={draft[key]}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [key]: Math.max(0, Number(e.target.value) || 0) }))
                }
              />
            </label>
          ))}
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      ) : null}
      <ul className="space-y-1.5">
        {pins.map((p) => (
          <li key={p.key}>
            <Link
              href={p.href}
              className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm transition-colors hover:border-primary/40 ${
                p.breached ? "border-error/50 bg-error/5" : "border-base-300/70"
              }`}
            >
              <span className="min-w-0">
                <span className="block font-medium">{p.label}</span>
                <span className="text-xs opacity-60">
                  Threshold {p.format(p.threshold)} · now {p.format(p.actual)}
                </span>
              </span>
              <span
                className={`badge badge-sm shrink-0 ${p.breached ? "badge-error" : "badge-success"}`}
              >
                {p.breached ? "Alert" : "OK"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AdminDashboardStudio({ data }: { data: AdminDashboardStudioData }) {
  const [widgets, setWidgets] = useState<WidgetInstance[]>(() => defaultAdminWidgets());
  const [hydrated, setHydrated] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const [pickerType, setPickerType] = useState<AdminWidgetTypeId | null>(null);
  const [pickerSize, setPickerSize] = useState<WidgetSize>("medium");
  const [search, setSearch] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [attentionOpen, setAttentionOpen] = useState(() => data.attentionTiles.length > 0);
  const [portalReady, setPortalReady] = useState(false);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (data.attentionTiles.length === 0) setAttentionOpen(false);
  }, [data.attentionTiles.length]);

  useEffect(() => {
    if (!attentionOpen) return;
    window.scrollTo(0, 0);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setAttentionOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [attentionOpen]);

  useEffect(() => {
    setWidgets(loadAdminWidgets());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveAdminWidgets(widgets);
  }, [widgets, hydrated]);

  const attentionItemCount = useMemo(
    () => data.attentionTiles.reduce((sum, t) => sum + t.value, 0),
    [data.attentionTiles],
  );

  const cashChange =
    data.cashLastMonth === 0
      ? data.cashThisMonth > 0
        ? null
        : 0
      : (data.cashThisMonth - data.cashLastMonth) / Math.abs(data.cashLastMonth);

  const onHeight = useCallback((id: string, h: number) => {
    setWidgets((prev) =>
      prev.map((w) => (w.id === id ? { ...w, heightPx: Math.max(120, Math.min(900, h)) } : w)),
    );
  }, []);

  const removeWidget = useCallback((id: string) => {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const openAddPicker = useCallback(() => {
    setReplaceId(null);
    setPickerOpen(true);
    setPickerType(null);
    setSearch("");
  }, []);

  const openReplacePicker = useCallback((id: string) => {
    setReplaceId(id);
    setPickerOpen(true);
    setPickerType(null);
    setSearch("");
    setEditMode(true);
  }, []);

  const applyWidget = useCallback(
    (type: AdminWidgetTypeId, size: WidgetSize) => {
      if (replaceId) {
        setWidgets((prev) =>
          prev.map((w) =>
            w.id === replaceId
              ? { ...w, type, size, heightPx: undefined }
              : w,
          ),
        );
      } else {
        setWidgets((prev) => [createAdminWidget(type, size), ...prev]);
      }
      setPickerOpen(false);
      setPickerType(null);
      setReplaceId(null);
      setEditMode(true);
    },
    [replaceId],
  );

  const resetLayout = useCallback(() => {
    setWidgets(defaultAdminWidgets());
  }, []);

  const handleDragOver = useCallback(
    (e: DragEvent, id: string) => {
      const types = Array.from(e.dataTransfer.types ?? []);
      const isReorder = Boolean(draggingId) || types.includes("text/plain");
      if (!isReorder) return;
      if (draggingId === id) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDropTargetId(id);
    },
    [draggingId],
  );

  const handleDrop = useCallback(
    (e: DragEvent, toId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const fromId = e.dataTransfer.getData("text/plain") || draggingId;
      if (!fromId || fromId === toId) {
        setDraggingId(null);
        setDropTargetId(null);
        return;
      }
      setWidgets((prev) => reorderWidgets(prev, fromId, toId));
      setDraggingId(null);
      setDropTargetId(null);
    },
    [draggingId],
  );

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDropTargetId(null);
  }, []);

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ADMIN_WIDGET_CATALOG;
    return ADMIN_WIDGET_CATALOG.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.app.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q),
    );
  }, [search]);

  const today = startOfDay(new Date());

  function renderBody(widget: WidgetInstance): ReactNode {
    const compact = widget.size === "small";
    switch (widget.type) {
      case "company_kpi":
        return (
          <div className="grid h-full auto-rows-fr gap-3 overflow-auto p-2 sm:grid-cols-2 xl:grid-cols-4">
            <ClickableStatCard
              label="Active customers"
              value={data.customerCount}
              href="/customers"
              ariaLabel="View customers"
            />
            <ClickableStatCard
              label="Open work orders"
              value={data.openWoCount}
              hint={`${data.criticalCount} high/critical`}
              href="/work-orders?filter=open"
              ariaLabel="View open work orders"
            />
            <ClickableStatCard
              label="Active contracts"
              value={data.activeContracts}
              hint={`${data.expiringSoonCount} expiring ≤30 days`}
              href="/contracts?status=Active"
              ariaLabel="View contracts"
            />
            <ClickableStatCard
              label="Open AR"
              value={data.arLabel}
              href="/billing"
              danger={data.arBalance > 0}
              ariaLabel="View receivables"
            />
          </div>
        );
      case "staff_kpi":
        return (
          <div className="grid h-full auto-rows-fr gap-3 overflow-auto p-2 sm:grid-cols-2 xl:grid-cols-4">
            <ClickableStatCard
              label="Service managers"
              value={data.managerCount}
              href="/users"
              hint="Day-to-day ops accounts"
            />
            <ClickableStatCard label="Technicians" value={data.technicianCount} href="/users" />
            <ClickableStatCard label="Billing staff" value={data.billingCount} href="/users" />
            <ClickableStatCard
              label="Active staff"
              value={data.activeStaffCount}
              href="/users"
              hint={
                data.inactiveStaffCount > 0
                  ? `${data.inactiveStaffCount} inactive · ${data.adminCount} admins`
                  : `${data.adminCount} administrators`
              }
            />
          </div>
        );
      case "attention":
        return (
          <div className="flex h-full min-h-0 flex-col overflow-hidden p-3">
            <p className="mb-2 shrink-0 text-xs font-semibold uppercase tracking-wide text-base-content/50">
              Needs attention
            </p>
            {data.attentionTiles.length === 0 ? (
              <p className="text-sm text-base-content/55">Nothing urgent right now.</p>
            ) : (
              <div className="grid min-h-0 flex-1 auto-rows-fr gap-2 overflow-auto sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {data.attentionTiles.map((tile) => (
                  <Link
                    key={tile.label}
                    href={tile.href}
                    className={`flex min-h-0 flex-col justify-center overflow-hidden rounded-xl border px-3 py-2 transition-colors hover:border-primary/40 ${
                      tile.danger
                        ? "border-error/40 bg-error/5"
                        : "border-base-300/70 bg-base-100"
                    }`}
                  >
                    <p className="truncate text-[11px] font-medium uppercase tracking-wide text-base-content/55">
                      {tile.label}
                    </p>
                    <p
                      className={`truncate font-display text-xl font-semibold tabular-nums ${
                        tile.danger ? "text-error" : ""
                      }`}
                    >
                      {tile.value}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      case "managers_list":
        return (
          <div className="flex h-full min-h-0 flex-col overflow-hidden p-2">
            <ClickableSectionCard
              href="/users"
              title="Service managers"
              ariaLabel="Open user directory"
              fillParent
            >
              {data.managers.length === 0 ? (
                <EmptyState
                  title="No service managers yet"
                  description="Create manager accounts so field ops has clear ownership."
                />
              ) : (
                <ul className="divide-y divide-base-300">
                  {data.managers.map((m) => (
                    <li
                      key={m.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-2 py-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{m.full_name?.trim() || m.email}</p>
                        <p className="truncate text-xs opacity-60">{m.email}</p>
                      </div>
                      <span
                        className={`badge badge-sm ${m.is_active ? "badge-success" : "badge-ghost"}`}
                      >
                        {m.is_active ? "Active" : "Inactive"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </ClickableSectionCard>
          </div>
        );
      case "contract_status_pie":
        return (
          <ContractPieCard
            title="Contracts by status"
            description="Portfolio mix across every contract status"
            data={data.contractStatusSlices}
            valueKind="count"
            viewAllHref="/contracts"
            compact={compact}
            fillParent
          />
        );
      case "contract_value_pie":
        return (
          <ContractPieCard
            title="Active contract value by type"
            description="Booked price for Active contracts only"
            data={data.contractValueSlices}
            valueKind="money"
            viewAllHref="/contracts?status=Active"
            compact={compact}
            fillParent
          />
        );
      case "wo_trend":
        return (
          <WorkOrderTrendChart workOrderTrend={data.workOrderTrend} compact={compact} fillParent />
        );
      case "invoice_activity":
        return (
          <InvoiceActivityChart
            data={data.invoiceActivity}
            error={data.chartError}
            compact={compact}
            fillParent
          />
        );
      case "cash_pulse":
        return (
          <div className="flex h-full min-h-0 p-2">
            <StatTile
              label="Cash this month"
              value={formatMoney(data.cashThisMonth)}
              href="/payments"
              hint={
                cashChange == null
                  ? `Last month ${formatMoney(data.cashLastMonth)}`
                  : `${cashChange >= 0 ? "▲" : "▼"} ${Math.abs(cashChange * 100).toFixed(0)}% vs last month`
              }
            />
          </div>
        );
      case "ar_aging":
        return (
          <div className="flex h-full min-h-0 flex-col overflow-auto p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-base-content/50">AR aging</p>
                <p className="font-display text-lg font-semibold tabular-nums">
                  {formatMoney(data.arAging.gross)} open
                </p>
              </div>
              <Link href="/reports" className="btn btn-ghost btn-xs">
                Reports
              </Link>
            </div>
            <div className="space-y-2">
              <AgingBar
                label="Current"
                amount={data.arAging.current}
                total={data.arAging.gross}
                href="/billing"
              />
              <AgingBar label="1–30 past due" amount={data.arAging.d30} total={data.arAging.gross} href="/billing" />
              <AgingBar label="31–60 past due" amount={data.arAging.d60} total={data.arAging.gross} href="/billing" />
              <AgingBar
                label="61+ past due"
                amount={data.arAging.d90}
                total={data.arAging.gross}
                href="/billing"
              />
            </div>
          </div>
        );
      case "labor_health":
        return (
          <div className="flex h-full min-h-0 flex-col overflow-hidden p-2">
            <ClickableSectionCard
              href="/timesheets"
              title="Labor & timesheets (14 days)"
              ariaLabel="Open timesheets"
              fillParent
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-base-300/70 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide opacity-55">Total hours</p>
                  <p className="font-display text-xl font-semibold tabular-nums">
                    {data.laborHealth.totalHours.toFixed(1)}
                  </p>
                  <p className="text-xs opacity-55">
                    Reg {data.laborHealth.regularHours.toFixed(1)} · OT{" "}
                    {data.laborHealth.overtimeHours.toFixed(1)}
                  </p>
                </div>
                <div className="rounded-xl border border-base-300/70 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide opacity-55">Billable hours</p>
                  <p className="font-display text-xl font-semibold tabular-nums">
                    {data.laborHealth.billableHours.toFixed(1)}
                  </p>
                  <p className="text-xs opacity-55">
                    of {data.laborHealth.totalHours.toFixed(1)} logged
                  </p>
                </div>
                <Link
                  href="/timesheets"
                  className={`rounded-xl border px-3 py-2 ${
                    data.laborHealth.pendingApproval > 0
                      ? "border-error/40 bg-error/5"
                      : "border-base-300/70"
                  }`}
                >
                  <p className="text-[11px] uppercase tracking-wide opacity-55">Pending approval</p>
                  <p className="font-display text-xl font-semibold tabular-nums">
                    {data.laborHealth.pendingApproval}
                  </p>
                </Link>
                <Link
                  href="/timesheets"
                  className={`rounded-xl border px-3 py-2 ${
                    data.laborHealth.exceptionCount > 0
                      ? "border-warning/50 bg-warning/10"
                      : "border-base-300/70"
                  }`}
                >
                  <p className="text-[11px] uppercase tracking-wide opacity-55">Exceptions</p>
                  <p className="font-display text-xl font-semibold tabular-nums">
                    {data.laborHealth.exceptionCount}
                  </p>
                </Link>
              </div>
            </ClickableSectionCard>
          </div>
        );
      case "portal_pulse":
        return (
          <div className="flex h-full min-h-0 flex-col overflow-hidden p-2">
            <ClickableSectionCard
              href="/work-orders?filter=open"
              title="Customer & ops pulse"
              ariaLabel="Open work orders"
              fillParent
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <Link href="/work-orders?filter=open" className="rounded-xl border border-base-300/70 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide opacity-55">Open jobs</p>
                  <p className="font-display text-xl font-semibold tabular-nums">
                    {data.portalPulse.openJobs}
                  </p>
                </Link>
                <Link
                  href="/billing"
                  className={`rounded-xl border px-3 py-2 ${
                    data.portalPulse.unpaidCustomers > 0
                      ? "border-warning/50 bg-warning/10"
                      : "border-base-300/70"
                  }`}
                >
                  <p className="text-[11px] uppercase tracking-wide opacity-55">Customers with balance</p>
                  <p className="font-display text-xl font-semibold tabular-nums">
                    {data.portalPulse.unpaidCustomers}
                  </p>
                  <p className="text-xs opacity-55">{data.portalPulse.openInvoiceCount} open invoices</p>
                </Link>
                <Link
                  href="/contracts?status=Pending%20Approval"
                  className={`rounded-xl border px-3 py-2 sm:col-span-2 ${
                    data.portalPulse.pendingContractRequests > 0
                      ? "border-error/40 bg-error/5"
                      : "border-base-300/70"
                  }`}
                >
                  <p className="text-[11px] uppercase tracking-wide opacity-55">
                    Pending contract requests
                  </p>
                  <p className="font-display text-xl font-semibold tabular-nums">
                    {data.portalPulse.pendingContractRequests}
                  </p>
                </Link>
              </div>
            </ClickableSectionCard>
          </div>
        );
      case "period_close":
        return <PeriodCloseWidget seed={data.periodCloseSeed} />;
      case "margin_snapshot":
        return (
          <div className="flex h-full min-h-0 flex-col overflow-hidden p-2">
            <ClickableSectionCard
              href="/reports"
              title="Job margin (MTD)"
              ariaLabel="Open reports"
              fillParent
            >
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-base-300/70 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide opacity-55">Job revenue</p>
                  <p className="font-display text-xl font-semibold tabular-nums">
                    {formatMoney(data.marginSnapshot.revenue)}
                  </p>
                </div>
                <div className="rounded-xl border border-base-300/70 px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide opacity-55">Job COGS</p>
                  <p className="font-display text-xl font-semibold tabular-nums">
                    {formatMoney(data.marginSnapshot.cogs)}
                  </p>
                </div>
                <div
                  className={`rounded-xl border px-3 py-2 ${
                    (data.marginSnapshot.profit ?? 0) < 0
                      ? "border-error/40 bg-error/5"
                      : "border-base-300/70"
                  }`}
                >
                  <p className="text-[11px] uppercase tracking-wide opacity-55">Gross profit</p>
                  <p className="font-display text-xl font-semibold tabular-nums">
                    {formatMoney(data.marginSnapshot.profit)}
                  </p>
                  <p className="text-xs opacity-55">
                    Margin{" "}
                    {data.marginSnapshot.marginPct == null
                      ? "N/A"
                      : `${(data.marginSnapshot.marginPct * 100).toFixed(1)}%`}
                  </p>
                </div>
                <div
                  className={`rounded-xl border px-3 py-2 ${
                    data.marginSnapshot.jobLossCount > 0
                      ? "border-error/40 bg-error/5"
                      : "border-base-300/70"
                  }`}
                >
                  <p className="text-[11px] uppercase tracking-wide opacity-55">Jobs at a loss</p>
                  <p className="font-display text-xl font-semibold tabular-nums">
                    {data.marginSnapshot.jobLossCount}
                  </p>
                  <p className="text-xs opacity-55">
                    of {data.marginSnapshot.jobCount} billed jobs MTD
                  </p>
                </div>
              </div>
            </ClickableSectionCard>
          </div>
        );
      case "alert_pins":
        return (
          <AlertPinsWidget
            live={{
              arBalance: data.arBalance,
              criticalCount: data.criticalCount,
              openInvoiceCount: data.openInvoiceCount,
              aging90: data.arAging.d90,
              pendingApprovals: data.pendingApprovals,
            }}
          />
        );
      case "team_load":
        return (
          <div className="flex h-full min-h-0 flex-col overflow-hidden p-2">
            <ClickableSectionCard
              href="/work-orders?filter=open"
              title="Team workload"
              ariaLabel="Open work orders"
              fillParent
            >
              <div className="mb-2">
                <Link
                  href="/technician"
                  className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                    data.teamLoad.unassignedOpen > 0
                      ? "border-error/40 bg-error/5"
                      : "border-base-300/70"
                  }`}
                >
                  <span className="opacity-60">Unassigned open</span>
                  <span className="font-display text-lg font-semibold tabular-nums">
                    {data.teamLoad.unassignedOpen}
                  </span>
                </Link>
              </div>
              {data.teamLoad.techs.length === 0 ? (
                <EmptyState
                  title="No open assignments"
                  description="Technician load appears when open jobs are assigned."
                />
              ) : (
                <ul className="divide-y divide-base-300">
                  {data.teamLoad.techs.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2 px-1 py-2 text-sm">
                      <span className="truncate font-medium">{t.name}</span>
                      <span className="tabular-nums font-semibold">{t.openJobs} open</span>
                    </li>
                  ))}
                </ul>
              )}
            </ClickableSectionCard>
          </div>
        );
      case "expiring_contracts":
        return (
          <div className="flex h-full min-h-0 flex-col overflow-hidden p-2">
            <ClickableSectionCard
              href="/contracts?status=Active"
              title="Contracts expiring within 30 days"
              ariaLabel="View active contracts"
              fillParent
            >
              {data.expiringSoon.length === 0 ? (
                <EmptyState
                  title="No renewals due soon"
                  description="Active contracts ending in the next 30 days will show here."
                />
              ) : (
                <ul className="divide-y divide-base-300">
                  {data.expiringSoon.map((c) => {
                    const end = c.end_date?.slice(0, 10) ?? "";
                    let daysLeft = 0;
                    try {
                      daysLeft = differenceInCalendarDays(parseISO(end), today);
                    } catch {
                      daysLeft = 0;
                    }
                    return (
                      <li key={c.id}>
                        <Link
                          href={`/contracts/${c.id}`}
                          className="flex flex-wrap items-center gap-3 px-2 py-3 transition-colors hover:bg-base-200/70"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-primary">{c.name}</span>
                            <span className="block truncate text-xs text-base-content/55">
                              {relatedName(c.customers)}
                              {c.contract_type ? ` · ${c.contract_type}` : ""}
                            </span>
                          </span>
                          <span className="text-sm tabular-nums">{end}</span>
                          <StatusBadge
                            label={daysLeft <= 7 ? `${daysLeft}d left` : `${daysLeft} days`}
                            tone={daysLeft <= 7 ? "error" : "warning"}
                          />
                          <span className="text-sm font-medium">
                            {formatMoney(Number(c.contract_price) || 0)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ClickableSectionCard>
          </div>
        );
      case "open_work_orders":
        return (
          <div className="flex h-full min-h-0 flex-col overflow-hidden p-2">
            <ClickableSectionCard
              href="/work-orders?filter=open"
              title="Open work orders"
              ariaLabel="View open work orders"
              fillParent
            >
              {data.openWorkOrders.length === 0 ? (
                <EmptyState title="No open work orders" description="Field volume will appear here." />
              ) : (
                <ul className="divide-y divide-base-300">
                  {data.openWorkOrders.map((wo) => {
                    const urgent = ["Critical", "High"].includes(wo.priority);
                    const overdue =
                      !!wo.scheduled_date && isBefore(parseISO(wo.scheduled_date), today);
                    return (
                      <li key={wo.id}>
                        <Link
                          href={`/work-orders/${wo.id}`}
                          className={`flex flex-wrap items-center gap-3 px-2 py-3 transition-colors hover:bg-base-200/70 ${
                            urgent || overdue ? "bg-error/10" : ""
                          }`}
                        >
                          <span className="min-w-[5.5rem] font-medium text-primary">
                            {wo.work_order_number}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm">
                            {relatedName(wo.customers)}
                          </span>
                          <StatusBadge label={wo.priority} tone={statusTone(wo.priority)} />
                          <StatusBadge label={wo.status} tone={statusTone(wo.status)} />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ClickableSectionCard>
          </div>
        );
      case "low_stock":
        return (
          <div className="flex h-full min-h-0 flex-col overflow-hidden p-2">
            <ClickableSectionCard
              href="/parts?filter=low-stock"
              title="Low stock parts"
              ariaLabel="View low stock parts"
              fillParent
            >
              {data.lowStockParts.length === 0 ? (
                <EmptyState
                  title={data.hasPartsCatalog ? "Inventory looks good" : "No inventory catalog yet"}
                  description={
                    data.hasPartsCatalog
                      ? "No parts at or below reorder level."
                      : "Add parts to track stock levels."
                  }
                />
              ) : (
                <ul className="divide-y divide-base-300">
                  {data.lowStockParts.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/parts?filter=low-stock&part=${p.id}`}
                        className="flex flex-wrap items-center gap-3 px-2 py-3 transition-colors hover:bg-base-200/70"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">
                          {p.part_number} — {p.name}
                        </span>
                        <StatusBadge label={`On hand ${p.quantity_on_hand}`} tone="warning" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </ClickableSectionCard>
          </div>
        );
      case "open_ar":
        return (
          <div className="flex h-full min-h-0 p-2">
            <StatTile
              label="Open AR"
              value={data.arLabel}
              href="/billing"
              danger={data.arBalance > 0}
              hint="Accounts receivable"
            />
          </div>
        );
      case "urgent_wos":
        return (
          <div className="flex h-full min-h-0 p-2">
            <StatTile
              label="High / critical open"
              value={data.criticalCount}
              href="/work-orders?filter=urgent"
              danger={data.criticalCount > 0}
            />
          </div>
        );
      case "quick_links":
        return (
          <div className="grid h-full auto-rows-fr gap-2 overflow-auto p-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {QUICK_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="flex min-h-0 flex-col justify-center rounded-xl border border-base-300/70 px-3 py-2 transition-colors hover:border-primary/40 hover:bg-base-200/40"
              >
                <p className="truncate font-semibold text-primary">{link.title}</p>
                <p className="truncate text-xs text-base-content/55">{link.blurb}</p>
              </Link>
            ))}
          </div>
        );
      case "link_users":
        return (
          <div className="flex h-full min-h-0 p-2">
            <LinkTile title="Users" description="Accounts and roles" href="/users" />
          </div>
        );
      case "link_permissions":
        return (
          <div className="flex h-full min-h-0 p-2">
            <LinkTile
              title="Permissions & rates"
              description="Employee module access"
              href="/settings/employees"
            />
          </div>
        );
      case "link_settings":
        return (
          <div className="flex h-full min-h-0 p-2">
            <LinkTile title="Company settings" description="Tax, OT, defaults" href="/settings" />
          </div>
        );
      case "link_billing":
        return (
          <div className="flex h-full min-h-0 p-2">
            <LinkTile title="Billing" description="Invoice queue" href="/billing" />
          </div>
        );
      case "link_payments":
        return (
          <div className="flex h-full min-h-0 p-2">
            <LinkTile title="Payments" description="Cash collections" href="/payments" />
          </div>
        );
      case "link_batches":
        return (
          <div className="flex h-full min-h-0 p-2">
            <LinkTile title="Batches" description="Posting batches" href="/batches" />
          </div>
        );
      case "link_period_close":
        return (
          <div className="flex h-full min-h-0 p-2">
            <LinkTile
              title="Period close"
              description="Close accounting periods"
              href="/accounting/close"
            />
          </div>
        );
      case "link_reports":
        return (
          <div className="flex h-full min-h-0 p-2">
            <LinkTile title="Reports" description="Executive & financial reports" href="/reports" />
          </div>
        );
      case "link_contracts":
        return (
          <div className="flex h-full min-h-0 p-2">
            <LinkTile title="Contracts" description="Service portfolio" href="/contracts" />
          </div>
        );
      case "link_work_orders":
        return (
          <div className="flex h-full min-h-0 p-2">
            <LinkTile title="Work orders" description="Field jobs" href="/work-orders" />
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <div>
      <LiveDataRefresh />
      <PageHeader
        title="Admin Dashboard"
        description="Company control board — shared live data with the manager portal"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-primary btn-sm gap-1" onClick={openAddPicker}>
              <Plus className="h-4 w-4" />
              Add Widget
            </button>
            <button
              type="button"
              className={`btn btn-sm gap-1 ${editMode ? "btn-secondary" : "btn-outline"}`}
              onClick={() => setEditMode((v) => !v)}
              aria-pressed={editMode}
            >
              <Settings2 className="h-4 w-4" />
              {editMode ? "Done" : "Edit"}
            </button>
          </div>
        }
      />

      {editMode ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-primary/25 bg-primary/5 px-3 py-2 text-sm">
          <p className="text-base-content/80">
            <strong>Edit dashboard</strong> — drag to reorder, replace (swap icon) to change a tile,
            resize from the corner, trash to remove.
          </p>
          <button type="button" className="btn btn-ghost btn-xs" onClick={resetLayout}>
            Reset to default layout
          </button>
        </div>
      ) : (
        <p className="mb-3 text-xs text-base-content/55">
          Hover a widget and use <strong>Move</strong> to reorder. Turn on <strong>Edit</strong> to
          replace, resize, or remove.
        </p>
      )}

      <div className="grid grid-cols-12 items-start gap-4">
        {widgets.map((widget) => (
          <div key={widget.id} className={`${sizeColSpan(widget.size)} min-w-0`}>
            <ResizableFrame
              widget={widget}
              editMode={editMode}
              onHeight={onHeight}
              onRemove={removeWidget}
              onReplace={openReplacePicker}
              onDragStart={(id) => setDraggingId(id || null)}
              onDragEnd={handleDragEnd}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              isDropTarget={dropTargetId === widget.id}
              isDragging={draggingId === widget.id}
            >
              {renderBody(widget)}
            </ResizableFrame>
          </div>
        ))}
      </div>

      {widgets.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-base-300 p-10 text-center">
          <p className="font-display text-lg font-semibold">Your dashboard is empty</p>
          <p className="mt-1 text-sm text-base-content/60">
            Add company metrics, people, finance, or shortcut tiles.
          </p>
          <button type="button" className="btn btn-primary btn-sm mt-4 gap-1" onClick={openAddPicker}>
            <Plus className="h-4 w-4" />
            Add Widget
          </button>
        </div>
      ) : null}

      {portalReady && attentionOpen && data.attentionTiles.length > 0
        ? createPortal(
            <div style={{ position: "fixed", inset: 0, zIndex: 99999, pointerEvents: "auto" }}>
              <button
                type="button"
                style={{
                  position: "absolute",
                  inset: 0,
                  border: 0,
                  margin: 0,
                  padding: 0,
                  cursor: "pointer",
                  background: "rgba(15, 23, 20, 0.45)",
                  backdropFilter: "blur(2px)",
                }}
                aria-label="Dismiss needs attention"
                onClick={() => setAttentionOpen(false)}
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="admin-needs-attention-title"
                style={{
                  position: "absolute",
                  top: 12,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: "min(28rem, calc(100vw - 1.5rem))",
                  maxHeight: "min(70vh, calc(100dvh - 1.5rem))",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  borderRadius: "1rem",
                  border: "1px solid #e5e7eb",
                  backgroundColor: "#ffffff",
                  color: "#111827",
                  boxShadow: "0 25px 50px -12px rgba(0,0,0,0.35)",
                }}
              >
                <div
                  className="flex shrink-0 items-center justify-between gap-2 px-3 py-2.5"
                  style={{ borderBottom: "1px solid #e5e7eb" }}
                >
                  <div className="min-w-0">
                    <h2
                      id="admin-needs-attention-title"
                      className="font-display text-base font-semibold leading-tight"
                    >
                      Needs attention
                    </h2>
                    <p className="text-xs" style={{ color: "#6b7280" }}>
                      {data.attentionTiles.length} item
                      {data.attentionTiles.length === 1 ? "" : "s"}
                      {attentionItemCount > 0 ? ` · ${attentionItemCount} total` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-circle shrink-0"
                    aria-label="Close"
                    onClick={() => setAttentionOpen(false)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
                  {data.attentionTiles.map((tile) => (
                    <li key={tile.label}>
                      <Link
                        href={tile.href}
                        onClick={() => setAttentionOpen(false)}
                        className="flex items-center gap-3 rounded-xl border px-3 py-2.5"
                        style={{
                          backgroundColor: "#fef2f2",
                          borderColor: "#f87171",
                          color: "#7f1d1d",
                        }}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold" style={{ color: "#991b1b" }}>
                            {tile.label}
                          </span>
                          <span className="block text-xs" style={{ color: "#b91c1c" }}>
                            Open to review
                          </span>
                        </span>
                        <span
                          className="shrink-0 font-display text-2xl font-semibold tabular-nums"
                          style={{ color: "#dc2626" }}
                        >
                          {tile.value}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                <div
                  className="flex shrink-0 justify-end px-3 py-2"
                  style={{ borderTop: "1px solid #e5e7eb" }}
                >
                  <button
                    type="button"
                    className="btn btn-sm border-0 text-white"
                    style={{ backgroundColor: "#1f5c42" }}
                    onClick={() => setAttentionOpen(false)}
                  >
                    View full dashboard
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {pickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <button
            type="button"
            className="absolute inset-0 bg-base-content/40"
            aria-label="Close widget gallery"
            onClick={() => {
              setPickerOpen(false);
              setPickerType(null);
              setReplaceId(null);
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={replaceId ? "Replace Widget" : "Add Widget"}
            className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-base-300 bg-base-100 shadow-2xl sm:rounded-3xl"
          >
            <div className="flex items-center justify-between border-b border-base-300 px-4 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-base-content/50">
                  Widgets
                </p>
                <h2 className="font-display text-lg font-semibold">
                  {pickerType
                    ? catalogEntry(pickerType).name
                    : replaceId
                      ? "Replace Widget"
                      : "Add Widget"}
                </h2>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle"
                aria-label="Close"
                onClick={() => {
                  setPickerOpen(false);
                  setPickerType(null);
                  setReplaceId(null);
                }}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!pickerType ? (
              <>
                <div className="border-b border-base-300 px-4 py-2">
                  <input
                    type="search"
                    className="input input-bordered input-sm w-full rounded-full"
                    placeholder="Search widgets"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <ul className="flex-1 space-y-2 overflow-y-auto p-3">
                  {filteredCatalog.map((entry) => (
                    <li key={entry.type}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 rounded-2xl border border-base-300/70 px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-base-200/50"
                        onClick={() => {
                          setPickerType(entry.type);
                          setPickerSize(entry.defaultSize);
                        }}
                      >
                        <span
                          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-lg font-bold text-white shadow-inner"
                          style={{ backgroundColor: entry.accent }}
                          aria-hidden
                        >
                          {entry.name.slice(0, 1)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-medium uppercase tracking-wide text-base-content/50">
                            {entry.app}
                          </span>
                          <span className="block font-semibold">{entry.name}</span>
                          <span className="block text-xs text-base-content/60">
                            {entry.description}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {filteredCatalog.length === 0 ? (
                    <li className="py-8 text-center text-sm text-base-content/55">No widgets match.</li>
                  ) : null}
                </ul>
              </>
            ) : (
              <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs self-start"
                  onClick={() => setPickerType(null)}
                >
                  ← All widgets
                </button>
                <div
                  className="mx-auto flex w-full max-w-xs flex-col items-center rounded-3xl border border-base-300 bg-base-200/40 p-6"
                  style={{ borderTopColor: catalogEntry(pickerType).accent, borderTopWidth: 4 }}
                >
                  <span
                    className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold text-white"
                    style={{ backgroundColor: catalogEntry(pickerType).accent }}
                  >
                    {catalogEntry(pickerType).name.slice(0, 1)}
                  </span>
                  <p className="text-center text-xs font-semibold uppercase tracking-wide text-base-content/50">
                    {catalogEntry(pickerType).app}
                  </p>
                  <p className="text-center font-display text-lg font-semibold">
                    {catalogEntry(pickerType).name}
                  </p>
                  <p className="mt-1 text-center text-sm text-base-content/60">
                    {catalogEntry(pickerType).description}
                  </p>
                </div>
                <div>
                  <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-base-content/50">
                    Widget size
                  </p>
                  <div className="flex flex-wrap justify-center gap-2">
                    {catalogEntry(pickerType).sizes.map((size) => (
                      <button
                        key={size}
                        type="button"
                        className={`btn btn-sm capitalize ${
                          pickerSize === size ? "btn-primary" : "btn-outline"
                        }`}
                        onClick={() => setPickerSize(size)}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary w-full"
                  onClick={() => applyWidget(pickerType, pickerSize)}
                >
                  {replaceId ? "Replace Widget" : "Add Widget"}
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
