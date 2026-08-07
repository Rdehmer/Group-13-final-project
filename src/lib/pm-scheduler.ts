/**
 * Preventive Maintenance visit generator — creates scheduled work orders from
 * Active/Renewed contracts (service_frequency + included_service_visits).
 * Idempotent per contract + scheduled month via problem_description tag.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addMonths,
  eachMonthOfInterval,
  format,
  isValid,
  parseISO,
  startOfMonth,
  endOfMonth,
  min as minDate,
  max as maxDate,
} from "date-fns";
import type { ServiceContract, WorkOrder } from "@/lib/types";
import { isDispatchableContractStatus } from "@/lib/contracts";
import {
  contractDispatchBlockMessage,
  isContractDispatchBlockedError,
  notifyContractDispatchBlocked,
} from "@/lib/contract-dispatch";
import {
  parsePlanSnapshotFromNotes,
  resolvePackIdFromSnapshot,
  resolvePlan,
} from "@/lib/contract-plans";

export const PM_WORK_ORDER_TYPE = "Preventive Maintenance";
export const PM_TAG_PREFIX = "[PM-SCHED ";

export type GeneratePmVisitsResult =
  | { ok: true; created: number; skipped: number; errors: string[] }
  | { ok: false; error: string };

/** Months between visits from contract service_frequency. */
export function frequencyIntervalMonths(frequency: string | null | undefined): number | null {
  const f = (frequency ?? "").trim().toLowerCase();
  if (!f) return null;
  if (/weekly|bi-?weekly/.test(f)) return null; // not month-grid; skip for MVP
  if (/^month|monthly/.test(f)) return 1;
  if (/bi-?month|every\s*2\s*month/.test(f)) return 2;
  if (/quarter/.test(f)) return 3;
  if (/semi|twice\s*a\s*year|6\s*month/.test(f)) return 6;
  if (/annual|yearly|once\s*a\s*year|12\s*month/.test(f)) return 12;
  return null;
}

export function pmScheduleTag(yearMonth: string): string {
  return `${PM_TAG_PREFIX}${yearMonth}]`;
}

export function extractPmScheduleTag(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/\[PM-SCHED\s+(\d{4}-\d{2})\]/i);
  return m?.[1] ?? null;
}

/**
 * Planned visit months for a contract overlapping [fromYm, toYm] inclusive (yyyy-MM).
 * Caps at included_service_visits when > 0.
 */
export function plannedPmVisitMonths(
  contract: Pick<
    ServiceContract,
    "start_date" | "end_date" | "service_frequency" | "included_service_visits"
  >,
  fromYm: string,
  toYm: string,
): string[] {
  const interval = frequencyIntervalMonths(contract.service_frequency);
  if (!interval) return [];

  let start: Date;
  let end: Date;
  try {
    start = startOfMonth(parseISO(contract.start_date));
    end = startOfMonth(parseISO(contract.end_date));
  } catch {
    return [];
  }
  if (!isValid(start) || !isValid(end) || end < start) return [];

  const windowStart = startOfMonth(parseISO(`${fromYm}-01`));
  const windowEnd = startOfMonth(parseISO(`${toYm}-01`));
  if (!isValid(windowStart) || !isValid(windowEnd)) return [];

  const rangeStart = maxDate([start, windowStart]);
  const rangeEnd = minDate([end, windowEnd]);
  if (rangeEnd < rangeStart) return [];

  const months: string[] = [];
  let cursor = start;
  // Align visits to contract start month, stepping by frequency
  while (cursor <= end) {
    const ym = format(cursor, "yyyy-MM");
    if (cursor >= rangeStart && cursor <= rangeEnd) {
      months.push(ym);
    }
    cursor = addMonths(cursor, interval);
  }

  const cap = Number(contract.included_service_visits) || 0;
  if (cap > 0) {
    // Cap applies to the full contract term visits that fall in window, in order
    const allOnContract: string[] = [];
    let c = start;
    while (c <= end) {
      allOnContract.push(format(c, "yyyy-MM"));
      c = addMonths(c, interval);
    }
    const allowed = new Set(allOnContract.slice(0, cap));
    return months.filter((m) => allowed.has(m));
  }
  return months;
}

