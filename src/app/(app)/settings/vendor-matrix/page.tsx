"use client";

/**
 * Admin: customize vendor preference matrix weights and prune thresholds.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LayoutGrid } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import type { CompanySettings } from "@/lib/types";
import {
  DEFAULT_VENDOR_MATRIX_SETTINGS,
  VENDOR_SCORECARD_SPEC,
  formatOverallEquation,
  formatWeightLegend,
  normalizeMatrixSettings,
  normalizeWeightsTo100,
  type VendorMatrixSettings,
} from "@/lib/vendor-matrix";

export default function VendorMatrixSettingsPage() {
  const supabase = createClient();
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [form, setForm] = useState<VendorMatrixSettings>(DEFAULT_VENDOR_MATRIX_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data, error: loadErr } = await supabase
        .from("company_settings")
        .select("*")
        .limit(1)
        .single();
      if (loadErr || !data) {
        setError(loadErr?.message ?? "Company settings not found.");
        return;
      }
      const row = data as CompanySettings;
      setSettingsId(row.id);
      setForm(normalizeMatrixSettings(row));
    })();
  }, [supabase]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!settingsId) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    const weights = normalizeWeightsTo100({
      cost: form.vendor_matrix_weight_cost,
      speed: form.vendor_matrix_weight_speed,
      rating: form.vendor_matrix_weight_rating,
    });
    const payload = {
      vendor_matrix_weight_cost: weights.cost,
      vendor_matrix_weight_speed: weights.speed,
      vendor_matrix_weight_rating: weights.rating,
      vendor_matrix_min_star_rating: Math.min(
        5,
        Math.max(0, Number(form.vendor_matrix_min_star_rating) || 0),
      ),
      vendor_matrix_max_avg_repair_cost:
        form.vendor_matrix_max_avg_repair_cost == null ||
        form.vendor_matrix_max_avg_repair_cost === ("" as unknown)
          ? null
          : Math.max(0, Number(form.vendor_matrix_max_avg_repair_cost)),
      vendor_matrix_max_response_hours:
        form.vendor_matrix_max_response_hours == null ||
        form.vendor_matrix_max_response_hours === ("" as unknown)
          ? null
          : Math.max(0, Number(form.vendor_matrix_max_response_hours)),
      vendor_matrix_hide_pruned: form.vendor_matrix_hide_pruned,
      updated_at: new Date().toISOString(),
    };
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error: updErr } = await supabase
      .from("company_settings")
      .update(payload)
      .eq("id", settingsId);
    if (updErr) {
      setError(updErr.message);
      setSaving(false);
      return;
    }
    setForm(normalizeMatrixSettings({ ...form, ...payload }));
    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "updated",
      recordType: "company_settings",
      recordId: settingsId,
      newValue: "vendor_matrix",
    });
    setMessage("Vendor matrix settings saved. Weights were normalized to total 100.");
    setSaving(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendor Matrix"
        description="Shared scorecard weights and prune thresholds for both product suppliers (AP) and service vendors. Cost, response speed, and star ratings use the same admin settings on each matrix."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/settings" className="btn btn-ghost btn-sm gap-1">
              <ArrowLeft className="h-4 w-4" /> Settings
            </Link>
            <Link href="/vendors?view=matrix" className="btn btn-outline btn-sm gap-1">
              <LayoutGrid className="h-4 w-4" /> Vendor Matrix
            </Link>
            <Link href="/vendors" className="btn btn-outline btn-sm gap-1">
              <LayoutGrid className="h-4 w-4" /> Suppliers
            </Link>
            <Link href="/service-vendors" className="btn btn-outline btn-sm gap-1">
              <LayoutGrid className="h-4 w-4" /> Services
            </Link>
          </div>
        }
      />

      {error ? (
        <div className="alert alert-error text-sm">
          <span>{error}</span>
        </div>
      ) : null}
      {message ? (
        <div className="alert alert-success text-sm">
          <span>{message}</span>
        </div>
      ) : null}

      <section className="card max-w-2xl border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body space-y-3 text-sm">
          <h2 className="card-title text-base">{VENDOR_SCORECARD_SPEC.title}</h2>
          <p className="opacity-80">{VENDOR_SCORECARD_SPEC.summary}</p>

          <div className="rounded-box border border-base-300 bg-base-200/50 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-60">
              Overall equation
            </p>
            <p className="mt-1 font-mono text-sm font-semibold tracking-tight">
              {formatOverallEquation(form)}
            </p>
            <p className="mt-1.5 text-xs opacity-65">{VENDOR_SCORECARD_SPEC.overallFormulaNote}</p>
            <p className="mt-1 text-xs opacity-55">Weights in form: {formatWeightLegend(form)}</p>
          </div>

          <ul className="list-disc space-y-1.5 pl-5 text-xs opacity-80">
            {VENDOR_SCORECARD_SPEC.metrics.map((m) => (
              <li key={m.key}>
                <span className="font-semibold">{m.label}</span> ({m.unit}): {m.index}
              </li>
            ))}
          </ul>
          <p className="text-xs opacity-70">
            {VENDOR_SCORECARD_SPEC.rankRule} {VENDOR_SCORECARD_SPEC.preferredRule}{" "}
            {VENDOR_SCORECARD_SPEC.pruneRule}
          </p>
        </div>
      </section>

      <form onSubmit={onSave} className="card max-w-2xl bg-base-100 shadow">
        <div className="card-body space-y-4">
          <h2 className="card-title text-base">Score weights</h2>
          <p className="text-sm opacity-70">
            Shared by the product supplier matrix and the service vendor matrix. Relative importance
            of each KPI index; saved weights are normalized so they add to 100.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormRow label="Cost">
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                className="input input-bordered w-full"
                value={form.vendor_matrix_weight_cost}
                onChange={(e) =>
                  setForm({ ...form, vendor_matrix_weight_cost: Number(e.target.value) })
                }
              />
              <p className="mt-1 text-xs opacity-50">
                Product: order/bill cost · Service: job cost. Lower ranks higher
              </p>
            </FormRow>
            <FormRow label="Response / lead time">
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                className="input input-bordered w-full"
                value={form.vendor_matrix_weight_speed}
                onChange={(e) =>
                  setForm({ ...form, vendor_matrix_weight_speed: Number(e.target.value) })
                }
              />
              <p className="mt-1 text-xs opacity-50">
                Product: lead hours · Service: response hours. Faster ranks higher
              </p>
            </FormRow>
            <FormRow label="Star ratings">
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                className="input input-bordered w-full"
                value={form.vendor_matrix_weight_rating}
                onChange={(e) =>
                  setForm({ ...form, vendor_matrix_weight_rating: Number(e.target.value) })
                }
              />
              <p className="mt-1 text-xs opacity-50">Higher stars rank higher</p>
            </FormRow>
          </div>

          <h2 className="card-title text-base pt-2">Prune rules</h2>
          <p className="text-sm opacity-70">
            Flag underperforming product or service vendors so managers can deactivate them. Leave
            max fields blank to disable that rule.
          </p>
          <FormRow label="Min star rating">
            <input
              type="number"
              min={0}
              max={5}
              step={0.1}
              className="input input-bordered w-full"
              value={form.vendor_matrix_min_star_rating}
              onChange={(e) =>
                setForm({ ...form, vendor_matrix_min_star_rating: Number(e.target.value) })
              }
            />
          </FormRow>
          <FormRow label="Max avg cost (order or job)">
            <input
              type="number"
              min={0}
              step={1}
              className="input input-bordered w-full"
              placeholder="No limit"
              value={form.vendor_matrix_max_avg_repair_cost ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  vendor_matrix_max_avg_repair_cost:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </FormRow>
          <FormRow label="Max response / lead hours">
            <input
              type="number"
              min={0}
              step={0.5}
              className="input input-bordered w-full"
              placeholder="No limit"
              value={form.vendor_matrix_max_response_hours ?? ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  vendor_matrix_max_response_hours:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </FormRow>
          <label className="label cursor-pointer justify-start gap-3">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={form.vendor_matrix_hide_pruned}
              onChange={(e) =>
                setForm({ ...form, vendor_matrix_hide_pruned: e.target.checked })
              }
            />
            <span className="label-text text-sm">
              Hide prune-flagged vendors from both matrices
            </span>
          </label>

          <button type="submit" className="btn btn-primary btn-sm w-fit" disabled={saving}>
            {saving ? "Saving…" : "Save matrix settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
