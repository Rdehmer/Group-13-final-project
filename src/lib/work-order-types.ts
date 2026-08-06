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