export type PmObligationStats = {
  contractId: string;
  planned: number;
  completed: number;
  scheduledOpen: number;
  months: Record<
    string,
    { planned: boolean; status: "none" | "open" | "completed" | "canceled" }
  >;
};

/** Operational PM progress for GAAP deferral UI (completion vs straight-line). */
export function pmObligationStatsForContracts(
  contracts: Pick<ServiceContract, "id" | "start_date" | "end_date" | "service_frequency" | "included_service_visits">[],
  workOrders: Pick<
    WorkOrder,
    "id" | "contract_id" | "work_order_type" | "status" | "scheduled_date" | "problem_description"
  >[],
  asOfYm?: string,
): Map<string, PmObligationStats> {
  const map = new Map<string, PmObligationStats>();
  void asOfYm;

  for (const c of contracts) {
    const fromYm = c.start_date.slice(0, 7);
    const toYm = c.end_date.slice(0, 7);
    const planned = plannedPmVisitMonths(c, fromYm, toYm);
    const months: PmObligationStats["months"] = {};
    for (const ym of planned) {
      months[ym] = { planned: true, status: "none" };
    }

    const related = workOrders.filter(
      (wo) =>
        wo.contract_id === c.id &&
        (wo.work_order_type === PM_WORK_ORDER_TYPE ||
          Boolean(extractPmScheduleTag(wo.problem_description))),
    );

    for (const wo of related) {
      const tag = extractPmScheduleTag(wo.problem_description);
      const ym =
        tag ??
        (wo.scheduled_date && /^\d{4}-\d{2}/.test(wo.scheduled_date)
          ? wo.scheduled_date.slice(0, 7)
          : null);
      if (!ym) continue;
      if (!months[ym]) months[ym] = { planned: false, status: "none" };
      const st = (wo.status ?? "").toLowerCase();
      if (["completed", "closed"].includes(st)) {
        months[ym].status = "completed";
      } else if (["canceled", "cancelled"].includes(st)) {
        if (months[ym].status !== "completed") months[ym].status = "canceled";
      } else if (months[ym].status !== "completed") {
        months[ym].status = "open";
      }
    }

    let completed = 0;
    let scheduledOpen = 0;
    for (const ym of Object.keys(months)) {
      if (months[ym].status === "completed") completed += 1;
      else if (months[ym].status === "open") scheduledOpen += 1;
    }

    map.set(c.id, {
      contractId: c.id,
      planned: planned.length,
      completed,
      scheduledOpen,
      months,
    });
  }

  return map;
}

