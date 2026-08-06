"use client";

/**
 * Field-friendly parts picker: search, stock filters, tappable cards, qty stepper.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Minus,
  Package,
  Plus,
  Search,
} from "lucide-react";
import { StatusBadge } from "@/components/ui";
import type { Part, WorkOrderPart } from "@/lib/types";

export type UsedPartRow = WorkOrderPart & { parts?: Part | null };

type StockFilter = "all" | "in_stock" | "low" | "out";

type Props = {
  catalogParts: Part[];
  usedParts: UsedPartRow[];
  busy?: boolean;
  onLog: (partId: string, quantity: number) => void | Promise<void>;
  /** When true, prefer compact layout (job sheet). */
  compact?: boolean;
};

function isLow(part: Part) {
  return part.quantity_on_hand > 0 && part.quantity_on_hand <= part.reorder_level;
}

function stockTone(part: Part): "success" | "warning" | "error" | "neutral" {
  if (part.quantity_on_hand <= 0) return "error";
  if (isLow(part)) return "warning";
  return "success";
}

function stockLabel(part: Part): string {
  if (part.quantity_on_hand <= 0) return "Out";
  if (isLow(part)) return "Low";
  return "In stock";
}

export function TechPartsLogger({
  catalogParts,
  usedParts,
  busy = false,
  onLog,
  compact = false,
}: Props) {
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("in_stock");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);

  const categories = useMemo(() => {
    const set = new Set(
      catalogParts.map((p) => (p.category ?? "").trim()).filter(Boolean),
    );
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [catalogParts]);

  const [category, setCategory] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return catalogParts
      .filter((p) => {
        if (category !== "all" && (p.category ?? "") !== category) return false;
        if (stockFilter === "in_stock" && p.quantity_on_hand <= 0) return false;
        if (stockFilter === "low" && !isLow(p)) return false;
        if (stockFilter === "out" && p.quantity_on_hand > 0) return false;
        if (!q) return true;
        return (
          p.name.toLowerCase().includes(q) ||
          p.part_number.toLowerCase().includes(q) ||
          (p.category ?? "").toLowerCase().includes(q) ||
          (p.supplier ?? "").toLowerCase().includes(q)
        );
      })
      .slice(0, compact ? 12 : 40);
  }, [catalogParts, search, stockFilter, category, compact]);

  const selected = catalogParts.find((p) => p.id === selectedId) ?? null;
  const maxQty = selected ? Math.max(1, selected.quantity_on_hand) : 1;

  function selectPart(part: Part) {
    if (part.quantity_on_hand <= 0) return;
    setSelectedId(part.id);
    setQty(1);
  }

  function bumpQty(delta: number) {
    if (!selected) return;
    setQty((n) => Math.min(maxQty, Math.max(1, n + delta)));
  }

  async function submit() {
    if (!selected || selected.quantity_on_hand <= 0) return;
    const safeQty = Math.min(maxQty, Math.max(1, qty));
    await onLog(selected.id, safeQty);
    setQty(1);
  }

  const filters: { id: StockFilter; label: string }[] = [
    { id: "in_stock", label: "In stock" },
    { id: "low", label: "Low" },
    { id: "out", label: "Out" },
    { id: "all", label: "All" },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5 shrink-0" />
          <div>
            <h3 className="text-base font-semibold">Parts used</h3>
            <p className="text-xs opacity-70">
              Tap a part, set qty, log — warehouse stock updates.
            </p>
          </div>
        </div>
        <Link href="/parts" className="btn btn-ghost btn-sm min-h-10 gap-1">
          Catalog
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      <label className="input input-bordered flex min-h-12 items-center gap-2">
        <Search className="h-4 w-4 shrink-0 opacity-50" />
        <input
          className="grow bg-transparent outline-none"
          placeholder="Search part # or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search parts"
        />
        {search ? (
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => setSearch("")}
          >
            Clear
          </button>
        ) : null}
      </label>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Stock filter">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            className={`btn btn-xs min-h-9 ${stockFilter === f.id ? "btn-primary" : "btn-outline"}`}
            onClick={() => setStockFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {categories.length > 1 ? (
        <select
          className="select select-bordered select-sm w-full"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Category"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ) : null}

      {catalogParts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-base-300 px-3 py-6 text-center text-sm opacity-70">
          Catalog empty or blocked. Open{" "}
          <Link href="/parts" className="link link-primary">
            Parts
          </Link>{" "}
          or ask a manager.
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-base-300 px-3 py-6 text-center text-sm opacity-70">
          No parts match. Try “All” or clear search.
        </div>
      ) : (
        <ul
          className={`space-y-2 ${compact ? "max-h-64 overflow-y-auto pr-0.5" : "max-h-[28rem] overflow-y-auto"}`}
          role="listbox"
          aria-label="Parts catalog"
        >
          {filtered.map((part) => {
            const active = selectedId === part.id;
            const out = part.quantity_on_hand <= 0;
            return (
              <li key={part.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={out}
                  onClick={() => selectPart(part)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                    active
                      ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                      : out
                        ? "cursor-not-allowed border-base-200 opacity-50"
                        : "border-base-300 bg-base-100 hover:border-primary/40"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[11px] font-semibold opacity-60">
                        {part.part_number}
                      </span>
                      <StatusBadge label={stockLabel(part)} tone={stockTone(part)} />
                      {part.category ? (
                        <span className="badge badge-ghost badge-xs">{part.category}</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 truncate font-semibold leading-tight">{part.name}</p>
                    <p className="text-xs opacity-55">
                      Qty {part.quantity_on_hand}
                      {part.supplier ? ` · ${part.supplier}` : ""}
                    </p>
                  </div>
                  {active ? (
                    <Check className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && selected.quantity_on_hand > 0 ? (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide opacity-60">Selected</p>
            <p className="font-semibold">
              {selected.part_number} — {selected.name}
            </p>
            <p className="text-xs opacity-60">
              Up to {selected.quantity_on_hand} available
              {isLow(selected) ? (
                <span className="text-warning"> · below reorder</span>
              ) : null}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-outline btn-square min-h-12 min-w-12"
              disabled={busy || qty <= 1}
              onClick={() => bumpQty(-1)}
              aria-label="Decrease quantity"
            >
              <Minus className="h-4 w-4" />
            </button>
            <input
              type="number"
              min={1}
              max={maxQty}
              className="input input-bordered min-h-12 w-20 text-center text-lg font-semibold tabular-nums"
              value={qty}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (!Number.isFinite(n)) return;
                setQty(Math.min(maxQty, Math.max(1, Math.floor(n))));
              }}
              aria-label="Quantity used"
            />
            <button
              type="button"
              className="btn btn-outline btn-square min-h-12 min-w-12"
              disabled={busy || qty >= maxQty}
              onClick={() => bumpQty(1)}
              aria-label="Increase quantity"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="btn btn-secondary min-h-12 flex-1"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? "Logging…" : `Log ${qty} used`}
            </button>
          </div>
          {isLow(selected) || selected.quantity_on_hand - qty <= selected.reorder_level ? (
            <p className="flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Stock will be low or empty after logging — request restock from Parts if needed.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-center text-sm opacity-55">Select a part above to log usage.</p>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold">
          On this job
          {usedParts.length > 0 ? (
            <span className="badge badge-ghost badge-sm ml-2">{usedParts.length}</span>
          ) : null}
        </p>
        {usedParts.length === 0 ? (
          <p className="text-sm opacity-60">No parts logged yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {usedParts.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-base-200 px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="font-medium">
                    {row.parts?.name ?? "Part"} × {row.quantity_used}
                  </span>
                  {row.parts?.part_number ? (
                    <span className="mt-0.5 block font-mono text-[11px] opacity-50">
                      {row.parts.part_number}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 text-xs opacity-60">{row.date_used}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
