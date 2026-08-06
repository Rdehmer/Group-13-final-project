import { formatServiceDate } from "@/lib/invoices";
import { customerRequestStageLabel } from "@/lib/work-order-status";

export type FollowUpWorkOrderContext = {
  work_order_number: string;
  work_order_type: string;
  status: string;
  scheduled_date?: string | null;
  equipment_name?: string | null;
};

function stageSpecificAsk(status: string): string {
  switch (status) {
    case "Requested":
      return "Could you share an update on review and when scheduling might begin?";
    case "Awaiting Approval":
    case "Assigned":
      return "Please confirm the visit window or let me know if the date has changed.";
    case "Scheduled":
      return "Please confirm the visit window or let me know if the date has changed.";
    case "In Progress":
    case "Ready for Review":
      return "Is there anything you need from me on-site, or an updated completion estimate?";
    case "Waiting on Parts":
      return "Can you share the parts ETA and whether the visit will need to be rescheduled?";
    case "Completed":
    case "Closed":
      return "I wanted to follow up now that this visit shows as completed.";
    default:
      return "Could you share a quick update on where things stand?";
  }
}

export function buildFollowUpDraft(wo: FollowUpWorkOrderContext): string {
  const stage = customerRequestStageLabel(wo.status);
  const equipmentPart = wo.equipment_name ? ` · ${wo.equipment_name}` : "";
  const scheduledPart = wo.scheduled_date
    ? ` (scheduled ${formatServiceDate(wo.scheduled_date)})`
    : "";

  return [
    "Hi EquipmentIQ team,",
    "",
    `I'm following up on work order ${wo.work_order_number} (${wo.work_order_type}${equipmentPart}).`,
    "",
    `The portal shows this request at the "${stage}" stage${scheduledPart}.`,
    "",
    stageSpecificAsk(wo.status),
    "",
    "Thank you.",
  ].join("\n");
}

export function followUpContextFromWorkOrder(wo: {
  work_order_number: string;
  work_order_type: string;
  status: string;
  scheduled_date?: string | null;
  equipment?: { name: string } | null;
}): FollowUpWorkOrderContext {
  return {
    work_order_number: wo.work_order_number,
    work_order_type: wo.work_order_type,
    status: wo.status,
    scheduled_date: wo.scheduled_date,
    equipment_name: wo.equipment?.name ?? null,
  };
}