async function preferredTechnicianForCustomer(
  supabase: SupabaseClient,
  customerId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("work_orders")
    .select("assigned_technician_id")
    .eq("customer_id", customerId)
    .not("assigned_technician_id", "is", null)
    .order("scheduled_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.assigned_technician_id as string | null) ?? null;
}

/**
 * Create Preventive Maintenance work orders for the given calendar year
 * (or from now through year-end when year === current).
 */
export async function generatePmVisitsForYear(
  supabase: SupabaseClient,
  options: {
    year?: number;
    userId?: string | null;
    contractIds?: string[];
    /** Prefer scheduling from this month forward (yyyy-MM). Default: current month. */
    fromYm?: string;
  } = {},
): Promise<GeneratePmVisitsResult> {
  const year = options.year ?? new Date().getFullYear();
  const fromYm = options.fromYm ?? format(new Date(), "yyyy-MM");
  const toYm = `${year}-12`;
  if (fromYm.slice(0, 4) > String(year)) {
    return { ok: true, created: 0, skipped: 0, errors: [`No months left in ${year} to schedule.`] };
  }

  let query = supabase
    .from("service_contracts")
    .select("*")
    .in("status", ["Active", "Renewed"]);

  if (options.contractIds?.length) {
    query = query.in("id", options.contractIds);
  }

  const { data: contracts, error } = await query;
  if (error) return { ok: false, error: error.message };

  const list = ((contracts ?? []) as ServiceContract[]).filter((c) => {
    if (!frequencyIntervalMonths(c.service_frequency)) return false;
    return plannedPmVisitMonths(c, fromYm, toYm).length > 0;
  });

  if (list.length === 0) {
    return {
      ok: true,
      created: 0,
      skipped: 0,
      errors: ["No Active contracts with a supported service frequency need PM visits in this window."],
    };
  }

  const contractIds = list.map((c) => c.id);
  const { data: existing, error: existErr } = await supabase
    .from("work_orders")
    .select("id, contract_id, scheduled_date, problem_description, work_order_type, status")
    .in("contract_id", contractIds)
    .or(`work_order_type.eq.${PM_WORK_ORDER_TYPE},problem_description.ilike.%PM-SCHED%`);
  if (existErr) return { ok: false, error: existErr.message };

  const existingKeys = new Set<string>();
  for (const wo of existing ?? []) {
    const tag = extractPmScheduleTag(wo.problem_description as string);
    const ym =
      tag ??
      (typeof wo.scheduled_date === "string" ? wo.scheduled_date.slice(0, 7) : null);
    if (ym && wo.contract_id) existingKeys.add(`${wo.contract_id}:${ym}`);
  }

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  const techCache = new Map<string, string | null>();

  for (const contract of list) {
    const months = plannedPmVisitMonths(contract, fromYm, toYm);
    if (!techCache.has(contract.customer_id)) {
      techCache.set(
        contract.customer_id,
        await preferredTechnicianForCustomer(supabase, contract.customer_id),
      );
    }
    const techId = techCache.get(contract.customer_id) ?? null;

    for (const ym of months) {
      const key = `${contract.id}:${ym}`;
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }

      const scheduledDate = `${ym}-15`; // mid-month default slot
      const tag = pmScheduleTag(ym);
      const woNumber = `WO-PM${ym.replace("-", "")}-${Date.now().toString().slice(-5)}-${Math.random()
        .toString(36)
        .slice(2, 5)
        .toUpperCase()}`;

      const { error: insertError } = await supabase.from("work_orders").insert({
        work_order_number: woNumber,
        customer_id: contract.customer_id,
        contract_id: contract.id,
        equipment_id: null,
        work_order_type: PM_WORK_ORDER_TYPE,
        visit_kind: "routine_check",
        priority: "Normal",
        status: "Scheduled",
        billing_status: "Unbilled",
        warranty_coverage: "Full Coverage",
        assigned_technician_id: techId,
        scheduled_date: scheduledDate,
        scheduled_start_time: "09:00:00",
        problem_description: `${tag} Contractual preventive maintenance — ${contract.name}`,
        requested_service: "Preventive maintenance visit",
        created_by: options.userId ?? null,
      });

      if (insertError) {
        if (isContractDispatchBlockedError(insertError.message)) {
          await notifyContractDispatchBlocked(supabase, {
            customerId: contract.customer_id,
            contractId: contract.id,
            contractName: contract.name,
            contractStatus: contract.status,
            workOrderNumber: woNumber,
            actorUserId: options.userId ?? null,
          });
        }
        errors.push(`${contract.name} (${ym}): ${insertError.message}`);
        continue;
      }
      existingKeys.add(key);
      created += 1;
    }
  }

  return { ok: true, created, skipped, errors };
}

export type CreateRoutineVisitResult =
  | {
      ok: true;
      workOrderId: string;
      workOrderNumber: string;
      reused: boolean;
      suggestedMonth: string | null;
      suggestedDate: string | null;
      scheduleHref: string;
      criteriaSummary: string;
    }
  | { ok: false; error: string };

export type RoutineVisitCriteria = {
  packName: string | null;
  tierName: string | null;
  tierId: string | null;
  bandLabel: string | null;
  frequency: string;
  visitsPerYear: number;
  sla: string | null;
  suggestedMonth: string | null;
  /** Preferred calendar day to start from (mid-month of suggested window). */
  suggestedDate: string | null;
  summaryLines: string[];
  summaryText: string;
};

type ContractForRoutine = Pick<
  ServiceContract,
  | "id"
  | "name"
  | "customer_id"
  | "start_date"
  | "end_date"
  | "service_frequency"
  | "included_service_visits"
  | "status"
  | "notes"
  | "emergency_response_commitment"
  | "contract_type"
>;

