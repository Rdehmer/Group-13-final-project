"use client";

/**
 * Top-bar global search across customers, invoices, work orders, equipment, parts.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  HardDrive,
  Loader2,
  Package,
  Search,
  Users,
  Wrench,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export type GlobalSearchHit = {
  id: string;
  kind: "customer" | "invoice" | "work_order" | "equipment" | "part";
  title: string;
  subtitle: string;
  href: string;
};

const KIND_ORDER: GlobalSearchHit["kind"][] = [
  "customer",
  "work_order",
  "invoice",
  "equipment",
  "part",
];

const KIND_LABEL: Record<GlobalSearchHit["kind"], string> = {
  customer: "Customers",
  invoice: "Invoices",
  work_order: "Work orders",
  equipment: "Equipment",
  part: "Parts",
};

function KindIcon({ kind }: { kind: GlobalSearchHit["kind"] }) {
  const cls = "h-4 w-4 shrink-0 opacity-60";
  switch (kind) {
    case "customer":
      return <Users className={cls} />;
    case "invoice":
      return <FileText className={cls} />;
    case "work_order":
      return <Wrench className={cls} />;
    case "equipment":
      return <HardDrive className={cls} />;
    case "part":
      return <Package className={cls} />;
  }
}

/** Strip characters that break PostgREST .or() / ilike patterns. */
function sanitizeQuery(raw: string): string {
  return raw
    .trim()
    .replace(/[%_,.()'"\\]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 64);
}

/** Build PostgREST or() clause for multi-column ilike (quoted pattern). */
function orIlike(columns: string[], q: string): string {
  const p = `"%${q}%"`;
  return columns.map((col) => `${col}.ilike.${p}`).join(",");
}

export async function runGlobalSearch(query: string): Promise<GlobalSearchHit[]> {
  const q = sanitizeQuery(query);
  if (q.length < 2) return [];

  const supabase = createClient();

  const [customers, invoices, workOrders, equipment, parts] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name, email, phone, city, state")
      .or(orIlike(["name", "email", "phone", "primary_contact_name", "billing_address"], q))
      .order("name")
      .limit(6),
    supabase
      .from("invoices")
      .select("id, invoice_number, status, remaining_balance, po_number, customers(name)")
      .or(orIlike(["invoice_number", "po_number", "notes", "status"], q))
      .order("invoice_date", { ascending: false })
      .limit(6),
    supabase
      .from("work_orders")
      .select("id, work_order_number, status, problem_description, customers(name)")
      .or(
        orIlike(
          ["work_order_number", "problem_description", "status", "requested_service"],
          q,
        ),
      )
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("equipment")
      .select("id, name, model, serial_number, manufacturer, location")
      .or(orIlike(["name", "model", "serial_number", "manufacturer", "location"], q))
      .order("name")
      .limit(5),
    supabase
      .from("parts")
      .select("id, part_number, name, category")
      .eq("is_active", true)
      .or(orIlike(["part_number", "name", "category", "supplier"], q))
      .order("name")
      .limit(5),
  ]);

  const hits: GlobalSearchHit[] = [];

  for (const c of customers.data ?? []) {
    const bits = [c.email, c.phone, [c.city, c.state].filter(Boolean).join(", ")].filter(Boolean);
    hits.push({
      id: c.id,
      kind: "customer",
      title: c.name,
      subtitle: bits.join(" · ") || "Customer",
      href: `/customers/${c.id}`,
    });
  }

  for (const inv of invoices.data ?? []) {
    const cust = inv.customers as { name?: string } | { name?: string }[] | null;
    const customerName = Array.isArray(cust) ? cust[0]?.name : cust?.name;
    hits.push({
      id: inv.id,
      kind: "invoice",
      title: inv.invoice_number,
      subtitle: [customerName, inv.status, inv.po_number ? `PO ${inv.po_number}` : null]
        .filter(Boolean)
        .join(" · "),
      href: `/billing/${inv.id}`,
    });
  }

  for (const wo of workOrders.data ?? []) {
    const cust = wo.customers as { name?: string } | { name?: string }[] | null;
    const customerName = Array.isArray(cust) ? cust[0]?.name : cust?.name;
    const problem = (wo.problem_description ?? "").trim();
    hits.push({
      id: wo.id,
      kind: "work_order",
      title: wo.work_order_number,
      subtitle: [customerName, wo.status, problem ? problem.slice(0, 48) : null]
        .filter(Boolean)
        .join(" · "),
      href: `/work-orders/${wo.id}`,
    });
  }

  for (const eq of equipment.data ?? []) {
    hits.push({
      id: eq.id,
      kind: "equipment",
      title: eq.name,
      subtitle: [eq.manufacturer, eq.model, eq.serial_number ? `S/N ${eq.serial_number}` : null]
        .filter(Boolean)
        .join(" · "),
      href: `/equipment/${eq.id}`,
    });
  }

  for (const part of parts.data ?? []) {
    hits.push({
      id: part.id,
      kind: "part",
      title: `${part.part_number} — ${part.name}`,
      subtitle: part.category || "Part",
      href: `/parts/${part.id}`,
    });
  }

  hits.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  return hits;
}

