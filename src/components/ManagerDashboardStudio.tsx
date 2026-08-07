"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { differenceInCalendarDays, isBefore, parseISO, startOfDay } from "date-fns";
import { Grip, Plus, Settings2, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ClickableStatCard, ClickableSectionCard } from "@/components/ClickableStatCard";
import {
  ContractPieCard,
  InvoiceActivityChart,
  WorkOrderTrendChart,
  type DashboardPieSlice,
  type InvoiceActivityPoint,
} from "@/components/DashboardCharts";
import { ManagerDaySchedule } from "@/components/ManagerDaySchedule";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { formatMoney } from "@/lib/calculations";
import { relatedName } from "@/lib/relations";
import {
  WIDGET_CATALOG,
  catalogEntry,
  createWidget,
  defaultHeightFor,
  defaultWidgets,
  loadWidgets,
  saveWidgets,
  sizeColSpan,
  type WidgetInstance,
  type WidgetSize,
  type WidgetTypeId,
} from "@/lib/manager-dashboard-widgets";

export type ManagerDashboardData = {
  customerCount: number;
  openWoCount: number;
  criticalCount: number;
  activeContracts: number;
  pendingApprovals: number;
  expiringSoonCount: number;
  arBalance: number;
  arLabel: string;
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
  pendingTimeOff: number;
  ptoThisWeek: number;
  unscheduledOpen: number;
};

/**
 * Move `fromId` so it lands at the index of `toId`.
 * The widget that was at the target (and those after it) bump down in order.
 */