/** Gold / Silver / Bronze checkup requirements from plan snapshot + contract fields. */
export function routineVisitCriteriaFromContract(
  contract: ContractForRoutine,
  asOf: Date = new Date(),
): RoutineVisitCriteria {
  const snap = parsePlanSnapshotFromNotes(contract.notes);
  let frequency = (contract.service_frequency ?? "").trim();
  let visitsPerYear = Number(contract.included_service_visits) || 0;
  let sla = (contract.emergency_response_commitment ?? "").trim() || null;

  if (snap) {
    const packId = resolvePackIdFromSnapshot(snap);
    const resolved = packId
      ? resolvePlan(packId, snap.tierId, snap.assetValue)
      : null;
    if (resolved) {
      if (!frequency) frequency = (resolved.thresholds.service_frequency ?? "").trim();
      if (!visitsPerYear) {
        visitsPerYear = Number(resolved.thresholds.included_service_visits) || 0;
      }
      if (!sla) {
        sla = (resolved.thresholds.emergency_response_commitment ?? "").trim() || null;
      }
    }
  }

  if (!frequency) frequency = "Per contract";

  const effectiveContract = {
    ...contract,
    service_frequency: frequency,
    included_service_visits: visitsPerYear,
  };
  const suggestedMonth = nextRoutineVisitMonth(effectiveContract, asOf);
  const suggestedDate = suggestedMonth ? `${suggestedMonth}-15` : format(asOf, "yyyy-MM-dd");

  const summaryLines: string[] = [];
  if (snap) {
    summaryLines.push(
      `Plan: ${snap.packName} · ${snap.tierName} (${snap.tierId}) · ${snap.bandLabel}`,
    );
  }
  summaryLines.push(`Checkups: ${frequency}${visitsPerYear > 0 ? ` · ${visitsPerYear}/year` : ""}`);
  if (sla) summaryLines.push(`Response commitment: ${sla}`);
  if (contract.contract_type) summaryLines.push(`Contract type: ${contract.contract_type}`);
  if (suggestedMonth) {
    summaryLines.push(`Next contractual window: ${suggestedMonth} (prefer around ${suggestedDate})`);
  }

  return {
    packName: snap?.packName ?? null,
    tierName: snap?.tierName ?? null,
    tierId: snap?.tierId ?? null,
    bandLabel: snap?.bandLabel ?? null,
    frequency,
    visitsPerYear,
    sla,
    suggestedMonth,
    suggestedDate,
    summaryLines,
    summaryText: summaryLines.join("\n"),
  };
}

/** Next contractual PM month on/after today (yyyy-MM), or null if frequency unknown. */
export function nextRoutineVisitMonth(
  contract: Pick<
    ServiceContract,
    "start_date" | "end_date" | "service_frequency" | "included_service_visits"
  >,
  asOf: Date = new Date(),
): string | null {
  const fromYm = format(asOf, "yyyy-MM");
  const toYm = contract.end_date?.slice(0, 7) || `${asOf.getFullYear() + 1}-12`;
  const months = plannedPmVisitMonths(contract, fromYm, toYm);
  if (months.length) return months[0];
  const earlier = plannedPmVisitMonths(contract, contract.start_date.slice(0, 7), fromYm);
  return earlier.length ? earlier[earlier.length - 1] : null;
}

export function technicianScheduleHrefForWorkOrder(
  workOrderId: string,
  options: {
    /** When true, deep-link opens Schedule & assign with suggested day prefilled. */
    openAssignPanel?: boolean;
    dayIso?: string | null;
    suggestDay?: string | null;
  } = {},
): string {
  const params = new URLSearchParams({ wo: workOrderId });
  if (options.openAssignPanel) {
    params.set("schedule", "1");
    const day = options.dayIso || options.suggestDay;
    if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
      params.set("day", day);
      params.set("suggestDay", day);
    }
  }
  return `/technician?${params.toString()}`;
}

/**
 * Create one Preventive Maintenance work order for a contract, then open
 * Technician Schedule so managers set preferred date/time + assign a tech
 * using Gold/Silver/Bronze checkup criteria.
 */
