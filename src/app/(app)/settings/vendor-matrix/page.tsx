"use client";

/**
 * Admin: fully customize the vendor preference matrix scorecard.
 * View-only managers use Vendor > Matrix; only administrators edit weights/rules.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LayoutGrid, RotateCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState } from "@/components/ui";
import type { CompanySettings, Profile } from "@/lib/types";
import {
  DEFAULT_VENDOR_MATRIX_CONFIG,
  DEFAULT_VENDOR_MATRIX_SETTINGS,
  buildVendorMatrixSavePayload,
  formatOverallEquation,
  formatWeightLegend,
  normalizeMatrixSettings,
  type VendorMatrixConfig,
  type VendorMatrixMetricKey,
  type VendorMatrixSettings,
} from "@/lib/vendor-matrix";

const METRIC_KEYS: VendorMatrixMetricKey[] = ["cost", "speed", "rating"];

function updateConfig(
  form: VendorMatrixSettings,
  patch: (c: VendorMatrixConfig) => VendorMatrixConfig,
): VendorMatrixSettings {
  const base = structuredClone(
    form.vendor_matrix_config ?? DEFAULT_VENDOR_MATRIX_CONFIG,
  );
  return {
    ...form,
    vendor_matrix_config: patch(base),
  };
}

export default function VendorMatrixSettingsPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [form, setForm] = useState<VendorMatrixSettings>(() =>
    normalizeMatrixSettings(DEFAULT_VENDOR_MATRIX_SETTINGS),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setProfile(null);
        setAuthReady(true);
        return;
      }
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile((data as Profile) ?? null);
      setAuthReady(true);
    })();
  }, [supabase]);

  const isAdmin = profile?.role === "administrator";

  useEffect(() => {
    if (!authReady || !isAdmin) return;
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
  }, [authReady, isAdmin, supabase]);

  const config = form.vendor_matrix_config ?? DEFAULT_VENDOR_MATRIX_CONFIG;

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!settingsId || !isAdmin) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    const payload = buildVendorMatrixSavePayload(form);
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
    setMessage(
      payload.vendor_matrix_config.normalizeWeights
        ? "Vendor matrix saved. Enabled metric weights were normalized to total 100."
        : "Vendor matrix settings saved.",
    );
    setSaving(false);
  }

  function resetDefaults() {
    setForm(structuredClone(DEFAULT_VENDOR_MATRIX_SETTINGS));
    setMessage("Form reset to defaults — click Save to persist.");
    setError(null);
  }

  if (!authReady) {
    return <div className="p-8 text-center opacity-60">Loading…</div>;
  }

  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="Vendor Matrix"
          description="Scorecard configuration for product suppliers and service vendors"
        />
        <EmptyState
          title="Access restricted"
          description="Only administrators can customize vendor matrix weights, prune rules, and scorecard labels. Managers can view the matrix under Vendor → Matrix."
          action={
            <Link href="/vendors?view=matrix" className="btn btn-outline btn-sm">
              Open Vendor Matrix
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendor Matrix"
        description="Fully customize the shared scorecard for product suppliers and service vendors: labels, weights, which metrics count, prune rules, and on-screen copy."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/settings" className="btn btn-ghost btn-sm gap-1">
              <ArrowLeft className="h-4 w-4" /> Settings
            </Link>
            <Link href="/vendors?view=matrix" className="btn btn-outline btn-sm gap-1">
              <LayoutGrid className="h-4 w-4" /> Open matrix
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

      <section className="card max-w-3xl border border-base-300 bg-base-100 shadow-sm">
        <div className="card-body space-y-3 text-sm">
          <h2 className="card-title text-base">Live preview</h2>
          <p className="font-semibold">{config.title}</p>
          <p className="opacity-80">{config.summary}</p>
          <div className="rounded-box border border-base-300 bg-base-200/50 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide opacity-60">
              Overall equation
            </p>
            <p className="mt-1 font-mono text-sm font-semibold tracking-tight">
              {formatOverallEquation(form)}
            </p>
            <p className="mt-1 text-xs opacity-55">{formatWeightLegend(form)}</p>
          </div>
        </div>
      </section>

      <form onSubmit={onSave} className="card max-w-3xl bg-base-100 shadow">
        <div className="card-body space-y-6">
          <div className="space-y-3">
            <h2 className="card-title text-base">Scorecard copy</h2>
            <FormRow label="Title">
              <input
                className="input input-bordered w-full"
                value={config.title}
                maxLength={120}
                onChange={(e) =>
                  setForm(
                    updateConfig(form, (c) => {
                      c.title = e.target.value;
                      return c;
                    }),
                  )
                }
              />
            </FormRow>
            <FormRow label="Summary">
              <textarea
                className="textarea textarea-bordered w-full min-h-20"
                value={config.summary}
                maxLength={600}
                onChange={(e) =>
                  setForm(
                    updateConfig(form, (c) => {
                      c.summary = e.target.value;
                      return c;
                    }),
                  )
                }
              />
            </FormRow>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormRow label="Product tab label">
                <input
                  className="input input-bordered w-full"
                  value={config.productTabLabel}
                  maxLength={40}
                  onChange={(e) =>
                    setForm(
                      updateConfig(form, (c) => {
                        c.productTabLabel = e.target.value;
                        return c;
                      }),
                    )
                  }
                />
              </FormRow>
              <FormRow label="Service tab label">
                <input
                  className="input input-bordered w-full"
                  value={config.serviceTabLabel}
                  maxLength={40}
                  onChange={(e) =>
                    setForm(
                      updateConfig(form, (c) => {
                        c.serviceTabLabel = e.target.value;
                        return c;
                      }),
                    )
                  }
                />
              </FormRow>
            </div>
          </div>

          <div className="space-y-3">
            <h2 className="card-title text-base">Display options</h2>
            <label className="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={config.showEquation}
                onChange={(e) =>
                  setForm(
                    updateConfig(form, (c) => {
                      c.showEquation = e.target.checked;
                      return c;
                    }),
                  )
                }
              />
              <span className="label-text text-sm">Show Overall equation on matrix pages</span>
            </label>
            <label className="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={config.showHowItWorks}
                onChange={(e) =>
                  setForm(
                    updateConfig(form, (c) => {
                      c.showHowItWorks = e.target.checked;
                      return c;
                    }),
                  )
                }
              />
              <span className="label-text text-sm">Show “How the scorecard works” panel</span>
            </label>
            <label className="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={config.showPreferredBadge}
                onChange={(e) =>
                  setForm(
                    updateConfig(form, (c) => {
                      c.showPreferredBadge = e.target.checked;
                      return c;
                    }),
                  )
                }
              />
              <span className="label-text text-sm">Show Preferred column / badge controls</span>
            </label>
            <label className="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={config.normalizeWeights}
                onChange={(e) =>
                  setForm(
                    updateConfig(form, (c) => {
                      c.normalizeWeights = e.target.checked;
                      return c;
                    }),
                  )
                }
              />
              <span className="label-text text-sm">
                Normalize enabled metric weights to total 100 on save
              </span>
            </label>
            <FormRow label="Min reviews before stars count in Overall">
              <input
                type="number"
                min={0}
                max={50}
                step={1}
                className="input input-bordered w-full max-w-xs"
                value={config.minRatingCount}
                onChange={(e) =>
                  setForm(
                    updateConfig(form, (c) => {
                      c.minRatingCount = Number(e.target.value);
                      return c;
                    }),
                  )
                }
              />
              <p className="mt-1 text-xs opacity-50">0 = always use available star averages</p>
            </FormRow>
          </div>

          <div className="space-y-4">
            <div>
              <h2 className="card-title text-base">Metrics</h2>
              <p className="text-sm opacity-70">
                Enable or disable each KPI, rename columns, set weight, and choose whether lower
                raw values score higher (typical for cost and speed).
              </p>
            </div>
            {METRIC_KEYS.map((key) => {
              const metric = config.metrics[key];
              const defaults = DEFAULT_VENDOR_MATRIX_CONFIG.metrics[key];
              return (
                <div
                  key={key}
                  className="rounded-box border border-base-300 bg-base-200/30 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="label cursor-pointer justify-start gap-3 py-0">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={metric.enabled}
                        onChange={(e) =>
                          setForm(
                            updateConfig(form, (c) => {
                              c.metrics[key].enabled = e.target.checked;
                              return c;
                            }),
                          )
                        }
                      />
                      <span className="label-text font-semibold capitalize">{key} metric</span>
                    </label>
                    {key !== "rating" ? (
                      <label className="label cursor-pointer justify-start gap-2 py-0">
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={metric.lowerIsBetter}
                          disabled={!metric.enabled}
                          onChange={(e) =>
                            setForm(
                              updateConfig(form, (c) => {
                                c.metrics[key].lowerIsBetter = e.target.checked;
                                return c;
                              }),
                            )
                          }
                        />
                        <span className="label-text text-xs">Lower raw value scores higher</span>
                      </label>
                    ) : null}
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormRow label="Column label">
                      <input
                        className="input input-bordered w-full"
                        value={metric.label}
                        maxLength={40}
                        disabled={!metric.enabled}
                        placeholder={defaults.label}
                        onChange={(e) =>
                          setForm(
                            updateConfig(form, (c) => {
                              c.metrics[key].label = e.target.value;
                              return c;
                            }),
                          )
                        }
                      />
                    </FormRow>
                    <FormRow label="Weight">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        className="input input-bordered w-full"
                        value={metric.weight}
                        disabled={!metric.enabled}
                        onChange={(e) =>
                          setForm(
                            updateConfig(form, (c) => {
                              c.metrics[key].weight = Number(e.target.value);
                              return c;
                            }),
                          )
                        }
                      />
                    </FormRow>
                  </div>
                  <FormRow label="Help text (shown in “How it works”)">
                    <textarea
                      className="textarea textarea-bordered w-full min-h-16 text-sm"
                      value={metric.helpText}
                      maxLength={400}
                      disabled={!metric.enabled}
                      onChange={(e) =>
                        setForm(
                          updateConfig(form, (c) => {
                            c.metrics[key].helpText = e.target.value;
                            return c;
                          }),
                        )
                      }
                    />
                  </FormRow>
                </div>
              );
            })}
          </div>

          <div className="space-y-3">
            <h2 className="card-title text-base">Prune rules</h2>
            <p className="text-sm opacity-70">
              Flag underperforming vendors. Turn each rule off independently, or leave a max blank
              while enabled to skip that check.
            </p>

            <div className="rounded-box border border-base-300 p-4 space-y-3">
              <label className="label cursor-pointer justify-start gap-3 py-0">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={config.prune.minStars.enabled}
                  onChange={(e) =>
                    setForm(
                      updateConfig(form, (c) => {
                        c.prune.minStars.enabled = e.target.checked;
                        return c;
                      }),
                    )
                  }
                />
                <span className="label-text text-sm font-medium">Min star rating</span>
              </label>
              <input
                type="number"
                min={0}
                max={5}
                step={0.1}
                className="input input-bordered w-full max-w-xs"
                disabled={!config.prune.minStars.enabled}
                value={config.prune.minStars.value}
                onChange={(e) =>
                  setForm(
                    updateConfig(form, (c) => {
                      c.prune.minStars.value = Number(e.target.value);
                      return c;
                    }),
                  )
                }
              />
            </div>

            <div className="rounded-box border border-base-300 p-4 space-y-3">
              <label className="label cursor-pointer justify-start gap-3 py-0">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={config.prune.maxCost.enabled}
                  onChange={(e) =>
                    setForm(
                      updateConfig(form, (c) => {
                        c.prune.maxCost.enabled = e.target.checked;
                        return c;
                      }),
                    )
                  }
                />
                <span className="label-text text-sm font-medium">Max avg cost (order or job)</span>
              </label>
              <input
                type="number"
                min={0}
                step={1}
                className="input input-bordered w-full max-w-xs"
                placeholder="No limit"
                disabled={!config.prune.maxCost.enabled}
                value={config.prune.maxCost.value ?? ""}
                onChange={(e) =>
                  setForm(
                    updateConfig(form, (c) => {
                      c.prune.maxCost.value =
                        e.target.value === "" ? null : Number(e.target.value);
                      return c;
                    }),
                  )
                }
              />
            </div>

            <div className="rounded-box border border-base-300 p-4 space-y-3">
              <label className="label cursor-pointer justify-start gap-3 py-0">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={config.prune.maxHours.enabled}
                  onChange={(e) =>
                    setForm(
                      updateConfig(form, (c) => {
                        c.prune.maxHours.enabled = e.target.checked;
                        return c;
                      }),
                    )
                  }
                />
                <span className="label-text text-sm font-medium">Max response / lead hours</span>
              </label>
              <input
                type="number"
                min={0}
                step={0.5}
                className="input input-bordered w-full max-w-xs"
                placeholder="No limit"
                disabled={!config.prune.maxHours.enabled}
                value={config.prune.maxHours.value ?? ""}
                onChange={(e) =>
                  setForm(
                    updateConfig(form, (c) => {
                      c.prune.maxHours.value =
                        e.target.value === "" ? null : Number(e.target.value);
                      return c;
                    }),
                  )
                }
              />
            </div>

            <label className="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={config.prune.hidePruned}
                onChange={(e) =>
                  setForm(
                    updateConfig(form, (c) => {
                      c.prune.hidePruned = e.target.checked;
                      return c;
                    }),
                  )
                }
              />
              <span className="label-text text-sm">
                Hide prune-flagged vendors from both matrices
              </span>
            </label>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? "Saving…" : "Save matrix settings"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm gap-1"
              onClick={resetDefaults}
              disabled={saving}
            >
              <RotateCcw className="h-4 w-4" /> Reset to defaults
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
