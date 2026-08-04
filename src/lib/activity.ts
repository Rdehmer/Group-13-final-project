import type { SupabaseClient } from "@supabase/supabase-js";

type LogActivityInput = {
  userId: string | null;
  action: string;
  recordType: string;
  recordId?: string | null;
  previousValue?: string | null;
  newValue?: string | null;
};

/**
 * This business faces untracked operational change risk.
 * Our app reduces the risk by recording who changed what and when.
 */
export async function logActivity(
  supabase: SupabaseClient,
  input: LogActivityInput,
) {
  await supabase.from("activity_logs").insert({
    user_id: input.userId,
    action: input.action,
    record_type: input.recordType,
    record_id: input.recordId ?? null,
    previous_value: input.previousValue ?? null,
    new_value: input.newValue ?? null,
  });
}
