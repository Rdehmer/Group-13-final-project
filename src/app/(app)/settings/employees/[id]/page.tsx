"use client";

/**
 * Employee detail — identity, hourly rates, role template + permission matrix.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, AlertTriangle, RotateCcw, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import {
  ALL_PERMISSION_KEYS,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  effectivePermissionMap,
  isOverrideActive,
  roleDefaultPermissions,
  staffRoles,
} from "@/lib/employeePermissions";
import { getEmployee, saveEmployee } from "@/lib/employees";
import {
  ROLE_LABELS,
  type PermissionKey,
  type PermissionOverrides,
  type UserRole,
} from "@/lib/types";

export default function EmployeeDetailPage() {
  const params = useParams();
  const id = String(params.id ?? "");
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [localExtras, setLocalExtras] = useState(false);

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    role: "technician" as UserRole,
    is_active: true,
    job_title: "",
    phone: "",
    employee_number: "",
    hourly_cost_rate: "",
    hourly_billing_rate: "",
    overrides: {} as PermissionOverrides,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getEmployee(supabase, id);
    if (res.error || !res.data) {
      setError(res.error ?? "Not found");
      setLoading(false);
      return;
    }
    const p = res.data;
    setForm({
      full_name: p.full_name ?? "",
      email: p.email,
      role: p.role,
      is_active: p.is_active,
      job_title: p.job_title ?? "",
      phone: p.phone ?? "",
      employee_number: p.employee_number ?? "",
      hourly_cost_rate: p.hourly_cost_rate != null ? String(p.hourly_cost_rate) : "",
      hourly_billing_rate: p.hourly_billing_rate != null ? String(p.hourly_billing_rate) : "",
      overrides: { ...(p.permission_overrides ?? {}) },
    });
    setLoading(false);
  }, [supabase, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const effective = useMemo(
    () => effectivePermissionMap(form.role, form.overrides),
    [form.role, form.overrides],
  );

  function setOverride(key: PermissionKey, granted: boolean) {
    const roleHas = roleDefaultPermissions(form.role).has(key);
    setForm((f) => {
      const next = { ...f.overrides };
      // If checkbox matches role default, drop override
      if (granted === roleHas) {
        delete next[key];
      } else {
        next[key] = granted;
      }
      return { ...f, overrides: next };
    });
  }

  function resetOverrides() {
    setForm((f) => ({ ...f, overrides: {} }));
  }

  function applyRoleTemplate(role: UserRole) {
    setForm((f) => ({ ...f, role, overrides: {} }));
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);

    const cost =
      form.hourly_cost_rate.trim() === "" ? null : Number(form.hourly_cost_rate);
    const bill =
      form.hourly_billing_rate.trim() === "" ? null : Number(form.hourly_billing_rate);
    if (cost != null && (Number.isNaN(cost) || cost < 0)) {
      setError("Hourly cost rate must be a non-negative number.");
      setBusy(false);
      return;
    }
    if (bill != null && (Number.isNaN(bill) || bill < 0)) {
      setError("Hourly billing rate must be a non-negative number.");
      setBusy(false);
      return;
    }

    const { data: userData } = await supabase.auth.getUser();
    const res = await saveEmployee(supabase, id, {
      full_name: form.full_name.trim() || null,
      role: form.role,
      is_active: form.is_active,
      hourly_cost_rate: cost,
      hourly_billing_rate: bill,
      job_title: form.job_title.trim() || null,
      phone: form.phone.trim() || null,
      employee_number: form.employee_number.trim() || null,
      permission_overrides: form.overrides,
    });

    if (res.error) {
      setError(res.error);
      setBusy(false);
      return;
    }

    setLocalExtras(res.usedLocalExtras);
    await logActivity(supabase, {
      userId: userData.user?.id ?? null,
      action: "updated",
      recordType: "employee",
      recordId: id,
      newValue: form.role,
    });
    setMessage(
      res.usedLocalExtras
        ? "Saved (core profile remote; title/phone/permissions in this browser until migration runs)."
        : "Employee saved.",
    );
    await load();
    setBusy(false);
  }

  if (loading) {
    return <p className="p-8 text-center text-sm opacity-50">Loading employee…</p>;
  }

  if (error && !form.email) {
    return (
      <div className="space-y-4">
        <div className="alert alert-error text-sm">{error}</div>
        <Link href="/settings/employees" className="btn btn-ghost btn-sm">
          Back to employees
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={form.full_name || form.email || "Employee"}
        description="Employee data, labor rates, and module permissions"
        actions={
          <Link href="/settings/employees" className="btn btn-ghost btn-sm gap-1">
            <ArrowLeft className="h-4 w-4" /> All employees
          </Link>
        }
      />

      {localExtras ? (
        <div className="alert alert-warning text-sm">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            Extended fields used browser storage. Apply{" "}
            <code className="text-xs">20260806_employee_data.sql</code> for shared DB storage.
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="alert alert-error text-sm">
          <span>{error}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {message ? (
        <div className="alert alert-success text-sm">
          <span>{message}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMessage(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      <form onSubmit={onSave} className="space-y-5">
        {/* Identity */}
        <section className="card max-w-3xl bg-base-100 shadow">
          <div className="card-body gap-3">
            <h2 className="card-title text-base">Profile</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormRow label="Full name">
                <input
                  className="input input-bordered input-sm w-full"
                  value={form.full_name}
                  onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                />
              </FormRow>
              <FormRow label="Email">
                <input className="input input-bordered input-sm w-full opacity-70" value={form.email} readOnly />
              </FormRow>
              <FormRow label="Employee #">
                <input
                  className="input input-bordered input-sm w-full font-mono"
                  value={form.employee_number}
                  onChange={(e) => setForm((f) => ({ ...f, employee_number: e.target.value }))}
                  placeholder="Optional"
                />
              </FormRow>
              <FormRow label="Job title">
                <input
                  className="input input-bordered input-sm w-full"
                  value={form.job_title}
                  onChange={(e) => setForm((f) => ({ ...f, job_title: e.target.value }))}
                  placeholder="e.g. Field Technician"
                />
              </FormRow>
              <FormRow label="Phone">
                <input
                  className="input input-bordered input-sm w-full"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </FormRow>
              <FormRow label="Status">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="toggle toggle-sm toggle-success"
                    checked={form.is_active}
                    onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  />
                  {form.is_active ? "Active" : "Inactive"}
                </label>
              </FormRow>
            </div>
          </div>
        </section>

        {/* Rates */}
        <section className="card max-w-3xl bg-base-100 shadow">
          <div className="card-body gap-3">
            <h2 className="card-title text-base">Labor rates</h2>
            <p className="text-xs opacity-55">
              Defaults when logging time on work orders (cost for jobs/COGS, billing for customer line).
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormRow label="Hourly cost">
                <label className="input input-bordered input-sm flex items-center gap-2">
                  <span className="opacity-50">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="grow"
                    value={form.hourly_cost_rate}
                    onChange={(e) => setForm((f) => ({ ...f, hourly_cost_rate: e.target.value }))}
                    placeholder="e.g. 45.00"
                  />
                  <span className="text-xs opacity-50">/hr</span>
                </label>
              </FormRow>
              <FormRow label="Hourly billing">
                <label className="input input-bordered input-sm flex items-center gap-2">
                  <span className="opacity-50">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    className="grow"
                    value={form.hourly_billing_rate}
                    onChange={(e) => setForm((f) => ({ ...f, hourly_billing_rate: e.target.value }))}
                    placeholder="e.g. 95.00"
                  />
                  <span className="text-xs opacity-50">/hr</span>
                </label>
              </FormRow>
            </div>
          </div>
        </section>

        {/* Role + permissions */}
        <section className="card max-w-3xl bg-base-100 shadow">
          <div className="card-body gap-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="card-title text-base">Access & permissions</h2>
                <p className="text-xs opacity-55">
                  Role packages set the default matrix. Checkboxes add overrides (grant or revoke)
                  without changing the role.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-xs gap-1"
                onClick={resetOverrides}
                disabled={Object.keys(form.overrides).length === 0}
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset to role defaults
              </button>
            </div>

            <FormRow label="Role package">
              <select
                className="select select-bordered select-sm w-full max-w-xs"
                value={form.role}
                onChange={(e) => applyRoleTemplate(e.target.value as UserRole)}
              >
                {staffRoles().map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
                {form.role === "customer" ? (
                  <option value="customer">{ROLE_LABELS.customer}</option>
                ) : null}
              </select>
            </FormRow>

            {PERMISSION_GROUPS.map((group) => (
              <div key={group.id} className="rounded-xl border border-base-200">
                <div className="border-b border-base-200 bg-base-200/40 px-3 py-2 text-sm font-semibold">
                  {group.label}
                </div>
                <ul className="divide-y divide-base-200">
                  {group.keys.map((key) => {
                    const granted = effective[key];
                    const overridden = isOverrideActive(form.role, form.overrides, key);
                    return (
                      <li
                        key={key}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-medium">{PERMISSION_LABELS[key]}</p>
                          <p className="text-[11px] opacity-45">
                            Role default:{" "}
                            {roleDefaultPermissions(form.role).has(key) ? "Allow" : "Deny"}
                            {overridden ? (
                              <span className="ml-1 text-warning">· overridden</span>
                            ) : null}
                          </p>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-sm">
                          <span className="opacity-60">{granted ? "Allow" : "Deny"}</span>
                          <input
                            type="checkbox"
                            className="toggle toggle-sm toggle-primary"
                            checked={granted}
                            onChange={(e) => setOverride(key, e.target.checked)}
                            disabled={form.role === "customer"}
                          />
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            <p className="text-[11px] opacity-45">
              {Object.keys(form.overrides).length} custom override(s) ·{" "}
              {ALL_PERMISSION_KEYS.filter((k) => effective[k]).length} modules allowed
            </p>
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primary btn-sm gap-1" disabled={busy}>
            <Save className="h-4 w-4" />
            {busy ? "Saving…" : "Save employee"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => router.push("/settings/employees")}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