export async function createRoutineVisitForScheduling(
  supabase: SupabaseClient,
  contract: ContractForRoutine,
  options: { userId?: string | null } = {},
): Promise<CreateRoutineVisitResult> {
  const status = (contract.status ?? "").trim();
  if (!isDispatchableContractStatus(status)) {
    return {
      ok: false,
      error: contractDispatchBlockMessage(status, contract.name),
    };
  }

  const criteria = routineVisitCriteriaFromContract(contract);
  const suggestedMonth = criteria.suggestedMonth;
  const suggestedDate = criteria.suggestedDate;

  const { data: existingRows, error: existErr } = await supabase
    .from("work_orders")
    .select("id, work_order_number, scheduled_date, status, problem_description, work_order_type")
    .eq("contract_id", contract.id)
    .eq("work_order_type", PM_WORK_ORDER_TYPE)
    .is("scheduled_date", null)
    .order("created_at", { ascending: false })
    .limit(8);

  if (existErr) return { ok: false, error: existErr.message };

  const existing = (existingRows ?? []).find((wo) => {
    const st = String(wo.status ?? "").toLowerCase();
    return !["completed", "closed", "canceled", "cancelled"].includes(st);
  });

  if (existing?.id) {
    // Refresh manager notes with current plan criteria
    await supabase
      .from("work_orders")
      .update({
        visit_kind: "routine_check",
        manager_notes: `${criteria.summaryText}\n\nSet the customer’s preferred date & time on this schedule, then assign a technician.`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);

    return {
      ok: true,
      workOrderId: existing.id as string,
      workOrderNumber: (existing.work_order_number as string) ?? "WO",
      reused: true,
      suggestedMonth,
      suggestedDate,
      scheduleHref: technicianScheduleHrefForWorkOrder(existing.id as string),
      criteriaSummary: criteria.summaryText,
    };
  }

  const tag = suggestedMonth ? pmScheduleTag(suggestedMonth) : "[PM-ROUTINE]";
  const tierBit = criteria.tierName ? ` · ${criteria.tierName}` : "";
  const woNumber = `WO-PM${format(new Date(), "yyyyMMdd")}-${Date.now().toString().slice(-5)}`;

  const { data: inserted, error: insertError } = await supabase
    .from("work_orders")
    .insert({
      work_order_number: woNumber,
      customer_id: contract.customer_id,
      contract_id: contract.id,
      equipment_id: null,
      work_order_type: PM_WORK_ORDER_TYPE,
      visit_kind: "routine_check",
      priority: "Normal",
      status: "Requested",
      billing_status: "Unbilled",
      warranty_coverage: "Full Coverage",
      assigned_technician_id: null,
      scheduled_date: null,
      scheduled_start_time: null,
      problem_description: `${tag} Routine checkup${tierBit} — ${contract.name} (${criteria.frequency})`,
      requested_service: `Routine / preventive maintenance (${criteria.frequency})`,
      manager_notes: `${criteria.summaryText}\n\nSet the customer’s preferred date & time on this schedule, then assign a technician.`,
      created_by: options.userId ?? null,
    })
    .select("id, work_order_number")
    .single();

  if (insertError || !inserted) {
    const msg = insertError?.message ?? "Could not create routine visit work order.";
    if (insertError && isContractDispatchBlockedError(insertError.message)) {
      await notifyContractDispatchBlocked(supabase, {
        customerId: contract.customer_id,
        contractId: contract.id,
        contractName: contract.name,
        contractStatus: contract.status,
        workOrderNumber: woNumber,
        actorUserId: options.userId ?? null,
      });
    }
    return { ok: false, error: msg };
  }

  return {
    ok: true,
    workOrderId: inserted.id as string,
    workOrderNumber: inserted.work_order_number as string,
    reused: false,
    suggestedMonth,
    suggestedDate,
    scheduleHref: technicianScheduleHrefForWorkOrder(inserted.id as string),
    criteriaSummary: criteria.summaryText,
  };
}

/** Unused import guard helpers kept for callers that compute ranges. */
export function yearMonthRange(year: number): { fromYm: string; toYm: string } {
  return { fromYm: `${year}-01`, toYm: `${year}-12` };
}

export function contractMonthSpan(
  startDate: string,
  endDate: string,
): string[] {
  try {
    const start = startOfMonth(parseISO(startDate));
    const end = endOfMonth(parseISO(endDate));
    if (!isValid(start) || !isValid(end) || end < start) return [];
    return eachMonthOfInterval({ start, end: startOfMonth(end) }).map((d) => format(d, "yyyy-MM"));
  } catch {
    return [];
  }
}
