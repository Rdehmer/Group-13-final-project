/** Values allowed by work_orders.work_order_type_check in Postgres. */
export const WORK_ORDER_TYPES = [
  "Preventive Maintenance",
  "Emergency Repair",
  "Repair",
  "Inspection",
  "Warranty Repair",
  "Installation",
  "Follow-Up Service",
] as const;

export type WorkOrderType = (typeof WORK_ORDER_TYPES)[number];

export function isWorkOrderType(value: string): value is WorkOrderType {
  return (WORK_ORDER_TYPES as readonly string[]).includes(value);
}

/** Schedule queue grouping for manager unscheduled work orders. */
export type ScheduleVisitKind = "routine_check" | "one_time_repair" | "emergency";

export const SCHEDULE_VISIT_KINDS: ScheduleVisitKind[] = [
  "routine_check",
  "one_time_repair",
  "emergency",
];

export function isScheduleVisitKind(value: string): value is ScheduleVisitKind {
  return (SCHEDULE_VISIT_KINDS as readonly string[]).includes(value);
}

export function scheduleVisitKind(wo: {
  visit_kind?: string | null;
  work_order_type?: string | null;
  priority?: string | null;
}): ScheduleVisitKind {
  if (wo.visit_kind && isScheduleVisitKind(wo.visit_kind)) {
    return wo.visit_kind;
  }
  if (wo.priority === "Critical" || wo.work_order_type === "Emergency Repair") {
    return "emergency";
  }
  if (wo.work_order_type === "Preventive Maintenance") {
    return "routine_check";
  }
  return "one_time_repair";
}

/** Map customer portal / contract actions to the three schedule visit kinds. */
export function visitKindFromServiceKind(
  serviceKind: string,
  options: {
    equipmentRunning?: "yes" | "no" | "";
    workOrderType?: string | null;
    priority?: string | null;
  } = {},
): ScheduleVisitKind {
  if (serviceKind === "routine") return "routine_check";
  if (serviceKind === "emergency_repair") return "emergency";
  if (
    options.workOrderType === "Emergency Repair" ||
    options.priority === "Critical" ||
    (serviceKind === "repair" && options.equipmentRunning === "no")
  ) {
    return "emergency";
  }
  return "one_time_repair";
}

export function scheduleVisitKindLabel(kind: ScheduleVisitKind): string {
  switch (kind) {
    case "routine_check":
      return "Routine check";
    case "one_time_repair":
      return "One-time repair";
    case "emergency":
      return "Emergency";
  }
}

export function scheduleVisitKindBadgeClass(kind: ScheduleVisitKind): string {
  switch (kind) {
    case "routine_check":
      return "badge-info";
    case "one_time_repair":
      return "badge-ghost";
    case "emergency":
      return "badge-error";
  }
}