export function GlobalSearch() {
  const router = useRouter();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GlobalSearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const debouncedQ = useDebounced(query, 280);
  const clean = sanitizeQuery(debouncedQ);

  useEffect(() => {
    let cancelled = false;
    if (clean.length < 2) {
      setHits([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    void runGlobalSearch(clean)
      .then((rows) => {
        if (cancelled) return;
        setHits(rows);
        setActiveIndex(0);
        setOpen(true);
      })
      .catch((e) => {
        if (cancelled) return;
        setHits([]);
        setError(e instanceof Error ? e.message : "Search failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clean]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const go = useCallback(
    (hit: GlobalSearchHit) => {
      setOpen(false);
      setQuery("");
      setHits([]);
      router.push(hit.href);
    },
    [router],
  );

  const grouped = useMemo(() => {
    const map = new Map<GlobalSearchHit["kind"], GlobalSearchHit[]>();
    for (const h of hits) {
      const list = map.get(h.kind) ?? [];
      list.push(h);
      map.set(h.kind, list);
    }
    return KIND_ORDER.filter((k) => map.has(k)).map((k) => ({
      kind: k,
      items: map.get(k)!,
    }));
  }, [hits]);

  const flat = hits;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      e.currentTarget.blur();
      return;
    }
    if (!open || flat.length === 0) {
      if (e.key === "ArrowDown" && hits.length) setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = flat[activeIndex];
      if (hit) go(hit);
    }
  }

  const showPanel = open && sanitizeQuery(query).length >= 2;

  return (
    <div className="eq-search min-w-0 w-full max-w-[480px]" ref={rootRef}>
      <Search className="eq-search-icon" strokeWidth={1.75} />
      <input
        type="search"
        className="eq-search-input"
        placeholder="Search customers, invoices, work orders…"
        aria-label="Search customers, invoices, work orders"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={showPanel}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          if (sanitizeQuery(query).length >= 2) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
      />
      {loading ? (
        <Loader2
          className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[var(--eq-muted)]"
          aria-hidden
        />
      ) : null}

      {showPanel ? (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-[80] max-h-[min(70vh,28rem)] overflow-y-auto rounded-xl border border-[var(--eq-line)] bg-white shadow-lg"
        >
          {error ? (
            <p className="px-3 py-3 text-sm text-error">{error}</p>
          ) : loading && hits.length === 0 ? (
            <p className="px-3 py-3 text-sm text-[#5c6b7a]">Searching…</p>
          ) : hits.length === 0 ? (
            <p className="px-3 py-3 text-sm text-[#5c6b7a]">
              No matches for &ldquo;{sanitizeQuery(query)}&rdquo;
            </p>
          ) : (
            grouped.map((group) => (
              <div key={group.kind} className="border-b border-[var(--eq-line)] last:border-0">
                <p className="sticky top-0 bg-[#f5f8fa] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#5c6b7a]">
                  {KIND_LABEL[group.kind]}
                </p>
                <ul className="py-0.5">
                  {group.items.map((hit) => {
                    const idx = flat.indexOf(hit);
                    const active = idx === activeIndex;
                    return (
                      <li key={`${hit.kind}-${hit.id}`} role="option" aria-selected={active}>
                        <button
                          type="button"
                          className={`flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors ${
                            active ? "bg-[rgba(0,163,166,0.1)]" : "hover:bg-[#f5f8fa]"
                          }`}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => go(hit)}
                        >
                          <KindIcon kind={hit.kind} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-semibold text-[#1e2a36]">
                              {hit.title}
                            </span>
                            {hit.subtitle ? (
                              <span className="block truncate text-[11px] text-[#5c6b7a]">
                                {hit.subtitle}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
          {hits.length > 0 ? (
            <p className="border-t border-[var(--eq-line)] px-3 py-1.5 text-[10px] text-[#8b97a5]">
              ↑↓ navigate · Enter open · Esc close
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}
