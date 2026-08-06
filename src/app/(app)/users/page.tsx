"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import { isStaffRole } from "@/lib/employeePermissions";
import { ROLE_LABELS, type Profile, type UserRole } from "@/lib/types";

export default function UsersPage() {
  const supabase = createClient();
  const [users, setUsers] = useState<Profile[]>([]);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    const { data } = await supabase.from("profiles").select("*").order("email");
    setUsers((data as Profile[]) ?? []);
  }

  useEffect(() => { load(); }, []);

  async function updateRole(userId: string, role: UserRole, prev: UserRole) {
    setSaving(userId);
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("profiles").update({ role, updated_at: new Date().toISOString() }).eq("id", userId);
    await logActivity(supabase, { userId: user?.id ?? null, action: "role_change", recordType: "profile", recordId: userId, previousValue: prev, newValue: role });
    await load();
    setSaving(null);
  }

  async function toggleActive(userId: string, isActive: boolean) {
    setSaving(userId);
    await supabase.from("profiles").update({ is_active: !isActive, updated_at: new Date().toISOString() }).eq("id", userId);
    await load();
    setSaving(null);
  }

  return (
    <div>
      <PageHeader
        title="Users"
        description="Assign roles and manage access"
        actions={
          <Link href="/settings/employees" className="btn btn-outline btn-sm">
            Employee rates & permissions
          </Link>
        }
      />

      <div className="card bg-base-100 shadow">
        <div className="card-body p-0">
          {users.length === 0 ? (
            <div className="p-6"><EmptyState title="No users found" description="User profiles are created on sign-up." /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id}>
                      <td>{u.full_name ?? "—"}</td>
                      <td>{u.email}</td>
                      <td>
                        <select
                          className="select select-bordered select-sm"
                          value={u.role}
                          disabled={saving === u.id}
                          onChange={(e) => updateRole(u.id, e.target.value as UserRole, u.role)}
                        >
                          {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                          ))}
                        </select>
                      </td>
                      <td><StatusBadge label={u.is_active ? "Active" : "Inactive"} tone={statusTone(u.is_active ? "Active" : "Inactive")} /></td>
                      <td className="flex flex-wrap gap-1">
                        <button type="button" className="btn btn-ghost btn-xs" disabled={saving === u.id} onClick={() => toggleActive(u.id, u.is_active)}>
                          {u.is_active ? "Deactivate" : "Activate"}
                        </button>
                        {isStaffRole(u.role) ? (
                          <Link href={`/settings/employees/${u.id}`} className="btn btn-ghost btn-xs">
                            Rates & perms
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
