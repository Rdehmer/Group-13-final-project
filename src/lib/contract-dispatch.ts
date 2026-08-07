/**
 * Block dispatch / new work under expired or canceled contracts; notify customer + staff.
 */

import { logActivity } from "@/lib/activity";
import { isDispatchableContractStatus } from "@/lib/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";

export { isDispatchableContractStatus };

export function contractDispatchBlockMessage(
  status: string,
  contractName?: string | null,
): string {
  const label = contractName?.trim() ? ` "${contractName.trim()}"` : "";
  const s = (status ?? "").trim().toLowerCase();
  if (s.includes("expired")) {
    return `Contract${label} has expired. New dispatch and work orders under this agreement are blocked. Contact EquipmentIQ to renew coverage.`;
  }
  if (s.includes("cancel")) {
    return `Contract${label} is canceled. New work cannot be scheduled under this agreement.`;
  }
  if (s.includes("pending") || s === "draft") {
    return `Contract${label} is not active yet. Dispatch is blocked until the agreement is approved.`;
  }
  return `Contract${label} is not active for dispatch (${status}).`;
}

export function isContractDispatchBlockedError(message: string): boolean {
  return /contract.*(expired|canceled|cancelled|not active|blocked)|dispatch.*blocked/i.test(
    message,
  );
}

export type ContractDispatchNotifyInput = {
  customerId: string;
  contractId: string;
  contractName: string;
  contractStatus: string;
  workOrderNumber?: string | null;
  actorUserId?: string | null;
};

/** Customer inbox thread + staff activity when contract blocks dispatch. */
export async function notifyContractDispatchBlocked(
  supabase: SupabaseClient,
  input: ContractDispatchNotifyInput,
): Promise<void> {
  const msg = contractDispatchBlockMessage(input.contractStatus, input.contractName);
  const woBit = input.workOrderNumber ? ` (work order ${input.workOrderNumber})` : "";

  const { data: thread, error: threadErr } = await supabase
    .from("customer_inbox_threads")
    .insert({
      customer_id: input.customerId,
      subject: `Coverage blocked — ${input.contractName}`,
      category: "contract",
      status: "open",
    })
    .select("id")
    .single();

  if (!threadErr && thread?.id) {
    await supabase.from("customer_inbox_messages").insert({
      thread_id: thread.id,
      sender_role: "staff",
      sender_profile_id: input.actorUserId ?? null,
      body: `${msg}${woBit}\n\nYour service manager has been notified. Reply here or call EquipmentIQ to renew or start a billable (out-of-contract) visit.`,
    });
  }

  await logActivity(supabase, {
    userId: input.actorUserId ?? null,
    action: "contract_dispatch_blocked",
    recordType: "service_contract",
    recordId: input.contractId,
    newValue: `${input.contractStatus}${woBit}`,
  });
}
