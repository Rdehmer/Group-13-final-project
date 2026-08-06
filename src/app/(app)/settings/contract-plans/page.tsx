"use client";

/**
 * Admin Contract Plans — company-scoped industry packs with dynamic
 * protection levels and asset-value bands (1A + 2B).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ClipboardList,
  Copy,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { formatMoney } from "@/lib/calculations";
import {
  CAP_PROFILE_LABEL,
  getIndustryCapProfile,
  resolveCoverageCaps,
} from "@/lib/contract-cap-profiles";
import {
  loadCompanyCatalog,
  resetCompanyCatalogToSeed,
  saveCompanyCatalog,
} from "@/lib/company-catalog";
import { createClient } from "@/lib/supabase/client";
import {
  addBandToLevel,
  addLevelToPack,
  clonePack,
  createBlankPack,
  formatBandRange,
  removeBandFromLevel,
  removeLevelFromPack,
  setPackActive,
  updateBandBounds,
  updateBandThresholds,
  updateLevelMeta,
  upsertPack,
  type AssetValueBand,
  type ContractPlanCatalog,
  type IndustryPack,
  type PlanThresholds,
  type ServiceLevelId,
} from "@/lib/contract-plans";

function extrasToText(extras: Record<string, string | number | boolean>): string {
  return Object.entries(extras)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join("\n");
}

function textToExtras(text: string): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.includes("=")) continue;
    const eq = trimmed.indexOf("=");
    const key = trimmed.slice(0, eq).trim();
    const raw = trimmed.slice(eq + 1).trim();
    if (!key) continue;
    if (raw === "true") out[key] = true;
    else if (raw === "false") out[key] = false;
    else if (raw !== "" && Number.isFinite(Number(raw))) out[key] = Number(raw);
    else out[key] = raw;
  }
  return out;
}

export default function ContractPlansSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [catalog, setCatalog] = useState<ContractPlanCatalog | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [packId, setPackId] = useState("warehouse");
  const [tierId, setTierId] = useState<ServiceLevelId>("gold");
  const [bandId, setBandId] = useState("mid");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [newPackName, setNewPackName] = useState("");
  const [newLevelName, setNewLevelName] = useState("");
  const [newBandLabel, setNewBandLabel] = useState("");

  const reload = useCallback(async () => {
    setError(null);
    try {
      const { catalog: cat, companyId: cid } = await loadCompanyCatalog(supabase);
      setCatalog(cat);
      setCompanyId(cid);
      if (!cat.packs.some((p) => p.id === packId)) {
        setPackId(cat.packs[0]?.id ?? "warehouse");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load company catalog.");
    }
  }, [supabase, packId]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial load only
  }, []);

  const pack = useMemo(
    () => catalog?.packs.find((p) => p.id === packId) ?? null,
    [catalog, packId],
  );
  const level = useMemo(
    () => pack?.levels.find((l) => l.id === tierId) ?? pack?.levels[0] ?? null,
    [pack, tierId],
  );
  const band = useMemo(
    () => level?.bands.find((b) => b.id === bandId) ?? level?.bands[0] ?? null,
    [level, bandId],
  );

  useEffect(() => {
    if (pack && !pack.levels.some((l) => l.id === tierId)) {
      setTierId(pack.levels[0]?.id ?? "gold");
    }
  }, [pack, tierId]);

  useEffect(() => {
    if (level && !level.bands.some((b) => b.id === bandId)) {
      setBandId(level.bands[0]?.id ?? "mid");
    }
  }, [level, bandId]);

  async function persist(next: ContractPlanCatalog, msg: string) {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveCompanyCatalog(supabase, next, companyId);
      setCatalog(saved);
      setMessage(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function patchThresholds(patch: Partial<PlanThresholds>) {
    if (!catalog || !band || !level) return;
    const next = updateBandThresholds(catalog, packId, level.id, band.id, patch);
    void persist(next, "Thresholds saved to your company catalog.");
  }

  function patchBand(bounds: {
    label?: string;
    min_asset_value?: number;
    max_asset_value?: number | null;
  }) {
    if (!catalog || !band || !level) return;
    const next = updateBandBounds(catalog, packId, level.id, band.id, bounds);
    void persist(next, "Band bounds saved.");
  }

  function onRenamePack(name: string) {
    if (!catalog || !pack) return;
    void persist(upsertPack(catalog, { ...pack, name }), "Pack renamed.");
  }

  function onToggleActive() {
    if (!catalog || !pack) return;
    void persist(
      setPackActive(catalog, pack.id, !pack.active),
      pack.active ? "Pack deactivated." : "Pack activated.",
    );
  }

  function onClone() {
    if (!catalog || !pack) return;
    const next = clonePack(catalog, pack.id, `${pack.name} Copy`);
    const created = next.packs.find((p) => !catalog.packs.some((o) => o.id === p.id));
    void persist(next, "Pack cloned.");
    if (created) setPackId(created.id);
  }

  function onAddPack() {
    if (!catalog) return;
    const name = newPackName.trim() || "New Industry";
    const blank = createBlankPack(name);
    let id = blank.id;
    let n = 2;
    while (catalog.packs.some((p) => p.id === id)) {
      id = `${blank.id}_${n++}`;
    }
    const packToAdd: IndustryPack = { ...blank, id };
    void persist(upsertPack(catalog, packToAdd), "Industry pack added.");
    setPackId(id);
    setNewPackName("");
  }

  async function onReset() {
    if (
      !confirm(
        "Reset this company’s contract plans to seeded defaults? Your company edits will be lost.",
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const seed = await resetCompanyCatalogToSeed(supabase, companyId);
      setCatalog(seed);
      setPackId("warehouse");
      setTierId("gold");
      setBandId("mid");
      setMessage("Catalog reset to seed defaults for this company.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed.");
    } finally {
      setSaving(false);
    }
  }

  function onAddLevel() {
    if (!catalog || !pack) return;
    const name = newLevelName.trim() || "New plan";
    const next = addLevelToPack(catalog, pack.id, {
      name,
      copyFromLevelId: level?.id,
    });
    const created = next.packs
      .find((p) => p.id === pack.id)
      ?.levels.find((l) => !pack.levels.some((o) => o.id === l.id));
    void persist(next, "Protection level added.");
    if (created) setTierId(created.id);
    setNewLevelName("");
  }

  function onRemoveLevel() {
    if (!catalog || !pack || !level) return;
    if (pack.levels.length <= 1) {
      setError("Keep at least one protection level.");
      return;
    }
    if (!confirm(`Remove plan level “${level.name}”?`)) return;
    const next = removeLevelFromPack(catalog, pack.id, level.id);
    void persist(next, "Protection level removed.");
  }

  function onAddBand() {
    if (!catalog || !pack || !level) return;
    const label = newBandLabel.trim() || "New band";
    const next = addBandToLevel(catalog, pack.id, level.id, {
      label,
      copyFromBandId: band?.id,
    });
    const updated = next.packs.find((p) => p.id === pack.id)?.levels.find((l) => l.id === level.id);
    const created = updated?.bands.find((b) => !level.bands.some((o) => o.id === b.id));
    void persist(next, "Asset band added.");
    if (created) setBandId(created.id);
    setNewBandLabel("");
  }

  function onRemoveBand() {
    if (!catalog || !pack || !level || !band) return;
    if (level.bands.length <= 1) {
      setError("Keep at least one asset-value band.");
      return;
    }
    if (!confirm(`Remove band “${band.label}”?`)) return;
    void persist(
      removeBandFromLevel(catalog, pack.id, level.id, band.id),
      "Asset band removed.",
    );
  }

  if (!catalog) {
    return <div className="p-8 text-center text-sm opacity-60">Loading contract plans…</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contract Plans"
        description="Customize industry packs, protection levels, and asset bands for your company. Changes sync for all users in your company."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/settings" className="btn btn-ghost btn-sm gap-1">
              <ArrowLeft className="h-4 w-4" /> Settings
            </Link>
            <button
              type="button"
              className="btn btn-outline btn-sm gap-1"
              onClick={() => void reload()}
              disabled={saving}
            >
              <RefreshCw className="h-4 w-4" /> Reload
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm gap-1"
              onClick={() => void onReset()}
              disabled={saving}
            >
              <RotateCcw className="h-4 w-4" /> Reset seed
            </button>
          </div>
        }
      />

      {message ? (
        <div className="alert alert-success text-sm">
          <span>{message}</span>
          <button type="button" className="btn btn-ghost btn-xs" onClick={() => setMessage(null)}>
            Dismiss
          </button>
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

      <div className="alert alert-info text-sm">
        <ClipboardList className="h-4 w-4" />
        <span>
          Plans are stored for your company in the database (not just this browser). Add or rename
          protection levels and asset bands as needed. Applying a preset on Contracts still snapshots
          onto that deal — later catalog edits do not change live contracts unless you re-apply.
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <aside className="card bg-base-100 shadow">
          <div className="card-body gap-3 p-4">
            <label className="form-control w-full">
              <span className="label-text text-sm font-semibold">Industry pack</span>
              <select
                className="select select-bordered w-full"
                value={packId}
                onChange={(e) => setPackId(e.target.value)}
              >
                {catalog.packs
                  .slice()
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {!p.active ? " (inactive)" : ""}
                    </option>
                  ))}
              </select>
            </label>
            <div className="flex gap-1">
              <input
                className="input input-bordered input-sm flex-1"
                placeholder="New industry"
                value={newPackName}
                onChange={(e) => setNewPackName(e.target.value)}
              />
              <button type="button" className="btn btn-primary btn-sm" onClick={onAddPack} title="Add pack">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>

        <div className="space-y-4">
          {pack ? (
            <div className="card bg-base-100 shadow">
              <div className="card-body gap-3">
                <div className="flex flex-wrap items-end gap-3">
                  <FormRow label="Pack name">
                    <input
                      className="input input-bordered w-full max-w-xs"
                      value={pack.name}
                      onChange={(e) => onRenamePack(e.target.value)}
                    />
                  </FormRow>
                  <div className="pb-1">
                    <span className="text-xs uppercase tracking-wide opacity-60">Cap profile</span>
                    <p className="text-sm font-medium">
                      {CAP_PROFILE_LABEL[getIndustryCapProfile(pack.id)]}
                    </p>
                  </div>
                  <FormRow label="Description">
                    <input
                      className="input input-bordered w-full min-w-[16rem]"
                      value={pack.description}
                      onChange={(e) =>
                        void persist(
                          upsertPack(catalog, { ...pack, description: e.target.value }),
                          "Description saved.",
                        )
                      }
                    />
                  </FormRow>
                  <div className="flex flex-wrap gap-2 pb-1">
                    <button type="button" className="btn btn-outline btn-sm gap-1" onClick={onClone}>
                      <Copy className="h-3.5 w-3.5" /> Clone
                    </button>
                    <button type="button" className="btn btn-outline btn-sm" onClick={onToggleActive}>
                      {pack.active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <label className="form-control w-full max-w-xs">
                    <span className="label-text text-sm">Protection level</span>
                    <select
                      className="select select-bordered"
                      value={level?.id ?? ""}
                      onChange={(e) => setTierId(e.target.value)}
                    >
                      {pack.levels.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.recommended ? " ★" : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    className="input input-bordered input-sm w-40"
                    placeholder="New level name"
                    value={newLevelName}
                    onChange={(e) => setNewLevelName(e.target.value)}
                  />
                  <button type="button" className="btn btn-outline btn-sm gap-1" onClick={onAddLevel}>
                    <Plus className="h-3.5 w-3.5" /> Add level
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-error gap-1"
                    onClick={onRemoveLevel}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove level
                  </button>
                </div>

                {level ? (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <FormRow label="Level display name">
                        <input
                          className="input input-bordered w-full"
                          value={level.name}
                          onChange={(e) =>
                            void persist(
                              updateLevelMeta(catalog, pack.id, level.id, {
                                name: e.target.value,
                              }),
                              "Level renamed.",
                            )
                          }
                        />
                      </FormRow>
                      <FormRow label="Tagline">
                        <input
                          className="input input-bordered w-full"
                          value={level.tagline}
                          onChange={(e) =>
                            void persist(
                              updateLevelMeta(catalog, pack.id, level.id, {
                                tagline: e.target.value,
                              }),
                              "Tagline saved.",
                            )
                          }
                        />
                      </FormRow>
                    </div>
                    <label className="label cursor-pointer justify-start gap-2">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm"
                        checked={Boolean(level.recommended)}
                        onChange={(e) =>
                          void persist(
                            updateLevelMeta(catalog, pack.id, level.id, {
                              recommended: e.target.checked,
                            }),
                            "Recommended flag updated.",
                          )
                        }
                      />
                      <span className="label-text text-sm">Mark as recommended</span>
                    </label>
                    <FormRow label="Coverage bullets (one per line)">
                      <textarea
                        className="textarea textarea-bordered w-full text-sm"
                        rows={5}
                        value={level.coverages.join("\n")}
                        onChange={(e) =>
                          void persist(
                            updateLevelMeta(catalog, pack.id, level.id, {
                              coverages: e.target.value
                                .split("\n")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            }),
                            "Coverages saved.",
                          )
                        }
                      />
                    </FormRow>

                    <div className="flex flex-wrap items-center gap-2">
                      {level.bands.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          className={`btn btn-sm ${band?.id === b.id ? "btn-primary" : "btn-outline"}`}
                          onClick={() => setBandId(b.id)}
                        >
                          {b.label}{" "}
                          <span className="opacity-70 font-normal">({formatBandRange(b)})</span>
                        </button>
                      ))}
                      <input
                        className="input input-bordered input-sm w-36"
                        placeholder="New band"
                        value={newBandLabel}
                        onChange={(e) => setNewBandLabel(e.target.value)}
                      />
                      <button type="button" className="btn btn-outline btn-sm gap-1" onClick={onAddBand}>
                        <Plus className="h-3.5 w-3.5" /> Add band
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm text-error gap-1"
                        onClick={onRemoveBand}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Remove band
                      </button>
                    </div>
                  </>
                ) : null}

                {band && level ? (
                  <BandEditor
                    band={band}
                    packId={packId}
                    tierId={level.id}
                    onBounds={patchBand}
                    onThresholds={patchThresholds}
                  />
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-sm opacity-60">Select an industry pack.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function BandEditor({
  band,
  packId,
  tierId,
  onBounds,
  onThresholds,
}: {
  band: AssetValueBand;
  packId: string;
  tierId: ServiceLevelId;
  onBounds: (b: {
    label?: string;
    min_asset_value?: number;
    max_asset_value?: number | null;
  }) => void;
  onThresholds: (p: Partial<PlanThresholds>) => void;
}) {
  const t = band.thresholds;
  const [extrasText, setExtrasText] = useState(extrasToText(t.extras));
  const derivedCaps = resolveCoverageCaps(tierId, band.id, packId);
  const displayPerEq = Number(t.extras.per_equipment_cap) || derivedCaps.perEquipment;
  const displayAgg = Number(t.extras.aggregate_coverage_cap) || derivedCaps.aggregate;

  useEffect(() => {
    setExtrasText(extrasToText(band.thresholds.extras));
  }, [band.id, band.thresholds.extras]);

  return (
    <div className="space-y-4 rounded-box border border-base-300 bg-base-200/30 p-4">
      <p className="font-semibold">
        {band.label} band ·{" "}
        {formatMoney(t.monthly_premium_at_125_fee ?? Math.round(t.annual_price / 12))}/mo @ $125 visit
      </p>
      <p className="text-sm opacity-80">
        Coverage caps (derived): {formatMoney(displayPerEq)}/equipment · {formatMoney(displayAgg)}/yr
        aggregate
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormRow label="Band label">
          <input
            className="input input-bordered w-full"
            value={band.label}
            onChange={(e) => onBounds({ label: e.target.value })}
          />
        </FormRow>
        <FormRow label="Min asset value">
          <input
            type="number"
            min={0}
            className="input input-bordered w-full"
            value={band.min_asset_value}
            onChange={(e) => onBounds({ min_asset_value: Number(e.target.value) || 0 })}
          />
        </FormRow>
        <FormRow label="Max asset value (blank = none)">
          <input
            type="number"
            min={0}
            className="input input-bordered w-full"
            value={band.max_asset_value ?? ""}
            onChange={(e) =>
              onBounds({
                max_asset_value: e.target.value === "" ? null : Number(e.target.value) || 0,
              })
            }
          />
        </FormRow>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormRow label="Monthly premium @ $125/visit">
          <input
            type="number"
            min={0}
            step={0.01}
            className="input input-bordered w-full"
            value={t.monthly_premium_at_125_fee ?? Math.round(t.annual_price / 12)}
            onChange={(e) => {
              const monthly125 = Number(e.target.value) || 0;
              const tradeoff = Number(t.extras.premium_tradeoff_per_month) || 25;
              onThresholds({
                monthly_premium_at_125_fee: monthly125,
                monthly_premium_at_100_fee: monthly125 + tradeoff,
                annual_price: monthly125 * 12,
              });
            }}
          />
        </FormRow>
        <FormRow label="Monthly premium @ $100/visit">
          <input
            type="number"
            min={0}
            step={0.01}
            className="input input-bordered w-full"
            value={t.monthly_premium_at_100_fee ?? Math.round(t.annual_price / 12) + 25}
            onChange={(e) => {
              const monthly100 = Number(e.target.value) || 0;
              onThresholds({ monthly_premium_at_100_fee: monthly100 });
            }}
          />
        </FormRow>
        <FormRow label="Annual price (derived)">
          <input
            type="number"
            min={0}
            step={0.01}
            className="input input-bordered w-full"
            value={t.annual_price}
            onChange={(e) => onThresholds({ annual_price: Number(e.target.value) || 0 })}
          />
        </FormRow>
        <FormRow label="Contract type">
          <input
            className="input input-bordered w-full"
            value={t.contract_type}
            onChange={(e) => onThresholds({ contract_type: e.target.value })}
          />
        </FormRow>
        <FormRow label="Included visits">
          <input
            type="number"
            min={0}
            className="input input-bordered w-full"
            value={t.included_service_visits}
            onChange={(e) => onThresholds({ included_service_visits: Number(e.target.value) || 0 })}
          />
        </FormRow>
        <FormRow label="Service frequency">
          <input
            className="input input-bordered w-full"
            value={t.service_frequency}
            onChange={(e) => onThresholds({ service_frequency: e.target.value })}
          />
        </FormRow>
        <FormRow label="Labor hours">
          <input
            type="number"
            min={0}
            className="input input-bordered w-full"
            value={t.included_labor_hours}
            onChange={(e) => onThresholds({ included_labor_hours: Number(e.target.value) || 0 })}
          />
        </FormRow>
        <FormRow label="Parts allowance ($)">
          <input
            type="number"
            min={0}
            className="input input-bordered w-full"
            value={t.included_replacement_parts}
            onChange={(e) =>
              onThresholds({ included_replacement_parts: Number(e.target.value) || 0 })
            }
          />
        </FormRow>
        <FormRow label="Emergency SLA">
          <input
            className="input input-bordered w-full"
            value={t.emergency_response_commitment}
            onChange={(e) => onThresholds({ emergency_response_commitment: e.target.value })}
          />
        </FormRow>
        <FormRow label="Billing method">
          <input
            className="input input-bordered w-full"
            value={t.billing_method}
            onChange={(e) => onThresholds({ billing_method: e.target.value })}
          />
        </FormRow>
        <FormRow label="Payment terms">
          <input
            className="input input-bordered w-full"
            value={t.payment_terms}
            onChange={(e) => onThresholds({ payment_terms: e.target.value })}
          />
        </FormRow>
        <FormRow label="Renewal">
          <input
            className="input input-bordered w-full"
            value={t.renewal_option}
            onChange={(e) => onThresholds({ renewal_option: e.target.value })}
          />
        </FormRow>
      </div>
      <FormRow label="Approval requirements">
        <input
          className="input input-bordered w-full"
          value={t.approval_requirements}
          onChange={(e) => onThresholds({ approval_requirements: e.target.value })}
        />
      </FormRow>
      <FormRow label="Extra thresholds (one key=value per line)">
        <textarea
          className="textarea textarea-bordered w-full font-mono text-xs"
          rows={4}
          value={extrasText}
          onChange={(e) => setExtrasText(e.target.value)}
          onBlur={() => onThresholds({ extras: textToExtras(extrasText) })}
          placeholder={"travel_radius_miles=50\ndeductible=250\nwaiting_period_days=30"}
        />
      </FormRow>
    </div>
  );
}
