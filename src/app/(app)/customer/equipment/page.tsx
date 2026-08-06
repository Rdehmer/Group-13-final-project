"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AddEquipmentModal } from "@/components/AddEquipmentModal";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import {
  buildCoverageMap,
  coverageFor,
  EQUIPMENT_COVERAGE_SELECT,
  type ContractEquipmentLink,
  type EquipmentCoverage,
} from "@/lib/equipmentCoverage";
import type { Equipment, Profile, WorkOrder } from "@/lib/types";

type EquipmentRow = Equipment & { coverage: EquipmentCoverage };

type RelatedWo = Pick<WorkOrder, "id" | "equipment_id" | "work_order_number" | "status" | "scheduled_date" | "work_order_type">;

const CLOSED_STATUSES = new Set(["Completed", "Closed", "Canceled"]);

/**
 * This business faces customer communication gap risk when equipment records are unclear.
 * Our app reduces the risk by letting customers view and register their equipment.
 */
function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return value.slice(0, 10);
}

function detailValue(value: string | null | undefined) {
  return value?.trim() ? value : "—";
}

export default function CustomerEquipmentPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [equipment, setEquipment] = useState<EquipmentRow[]>([]);
  const [workOrdersByEquipment, setWorkOrdersByEquipment] = useState<Map<string, RelatedWo[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showAddEquipment, setShowAddEquipment] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadEquipment = useCallback(async (customerId: string) => {
    const [{ data: eq }, { data: links }, { data: wos }] = await Promise.all([
      supabase.from("equipment").select("*").eq("customer_id", customerId).order("name"),
      supabase.from("contract_equipment").select(EQUIPMENT_COVERAGE_SELECT),
      supabase
        .from("work_orders")
        .select("id, equipment_id, work_order_number, status, scheduled_date, work_order_type")
        .eq("customer_id", customerId)
        .not("equipment_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    const coverageMap = buildCoverageMap(links as ContractEquipmentLink[] | null);
    const rows: EquipmentRow[] = ((eq as Equipment[]) ?? []).map((item) => ({
      ...item,
      coverage: coverageFor(coverageMap, item.id),
    }));
    setEquipment(rows);

    const byEquipment = new Map<string, RelatedWo[]>();
    for (const wo of (wos as RelatedWo[] | null) ?? []) {
      if (!wo.equipment_id) continue;
      const list = byEquipment.get(wo.equipment_id) ?? [];
      if (list.length >= 5) continue;
      list.push(wo);
      byEquipment.set(wo.equipment_id, list);
    }
    setWorkOrdersByEquipment(byEquipment);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
      if (!p?.customer_id) {
        setLoading(false);
        return;
      }
      await loadEquipment(p.customer_id);
      setLoading(false);
    })();
  }, [loadEquipment, supabase]);

  if (loading || !profile) return <div className="p-8 text-center opacity-60">Loading…</div>;

  if (!profile.customer_id) {
    return (
      <EmptyState title="No customer account linked" description="Contact Ridley Equipment Services to link your portal account." />
    );
  }

  return (
    <div>
      <PageHeader
        title="My Equipment"
        description="View asset details, service dates, and active contract coverage for equipment on your account."
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowAddEquipment(true)}>
            Add Equipment
          </button>
        }
      />

      {equipment.length === 0 ? (
        <EmptyState
          title="No equipment on file"
          description="Register equipment to request service or include it in a contract."
          action={
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowAddEquipment(true)}>
              Add Equipment
            </button>
          }
        />
      ) : (
        <div className="card bg-base-100 shadow">
          <div className="card-body p-0">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Serial #</th>
                    <th>Location</th>
                    <th>Install date</th>
                    <th>Status</th>
                    <th>Contract</th>
                  </tr>
                </thead>
                <tbody>
                  {equipment.map((eq) => {
                    const expanded = expandedId === eq.id;
                    const related = workOrdersByEquipment.get(eq.id) ?? [];
                    const openRelated = related.filter((wo) => !CLOSED_STATUSES.has(wo.status));
                    const recentRelated = related.filter((wo) => CLOSED_STATUSES.has(wo.status));
                    return (
                      <Fragment key={eq.id}>
                        <tr
                          className="cursor-pointer hover:bg-base-200/60"
                          onClick={() => setExpandedId(expanded ? null : eq.id)}
                          aria-expanded={expanded}
                        >
                          <td>
                            <p className="font-medium">{eq.name}</p>
                            <p className="text-xs opacity-60">
                              {[eq.manufacturer, eq.model].filter(Boolean).join(" · ") || "No make/model on file"}
                            </p>
                          </td>
                          <td className="font-mono text-xs">{eq.serial_number ?? "—"}</td>
                          <td>{eq.location ?? "—"}</td>
                          <td>{formatDate(eq.installation_date)}</td>
                          <td>
                            <StatusBadge label={eq.operating_status} tone={statusTone(eq.operating_status)} />
                          </td>
                          <td>
                            {eq.coverage.covered ? (
                              <div>
                                <StatusBadge label="Covered" tone="success" />
                                {eq.coverage.contractName ? (
                                  <p className="mt-1 text-xs opacity-60">{eq.coverage.contractName}</p>
                                ) : null}
                              </div>
                            ) : (
                              <StatusBadge label="Not covered" tone="neutral" />
                            )}
                          </td>
                        </tr>
                        {expanded ? (
                          <tr className="bg-base-200/40">
                            <td colSpan={6}>
                              <div className="grid gap-4 p-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                                <div>
                                  <p className="text-xs font-medium uppercase tracking-wide opacity-60">Category</p>
                                  <p>{detailValue(eq.category)}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium uppercase tracking-wide opacity-60">Manufacturer</p>
                                  <p>{detailValue(eq.manufacturer)}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium uppercase tracking-wide opacity-60">Model</p>
                                  <p>{detailValue(eq.model)}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium uppercase tracking-wide opacity-60">Warranty</p>
                                  <p>
                                    {eq.warranty_status}
                                    {eq.warranty_expiration_date
                                      ? ` · expires ${formatDate(eq.warranty_expiration_date)}`
                                      : ""}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium uppercase tracking-wide opacity-60">Last service</p>
                                  <p>{formatDate(eq.last_service_date)}</p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium uppercase tracking-wide opacity-60">Next scheduled</p>
                                  <p>{formatDate(eq.next_scheduled_service_date)}</p>
                                </div>
                                <div className="sm:col-span-2 lg:col-span-3">
                                  <p className="text-xs font-medium uppercase tracking-wide opacity-60">Contract coverage</p>
                                  {eq.coverage.covered ? (
                                    <p>
                                      {eq.coverage.contractName}
                                      {eq.coverage.contractType ? ` · ${eq.coverage.contractType}` : ""}
                                      {eq.coverage.endDate ? ` · through ${formatDate(eq.coverage.endDate)}` : ""}
                                    </p>
                                  ) : (
                                    <p>Not on an active contract</p>
                                  )}
                                </div>
                                <div className="sm:col-span-2 lg:col-span-3">
                                  <p className="text-xs font-medium uppercase tracking-wide opacity-60">Notes</p>
                                  <p>{detailValue(eq.notes)}</p>
                                </div>
                                <div className="sm:col-span-2 lg:col-span-3">
                                  <p className="text-xs font-medium uppercase tracking-wide opacity-60">Open / recent work orders</p>
                                  {related.length === 0 ? (
                                    <p className="mt-1 opacity-70">No work orders linked to this equipment yet.</p>
                                  ) : (
                                    <ul className="mt-2 space-y-2">
                                      {[...openRelated, ...recentRelated].map((wo) => {
                                        const open = !CLOSED_STATUSES.has(wo.status);
                                        return (
                                          <li key={wo.id} className="flex flex-wrap items-center justify-between gap-2 rounded-box bg-base-100 px-3 py-2">
                                            <div>
                                              <p className="font-medium">{wo.work_order_number}</p>
                                              <p className="text-xs opacity-60">
                                                {wo.work_order_type} · Scheduled {formatDate(wo.scheduled_date)}
                                              </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <StatusBadge label={wo.status} tone={statusTone(wo.status)} />
                                              <Link
                                                href={open ? "/customer/open-request" : "/customer/order-history"}
                                                className="btn btn-ghost btn-xs"
                                                onClick={(e) => e.stopPropagation()}
                                              >
                                                View
                                              </Link>
                                            </div>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  )}
                                </div>
                                <div className="sm:col-span-2 lg:col-span-3">
                                  <Link
                                    href={`/customer/request-service?equipment_id=${eq.id}`}
                                    className="btn btn-outline btn-sm"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    Request Service
                                  </Link>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <AddEquipmentModal
        supabase={supabase}
        customerId={profile.customer_id}
        open={showAddEquipment}
        onClose={() => setShowAddEquipment(false)}
        onAdded={(item) =>
          setEquipment((prev) =>
            [...prev, { ...item, coverage: { covered: false } }].sort((a, b) => a.name.localeCompare(b.name)),
          )
        }
      />
    </div>
  );
}
