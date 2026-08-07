/**
 * Staff employee profile load/save for Settings → Employees.
 * Extends optional columns with a browser fallback when migration is not applied.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PermissionOverrides,
  Profile,
  UserRole,
} from "@/lib/types";
import { isStaffRole, normalizeOverrides } from "@/lib/employeePermissions";

const LOCAL_KEY = "equipmentiq_employee_extras_v1";

type EmployeeExtras = {
  job_title?: string | null;
  phone?: string | null;
  employee_number?: string | null;
  permission_overrides?: PermissionOverrides;
};

type LocalStore = Record<string, EmployeeExtras>;

function readLocal(): LocalStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as LocalStore;
  } catch {
    return {};
  }
}

function writeLocal(store: LocalStore) {
  if (typeof window === "undefined") return;
  localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
}

function mergeExtras(profile: Profile): Profile {
  const extra = readLocal()[profile.id];
  if (!extra) {
    return {
      ...profile,
      permission_overrides: normalizeOverrides(profile.permission_overrides),
    };
  }
  return {
    ...profile,
    job_title: profile.job_title ?? extra.job_title ?? null,
    phone: profile.phone ?? extra.phone ?? null,
    employee_number: profile.employee_number ?? extra.employee_number ?? null,
    permission_overrides: normalizeOverrides(
      profile.permission_overrides && Object.keys(profile.permission_overrides).length
        ? profile.permission_overrides
        : extra.permission_overrides,
    ),
  };
}

function isMissingColumnError(message: string | null | undefined): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    m.includes("permission_overrides") ||
    m.includes("job_title") ||
    m.includes("employee_number") ||
    m.includes("column") ||
    m.includes("schema cache") ||
    m.includes("could not find")
  );
}

export type EmployeeSaveInput = {
  full_name: string | null;
  role: UserRole;
  is_active: boolean;
  hourly_cost_rate: number | null;
  hourly_billing_rate: number | null;
  job_title: string | null;
  phone: string | null;
  employee_number: string | null;
  permission_overrides: PermissionOverrides;
};

export async function listEmployees(
  supabase: SupabaseClient,
): Promise<{ data: Profile[]; error: string | null; extrasLocal: boolean }> {
  const { data, error } = await supabase.from("profiles").select("*").order("full_name").order("email");
  if (error) return { data: [], error: error.message, extrasLocal: false };

  let extrasLocal = false;
  const all = ((data as Profile[]) ?? []).map((p) => {
    const merged = mergeExtras(p);
    if (readLocal()[p.id]) extrasLocal = true;
    return merged;
  });

  const staff = all.filter((p) => isStaffRole(p.role));
  return { data: staff, error: null, extrasLocal };
}

export async function getEmployee(
  supabase: SupabaseClient,
  id: string,
): Promise<{ data: Profile | null; error: string | null }> {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (error) return { data: null, error: error.message };
  if (!data) return { data: null, error: "Employee not found." };
  const profile = mergeExtras(data as Profile);
  if (!isStaffRole(profile.role) && profile.role === "customer") {
    return { data: profile, error: null };
  }
  return { data: profile, error: null };
}

export async function saveEmployee(
  supabase: SupabaseClient,
  id: string,
  input: EmployeeSaveInput,
): Promise<{ error: string | null; usedLocalExtras: boolean }> {
  const base = {
    full_name: input.full_name,
    role: input.role,
    is_active: input.is_active,
    hourly_cost_rate: input.hourly_cost_rate,
    hourly_billing_rate: input.hourly_billing_rate,
    updated_at: new Date().toISOString(),
  };

  const extended = {
    ...base,
    job_title: input.job_title,
    phone: input.phone,
    employee_number: input.employee_number,
    permission_overrides: normalizeOverrides(input.permission_overrides),
  };

  const { error: fullErr } = await supabase.from("profiles").update(extended).eq("id", id);
  if (!fullErr) {
    // Clear local extras for this user; remote is source of truth
    const store = readLocal();
    if (store[id]) {
      delete store[id];
      writeLocal(store);
    }
    return { error: null, usedLocalExtras: false };
  }

  // Columns missing: save core profile fields + local extras
  if (isMissingColumnError(fullErr.message)) {
    const { error: coreErr } = await supabase.from("profiles").update(base).eq("id", id);
    if (coreErr) return { error: coreErr.message, usedLocalExtras: false };

    const store = readLocal();
    store[id] = {
      job_title: input.job_title,
      phone: input.phone,
      employee_number: input.employee_number,
      permission_overrides: normalizeOverrides(input.permission_overrides),
    };
    writeLocal(store);
    return { error: null, usedLocalExtras: true };
  }

  return { error: fullErr.message, usedLocalExtras: false };
}

export function formatMoneyRate(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `$${Number(value).toFixed(2)}/hr`;
}