function reorderWidgets(
  list: WidgetInstance[],
  fromId: string,
  toId: string,
): WidgetInstance[] {
  if (fromId === toId) return list;
  const from = list.findIndex((w) => w.id === fromId);
  const to = list.findIndex((w) => w.id === toId);
  if (from < 0 || to < 0) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  // After removal, recompute target index so insert always pushes the target down.
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

  // Persist size when user finishes resizing (mouse up after CSS resize).
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
      style={{
        height,
        resize: editMode ? "both" : "vertical",
      }}
      onDragOver={(e) => onDragOver(e, widget.id)}
      onDrop={(e) => onDrop(e, widget.id)}
      onDragLeave={(e) => {
        // Only clear when leaving the frame, not entering a child.
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
      }}
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
            <span className="hidden font-normal normal-case opacity-70 sm:inline">· drop on another box</span>
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
      ) : (
        /* Always show a slim drag handle so reordering does not require Edit for power users */
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
      <p className="truncate text-xs font-medium uppercase tracking-wide text-base-content/55">
        {label}
      </p>
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

export function ManagerDashboardStudio({ data }: { data: ManagerDashboardData }) {
  const [widgets, setWidgets] = useState<WidgetInstance[]>(() => defaultWidgets());
  const [hydrated, setHydrated] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerType, setPickerType] = useState<WidgetTypeId | null>(null);
  const [pickerSize, setPickerSize] = useState<WidgetSize>("medium");
  const [search, setSearch] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // Show on every mount/open of the Dashboard when there is something to review.
  // Closing stays closed until the user leaves and re-opens the Dashboard tab (new mount).
  const [attentionOpen, setAttentionOpen] = useState(
    () => data.attentionTiles.length > 0,
  );
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

  const attentionItemCount = useMemo(
    () => data.attentionTiles.reduce((sum, t) => sum + t.value, 0),
    [data.attentionTiles],
  );

  useEffect(() => {
    setWidgets(loadWidgets());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveWidgets(widgets);
  }, [widgets, hydrated]);

  const onHeight = useCallback((id: string, h: number) => {
    setWidgets((prev) =>
      prev.map((w) => (w.id === id ? { ...w, heightPx: Math.max(120, Math.min(900, h)) } : w)),
    );
  }, []);

  const removeWidget = useCallback((id: string) => {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
  }, []);

  const addWidget = useCallback((type: WidgetTypeId, size: WidgetSize) => {
    // New widgets land at the top and bump the rest down (same mental model as drop-to-insert).
    setWidgets((prev) => [createWidget(type, size), ...prev]);
    setPickerOpen(false);
    setPickerType(null);
    setEditMode(true);
  }, []);

  const resetLayout = useCallback(() => {
    setWidgets(defaultWidgets());
  }, []);

  const handleDragOver = useCallback(
    (e: DragEvent, id: string) => {
      // Allow drop even if React state lags a tick behind dragstart.
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
      // Dropped onto target → insert at target index; former target and everything below bump down.
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
    if (!q) return WIDGET_CATALOG;
    return WIDGET_CATALOG.filter(
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
      case "kpi_row":
        return (
          <div className="grid h-full auto-rows-fr gap-3 overflow-auto p-2 sm:grid-cols-2 xl:grid-cols-5">
            <ClickableStatCard
              label="Active Customers"
              value={data.customerCount}
              href="/customers"
              ariaLabel="View active customers"
            />
            <ClickableStatCard
              label="Open Work Orders"
              value={data.openWoCount}
              hint={`${data.criticalCount} high/critical open`}
              href="/work-orders?filter=open"
              ariaLabel="View open work orders"
            />
            <ClickableStatCard
              label="Active Contracts"
              value={data.activeContracts}
              hint={`${data.expiringSoonCount} expiring soon`}
              href="/contracts?status=Active"
              ariaLabel="View service contracts"
            />
            <ClickableStatCard
              label="Pending Approvals"
              value={data.pendingApprovals}
              hint={
                data.pendingApprovals > 0
                  ? "Customer requests awaiting review"
                  : "No requests waiting"
              }
              href="/contracts?status=Pending%20Approval"
              danger={data.pendingApprovals > 0}
              ariaLabel="View contracts pending approval"
            />
            <ClickableStatCard
              label="Open AR"
              value={data.arLabel}
              href="/reports/invoice-cash"
              danger={data.arBalance > 0}
              ariaLabel="View accounts receivable"
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
            description="Annual/booked price for Active contracts only"
            data={data.contractValueSlices}
            valueKind="money"
            viewAllHref="/contracts?status=Active"
            compact={compact}
            fillParent
          />
        );
      case "day_schedule":
        return <ManagerDaySchedule />;
      case "wo_trend":
        return (
          <WorkOrderTrendChart
            workOrderTrend={data.workOrderTrend}
            compact={compact}
            fillParent
          />
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
              title="Action Required — Work Orders"
              ariaLabel="View all open work orders needing action"
              fillParent
            >
              {data.openWorkOrders.length === 0 ? (
                <EmptyState title="No open work orders" description="Create a work order to get started." />
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
              title="Low Stock Parts"
              ariaLabel="View parts at or below reorder level"
              fillParent
            >
              {data.lowStockParts.length === 0 ? (
                <EmptyState
                  title="Inventory looks good"
                  description="No parts at or below reorder level."
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
                        <span className="text-sm opacity-70">Reorder {p.reorder_level}</span>
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
              href="/reports/invoice-cash"
              danger={data.arBalance > 0}
              hint="Accounts receivable"
            />
          </div>
        );
      case "pending_leave":
        return (
          <div className="flex h-full min-h-0 p-2">
            <StatTile
              label="Pending leave"
              value={data.pendingTimeOff}
              href="/time-off"
              danger={data.pendingTimeOff > 0}
              hint="Awaiting manager approval"
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
      case "unscheduled":
        return (
          <div className="flex h-full min-h-0 p-2">
            <StatTile
              label="Unscheduled open"
              value={data.unscheduledOpen}
              href="/technician"
              danger={data.unscheduledOpen > 0}
              hint="Place on calendar"
            />
          </div>
        );
      case "dispatch_link":
        return (
          <div className="flex h-full min-h-0 items-stretch overflow-hidden p-2">
            <Link
              href="/dispatch"
              className="flex min-h-0 flex-1 flex-col justify-center overflow-hidden rounded-2xl border-2 border-primary/25 bg-primary/5 px-4 py-5 transition-colors hover:border-primary/50 hover:bg-primary/10"
            >
              <p className="text-sm font-semibold uppercase tracking-wide text-primary/80">
                Dispatch board
              </p>
              <p className="mt-1 font-display text-xl font-semibold leading-snug">
                Review live assignment priorities
              </p>
              <p className="mt-2 text-sm font-medium text-primary">Open Dispatch →</p>
            </Link>
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Operations overview — add widgets, resize frames, open any tile for details"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm gap-1"
              onClick={() => {
                setPickerOpen(true);
                setPickerType(null);
                setSearch("");
              }}
            >
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
            <strong>Edit home screen</strong> — drag a box (or its grip) onto another box to insert;
            the target and everything below bump down. Resize from the bottom-right corner. Trash
            removes a widget.
          </p>
          <button type="button" className="btn btn-ghost btn-xs" onClick={resetLayout}>
            Reset to default layout
          </button>
        </div>
      ) : (
        <p className="mb-3 text-xs text-base-content/55">
          Hover a widget and use <strong>Move</strong> to reorder. Turn on <strong>Edit</strong> to
          resize or remove.
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
            Tap Add Widget to pick charts and stats — like iPhone widgets for this app.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm mt-4 gap-1"
            onClick={() => setPickerOpen(true)}
          >
            <Plus className="h-4 w-4" />
            Add Widget
          </button>
        </div>
      ) : null}

      {/* Modal over full app: body portal + top-anchored (not middle-centered). */}
      {portalReady && attentionOpen && data.attentionTiles.length > 0
        ? createPortal(
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 99999,
                pointerEvents: "auto",
              }}
            >
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
                aria-labelledby="needs-attention-title"
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
                  style={{ borderBottom: "1px solid #e5e7eb", backgroundColor: "#ffffff" }}
                >
                  <div className="min-w-0">
                    <h2
                      id="needs-attention-title"
                      className="font-display text-base font-semibold leading-tight"
                      style={{ color: "#111827" }}
                    >
                      Needs attention
                    </h2>
                    <p className="text-xs" style={{ color: "#6b7280" }}>
                      {data.attentionTiles.length} item
                      {data.attentionTiles.length === 1 ? "" : "s"} to review
                      {attentionItemCount > 0 ? ` · ${attentionItemCount} total` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs btn-circle shrink-0"
                    aria-label="Close and view dashboard"
                    onClick={() => setAttentionOpen(false)}
                    style={{ color: "#374151" }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <ul
                  className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3"
                  style={{ backgroundColor: "#ffffff" }}
                >
                  {data.attentionTiles.map((tile) => (
                    <li key={tile.label}>
                      <Link
                        href={tile.href}
                        onClick={() => setAttentionOpen(false)}
                        className="flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
                        style={{
                          backgroundColor: "#fef2f2",
                          borderColor: "#f87171",
                          color: "#7f1d1d",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = "#fee2e2";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = "#fef2f2";
                        }}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-semibold" style={{ color: "#991b1b" }}>
                            {tile.label}
                          </span>
                          <span className="block text-xs" style={{ color: "#b91c1c" }}>
                            Open to review and resolve
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
                  className="flex shrink-0 items-center justify-end px-3 py-2"
                  style={{ borderTop: "1px solid #e5e7eb", backgroundColor: "#ffffff" }}
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

      {/* iOS-style add widget sheet */}
      {pickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <button
            type="button"
            className="absolute inset-0 bg-base-content/40"
            aria-label="Close widget gallery"
            onClick={() => {
              setPickerOpen(false);
              setPickerType(null);
            }}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add Widget"
            className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-base-300 bg-base-100 shadow-2xl sm:rounded-3xl"
          >
            <div className="flex items-center justify-between border-b border-base-300 px-4 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-base-content/50">
                  Widgets
                </p>
                <h2 className="font-display text-lg font-semibold">
                  {pickerType ? catalogEntry(pickerType).name : "Add Widget"}
                </h2>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle"
                aria-label="Close"
                onClick={() => {
                  setPickerOpen(false);
                  setPickerType(null);
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
                        <span className="ml-1 opacity-60">
                          {size === "small" ? "S" : size === "medium" ? "M" : "L"}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex justify-center gap-2" aria-hidden>
                    {catalogEntry(pickerType).sizes.map((size) => (
                      <div
                        key={size}
                        className={`rounded-lg border-2 transition-colors ${
                          pickerSize === size ? "border-primary bg-primary/10" : "border-base-300"
                        }`}
                        style={{
                          width: size === "small" ? 36 : size === "medium" ? 56 : 88,
                          height: size === "small" ? 36 : size === "medium" ? 44 : 52,
                        }}
                      />
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-primary w-full"
                  onClick={() => addWidget(pickerType, pickerSize)}
                >
                  Add Widget
                </button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
