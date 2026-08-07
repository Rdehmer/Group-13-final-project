"use client";

/**
 * Admin Chart of Accounts — Executive/Management branch only.
 * Manage GL accounts and default posting mappings for export/reports.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { DualHorizontalScroll } from "@/components/DualHorizontalScroll";
import { EmptyState, StatusBadge } from "@/components/ui";
import {
  GL_ACCOUNT_TYPES,
  createGlAccount,
  defaultNormalBalance,
  deleteGlAccount,
  ensureGlSeed,
  formatGlAccountLabel,
  listGlAccounts,
  listGlPostingDefaults,
  setPostingDefaultAccount,
  updateGlAccount,
} from "@/lib/glAccounts";
import type { GlAccount, GlAccountType, GlNormalBalance, GlPostingDefault } from "@/lib/types";

export default function GlAccountsSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [accounts, setAccounts] = useState<GlAccount[]>([]);
  const [defaults, setDefaults] = useState<GlPostingDefault[]>([]);
  const [typeFilter, setTypeFilter] = useState<GlAccountType | "all">("all");
  const [showInactive, setShowInactive] = useState(false);

  const [form, setForm] = useState({
    account_code: "",
    account_name: "",
    account_type: "asset" as GlAccountType,
    normal_balance: "debit" as GlNormalBalance,
    description: "",
    sort_order: "200",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    await ensureGlSeed(supabase);
    const [a, d] = await Promise.all([listGlAccounts(supabase), listGlPostingDefaults(supabase)]);
    if (a.error) setError(a.error);
    else if (d.error) setError(d.error);
    setAccounts(a.data);
    setDefaults(d.data);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    return accounts.filter((a) => {
      if (typeFilter !== "all" && a.account_type !== typeFilter) return false;
      if (!showInactive && !a.is_active) return false;
      return true;
    });
  }, [accounts, typeFilter, showInactive]);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const { data: userData } = await supabase.auth.getUser();
    const res = await createGlAccount(supabase, {
      account_code: form.account_code,
      account_name: form.account_name,
      account_type: form.account_type,
      normal_balance: form.normal_balance,
      description: form.description || null,
      sort_order: Number(form.sort_order) || 200,
    });
    if (res.error || !res.data) {
      setError(res.error ?? "Could not create account");
      setBusy(false);
      return;
    }
    await logActivity(supabase, {
      userId: userData.user?.id ?? null,
      action: "created",
      recordType: "gl_account",
      recordId: res.data.id,
      newValue: res.data.account_code,
    });
    setForm({
      account_code: "",
      account_name: "",
      account_type: "asset",
      normal_balance: "debit",
      description: "",
      sort_order: "200",
    });
    setMessage(`Created ${formatGlAccountLabel(res.data)}`);
    await load();
    setBusy(false);
  }

  async function toggleActive(acc: GlAccount) {
    setBusy(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const { error: err } = await updateGlAccount(supabase, acc.id, { is_active: !acc.is_active });
    if (err) setError(err);
    else {
      await logActivity(supabase, {
        userId: userData.user?.id ?? null,
        action: acc.is_active ? "deactivated" : "activated",
        recordType: "gl_account",
        recordId: acc.id,
        newValue: acc.account_code,
      });
      await load();
    }
    setBusy(false);
  }

  async function onDelete(acc: GlAccount) {
    if (acc.is_system) {
      setError("System accounts cannot be deleted.");
      return;
    }
    if (!confirm(`Delete GL account ${acc.account_code} ${acc.account_name}?`)) return;
    setBusy(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const { error: err } = await deleteGlAccount(supabase, acc.id);
    if (err) setError(err);
    else {
      await logActivity(supabase, {
        userId: userData.user?.id ?? null,
        action: "deleted",
        recordType: "gl_account",
        recordId: acc.id,
        previousValue: acc.account_code,
      });
      setMessage(`Deleted ${acc.account_code}`);
      await load();
    }
    setBusy(false);
  }

  async function onMapDefault(purpose: string, glAccountId: string) {
    setBusy(true);
    setError(null);
    const { data: userData } = await supabase.auth.getUser();
    const { error: err } = await setPostingDefaultAccount(
      supabase,
      purpose,
      glAccountId || null,
    );
    if (err) setError(err);
    else {
      await logActivity(supabase, {
        userId: userData.user?.id ?? null,
        action: "updated",
        recordType: "gl_posting_default",
        recordId: purpose,
        newValue: glAccountId || null,
      });
      await load();
    }
    setBusy(false);
  }

  if (loading) {
    return <p className="p-8 text-center text-sm opacity-50">Loading chart of accounts…</p>;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="General Ledger Accounts"
        description="Administrator chart of accounts and default posting mappings"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/settings" className="btn btn-ghost btn-sm gap-1">
              <ArrowLeft className="h-4 w-4" /> Company settings
            </Link>
            <button
              type="button"
              className="btn btn-ghost btn-sm gap-1"
              onClick={() => void load()}
              disabled={busy}
            >
              <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        }
      />

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

      {/* Create account */}
      <section className="card max-w-3xl bg-base-100 shadow">
        <div className="card-body gap-3">
          <h2 className="card-title text-base">
            <Plus className="h-4 w-4" /> New GL account
          </h2>
          <form onSubmit={onCreate} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormRow label="Code" required>
                <input
                  className="input input-bordered input-sm w-full font-mono"
                  value={form.account_code}
                  onChange={(e) => setForm((f) => ({ ...f, account_code: e.target.value }))}
                  placeholder="e.g. 4010"
                  required
                />
              </FormRow>
              <FormRow label="Name" required>
                <input
                  className="input input-bordered input-sm w-full"
                  value={form.account_name}
                  onChange={(e) => setForm((f) => ({ ...f, account_name: e.target.value }))}
                  placeholder="Account name"
                  required
                />
              </FormRow>
              <FormRow label="Type" required>
                <select
                  className="select select-bordered select-sm w-full"
                  value={form.account_type}
                  onChange={(e) => {
                    const t = e.target.value as GlAccountType;
                    setForm((f) => ({
                      ...f,
                      account_type: t,
                      normal_balance: defaultNormalBalance(t),
                    }));
                  }}
                >
                  {GL_ACCOUNT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Normal balance">
                <select
                  className="select select-bordered select-sm w-full"
                  value={form.normal_balance}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, normal_balance: e.target.value as GlNormalBalance }))
                  }
                >
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </select>
              </FormRow>
              <FormRow label="Sort order">
                <input
                  type="number"
                  className="input input-bordered input-sm w-full"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                />
              </FormRow>
              <FormRow label="Description">
                <input
                  className="input input-bordered input-sm w-full"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Optional"
                />
              </FormRow>
            </div>
            <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
              {busy ? "Saving…" : "Add account"}
            </button>
          </form>
        </div>
      </section>

      {/* Chart list */}
      <section className="rounded-2xl border border-base-300 bg-base-100 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-base-200 px-4 py-3">
          <h2 className="flex items-center gap-2 font-bold">
            <BookOpen className="h-4 w-4" /> Chart of accounts
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="select select-bordered select-xs"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as GlAccountType | "all")}
            >
              <option value="all">All types</option>
              {GL_ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <label className="flex cursor-pointer items-center gap-1 text-xs">
              <input
                type="checkbox"
                className="checkbox checkbox-xs"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
              />
              Show inactive
            </label>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-6">
            <EmptyState title="No accounts" description="Add an account or seed defaults." />
          </div>
        ) : (
          <DualHorizontalScroll>
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Balance</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((acc) => (
                  <tr key={acc.id} className={!acc.is_active ? "opacity-50" : ""}>
                    <td className="font-mono font-semibold">{acc.account_code}</td>
                    <td>
                      {acc.account_name}
                      {acc.is_system ? (
                        <span className="badge badge-ghost badge-xs ml-2">system</span>
                      ) : null}
                      {acc.description ? (
                        <span className="mt-0.5 block text-[11px] opacity-50">{acc.description}</span>
                      ) : null}
                    </td>
                    <td className="capitalize">{acc.account_type}</td>
                    <td className="capitalize">{acc.normal_balance}</td>
                    <td>
                      <StatusBadge
                        label={acc.is_active ? "Active" : "Inactive"}
                        tone={acc.is_active ? "success" : "neutral"}
                      />
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          disabled={busy}
                          onClick={() => void toggleActive(acc)}
                        >
                          {acc.is_active ? "Deactivate" : "Activate"}
                        </button>
                        {!acc.is_system ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs text-error"
                            disabled={busy}
                            onClick={() => void onDelete(acc)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DualHorizontalScroll>
        )}
      </section>

      {/* Posting defaults */}
      <section className="rounded-2xl border border-base-300 bg-base-100 shadow-sm">
        <div className="border-b border-base-200 px-4 py-3">
          <h2 className="font-bold">Default posting accounts</h2>
          <p className="text-xs opacity-55">
            Map operational purposes (batch journal export and reports) to chart accounts.
          </p>
        </div>
        {defaults.length === 0 ? (
          <p className="p-6 text-sm opacity-50">No posting defaults loaded.</p>
        ) : (
          <DualHorizontalScroll>
            <table className="table table-sm">
              <thead>
                <tr>
                  <th>Purpose</th>
                  <th>Description</th>
                  <th>GL account</th>
                </tr>
              </thead>
              <tbody>
                {defaults.map((d) => (
                  <tr key={d.id}>
                    <td className="font-medium">{d.label}</td>
                    <td className="text-xs opacity-60">{d.description ?? "—"}</td>
                    <td>
                      <select
                        className="select select-bordered select-xs w-full max-w-xs"
                        value={d.gl_account_id ?? ""}
                        disabled={busy}
                        onChange={(e) => void onMapDefault(d.purpose, e.target.value)}
                      >
                        <option value="">— Unmapped —</option>
                        {accounts
                          .filter((a) => a.is_active)
                          .map((a) => (
                            <option key={a.id} value={a.id}>
                              {formatGlAccountLabel(a)}
                            </option>
                          ))}
                      </select>
                      {d.gl_account_id && accountById.get(d.gl_account_id) ? (
                        <span className="mt-0.5 block text-[10px] opacity-45">
                          {accountById.get(d.gl_account_id)!.account_type}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DualHorizontalScroll>
        )}
      </section>
    </div>
  );
}
