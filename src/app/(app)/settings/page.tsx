"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, ClipboardList, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState } from "@/components/ui";
import type { CompanySettings } from "@/lib/types";

const DEFAULT_SETTINGS = {
  company_name: "Ridley Equipment Services",
  support_email: null as string | null,
  default_tax_rate: 0.0825,
  overtime_multiplier: 1.5,
};

export default function SettingsPage() {
  const supabase = createClient();
  const [settings, setSettings] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from("company_settings")
      .select("*")
      .limit(1)
      .maybeSingle();
    if (error) {
      setLoadError(error.message);
      setSettings(null);
    } else {
      setSettings((data as CompanySettings | null) ?? null);
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  async function initializeSettings() {
    setInitializing(true);
    setMessage(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("company_settings")
      .insert({
        company_name: DEFAULT_SETTINGS.company_name,
        support_email: DEFAULT_SETTINGS.support_email,
        default_tax_rate: DEFAULT_SETTINGS.default_tax_rate,
        overtime_multiplier: DEFAULT_SETTINGS.overtime_multiplier,
      })
      .select("*")
      .single();
    if (error) {
      setMessage(error.message);
      setInitializing(false);
      return;
    }
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "created",
      recordType: "company_settings",
      recordId: (data as CompanySettings).id,
    });
    setSettings(data as CompanySettings);
    setMessage("Company settings initialized.");
    setInitializing(false);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("company_settings")
      .update({
        company_name: settings.company_name,
        support_email: settings.support_email,
        default_tax_rate: settings.default_tax_rate,
        overtime_multiplier: settings.overtime_multiplier,
        updated_at: new Date().toISOString(),
      })
      .eq("id", settings.id);
    if (error) setMessage(error.message);
    else {
      await logActivity(supabase, {
        userId: user?.id ?? null,
        action: "updated",
        recordType: "company_settings",
        recordId: settings.id,
      });
      setMessage("Settings saved.");
    }
    setSaving(false);
  }

  if (loading) {
    return <div className="p-8 text-center opacity-60">Loading…</div>;
  }

  if (!settings) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Settings"
          description="Company-wide configuration (administrator)"
          actions={
            <div className="flex flex-wrap gap-2">
              <Link href="/settings/employees" className="btn btn-outline btn-sm gap-1">
                <Users className="h-4 w-4" /> Employees
              </Link>
              <Link href="/settings/gl-accounts" className="btn btn-outline btn-sm gap-1">
                <BookOpen className="h-4 w-4" /> GL Accounts
              </Link>
              <Link href="/settings/contract-plans" className="btn btn-outline btn-sm gap-1">
                <ClipboardList className="h-4 w-4" /> Contract Plans
              </Link>
            </div>
          }
        />
        {message ? (
          <div role="alert" className="alert alert-error mb-4 text-sm">
            <span>{message}</span>
          </div>
        ) : null}
        {loadError ? (
          <div role="alert" className="alert alert-error mb-4 text-sm">
            <span>{loadError}</span>
          </div>
        ) : null}
        <div className="card max-w-xl bg-base-100 shadow">
          <div className="card-body">
            <EmptyState
              title="Company settings aren’t set up yet"
              description="Initialize company profile, tax rate, and overtime defaults so billing and payroll use the right values."
              action={
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={initializing}
                  onClick={() => void initializeSettings()}
                >
                  {initializing ? "Initializing…" : "Initialize settings"}
                </button>
              }
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Company-wide configuration (administrator)"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/settings/employees" className="btn btn-outline btn-sm gap-1">
              <Users className="h-4 w-4" /> Employees
            </Link>
            <Link href="/settings/gl-accounts" className="btn btn-outline btn-sm gap-1">
              <BookOpen className="h-4 w-4" /> GL Accounts
            </Link>
            <Link href="/settings/contract-plans" className="btn btn-outline btn-sm gap-1">
              <ClipboardList className="h-4 w-4" /> Contract Plans
            </Link>
          </div>
        }
      />

      {message ? (
        <div role="alert" className="alert mb-4 text-sm">
          <span>{message}</span>
        </div>
      ) : null}

      <form onSubmit={onSave} className="card max-w-xl bg-base-100 shadow">
        <div className="card-body space-y-3">
          <FormRow label="Company" required>
            <input
              className="input input-bordered w-full"
              value={settings.company_name}
              onChange={(e) => setSettings({ ...settings, company_name: e.target.value })}
              required
            />
          </FormRow>
          <FormRow label="Support email">
            <input
              type="email"
              className="input input-bordered w-full"
              value={settings.support_email ?? ""}
              onChange={(e) => setSettings({ ...settings, support_email: e.target.value })}
            />
          </FormRow>
          <FormRow label="Tax rate">
            <input
              type="number"
              min="0"
              max="1"
              step="0.0001"
              className="input input-bordered w-full"
              value={settings.default_tax_rate}
              onChange={(e) =>
                setSettings({ ...settings, default_tax_rate: Number(e.target.value) })
              }
            />
          </FormRow>
          <FormRow label="OT multiplier">
            <input
              type="number"
              min="1"
              step="0.1"
              className="input input-bordered w-full"
              value={settings.overtime_multiplier}
              onChange={(e) =>
                setSettings({ ...settings, overtime_multiplier: Number(e.target.value) })
              }
            />
          </FormRow>
          <button type="submit" className="btn btn-primary btn-sm w-fit" disabled={saving}>
            {saving ? "Saving…" : "Save Settings"}
          </button>
        </div>
      </form>

      <div className="card max-w-xl border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body gap-2">
          <h2 className="card-title text-base">Employees</h2>
          <p className="text-sm opacity-70">
            Store staff contact data, hourly cost/billing rates, and module permissions (role package +
            overrides).
          </p>
          <Link href="/settings/employees" className="btn btn-primary btn-sm w-fit gap-1">
            <Users className="h-4 w-4" /> Open Employees
          </Link>
        </div>
      </div>

      <div className="card max-w-xl border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body gap-2">
          <h2 className="card-title text-base">Accounting</h2>
          <p className="text-sm opacity-70">
            Maintain the chart of accounts and default GL mappings for journal export and reporting.
          </p>
          <Link href="/settings/gl-accounts" className="btn btn-primary btn-sm w-fit gap-1">
            <BookOpen className="h-4 w-4" /> Open GL Accounts
          </Link>
        </div>
      </div>
    </div>
  );
}
