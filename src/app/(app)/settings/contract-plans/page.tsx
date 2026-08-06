"use client";

/**
 * Admin Contract Plans — industry × Gold/Silver/Bronze × asset-value bands.
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
} from "lucide-react";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { formatMoney } from "@/lib/calculations";
import {
  clonePack,
  createBlankPack,
  formatBandRange,
  loadCatalog,
  resetCatalogToSeed,
  saveCatalog,
  setPackActive,
  updateBandBounds,
  updateBandThresholds,
  upsertPack,
  type AssetValueBand,
  type ContractPlanCatalog,
  type IndustryPack,
  type PlanThresholds,
  type ServiceLevelId,
} from "@/lib/contract-plans";

const TIERS: ServiceLevelId[] = ["gold", "silver", "bronze"];

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
  const [catalog, setCatalog] = useState<ContractPlanCatalog | null>(null);
  const [packId, setPackId] = useState("warehouse");
  const [tierId, setTierId] = useState<ServiceLevelId>("gold");
  const [bandId, setBandId] = useState("mid");
  const [message, setMessage] = useState<string | null>(null);
  const [newPackName, setNewPackName] = useState("");

  const reload = useCallback(() => {
    const cat = loadCatalog();
    setCatalog(cat);
    if (!cat.packs.some((p) => p.id === packId)) {
      setPackId(cat.packs[0]?.id ?? "warehouse");
    }
  }, [packId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const pack = useMemo(
    () => catalog?.packs.find((p) => p.id === packId) ?? null,
    [catalog, packId],
  );
  const level = useMemo(
    () => pack?.levels.find((l) => l.id === tierId) ?? null,
    [pack, tierId],
  );
  const band = useMemo(
    () => level?.bands.find((b) => b.id === bandId) ?? level?.bands[0] ?? null,
    [level, bandId],
  );

  useEffect(() => {
    if (level && !level.bands.some((b) => b.id === bandId)) {
      setBandId(level.bands[0]?.id ?? "mid");
    }
  }, [level, bandId]);

  function persist(next: ContractPlanCatalog, msg: string) {
    saveCatalog(next);
    setCatalog(next);
    setMessage(msg);
  }

  function patchThresholds(patch: Partial<PlanThresholds>) {
    if (!catalog || !band) return;
    const next = updateBandThresholds(catalog, packId, tierId, band.id, patch);
    persist(next, "Thresholds saved.");
  }

  function patchBand(bounds: {
    label?: string;
    min_asset_value?: number;
    max_asset_value?: number | null;
  }) {
    if (!catalog || !band) return;
    const next = updateBandBounds(catalog, packId, tierId, band.id, bounds);
    persist(next, "Band bounds saved.");
  }

  function onRenamePack(name: string) {
    if (!catalog || !pack) return;
    persist(upsertPack(catalog, { ...pack, name }), "Pack renamed.");
  }

  function onToggleActive() {
    if (!catalog || !pack) return;
    persist(setPackActive(catalog, pack.id, !pack.active), pack.active ? "Pack deactivated." : "Pack activated.");
  }

  function onClone() {
    if (!catalog || !pack) return;
    const next = clonePack(catalog, pack.id, `${pack.name} Copy`);
    const created = next.packs.find((p) => !catalog.packs.some((o) => o.id === p.id));
    persist(next, "Pack cloned.");
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
    persist(upsertPack(catalog, packToAdd), "Industry pack added.");
    setPackId(id);
    setNewPackName("");
  }

  function onReset() {
    if (!confirm("Reset all contract plans to seeded defaults? Your edits will be lost.")) return;
    const seed = resetCatalogToSeed();
    setCatalog(seed);
    setPackId("warehouse");
    setTierId("gold");
    setBandId("mid");
    setMessage("Catalog reset to seed defaults.");
  }

  if (!catalog) {
    return <div className="p-8 text-center text-sm opacity-60">Loading contract plans…</div>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contract Plans"
        description="Industry packs × Gold/Silver/Bronze × asset-value thresholds (stored in this browser)"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/settings" className="btn btn-ghost btn-sm gap-1">
              <ArrowLeft className="h-4 w-4" /> Settings
            </Link>
            <button type="button" className="btn btn-outline btn-sm gap-1" onClick={reload}>
              <RefreshCw className="h-4 w-4" /> Reload
            </button>
            <button type="button" className="btn btn-outline btn-sm gap-1" onClick={onReset}>
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

      <div className="alert alert-info text-sm">
        <ClipboardList className="h-4 w-4" />
        <span>
          Plans are saved in local browser storage. Applying a preset on Contracts copies price and
          thresholds onto that contract; later catalog edits do not change live deals unless you
          re-apply.
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
                  <FormRow label="Description">
                    <input
                      className="input input-bordered w-full min-w-[16rem]"
                      value={pack.description}
                      onChange={(e) =>
                        persist(
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

                <label className="form-control w-full max-w-xs">
                  <span className="label-text text-sm">Coverage level</span>
                  <select
                    className="select select-bordered"
                    value={tierId}
                    onChange={(e) => setTierId(e.target.value as ServiceLevelId)}
                  >
                    {TIERS.map((t) => (
                      <option key={t} value={t}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </option>
                    ))}
                  </select>
                </label>

                {level ? (
                  <>
                    <p className="text-sm opacity-70">{level.tagline}</p>
                    <ul className="space-y-0.5 text-xs opacity-80">
                      {level.coverages.slice(0, 6).map((line) => (
                        <li key={line}>• {line}</li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-2">
                      {level.bands.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          className={`btn btn-sm ${band?.id === b.id ? "btn-primary" : "btn-outline"}`}
                          onClick={() => setBandId(b.id)}
                        >
                          {b.label}{" "}
                          <span className="opacity-70 font-normal">({formatBandRange(b)})</span>
                          {b.thresholds.extras.max_units_covered != null ? (
                            <span className="opacity-70 font-normal">
                              {" "}
                              · {String(b.thresholds.extras.max_units_covered)} units
                            </span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </>
                ) : null}

                {band ? <BandEditor band={band} onBounds={patchBand} onThresholds={patchThresholds} /> : null}
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
  onBounds,
  onThresholds,
}: {
  band: AssetValueBand;
  onBounds: (b: {
    label?: string;
    min_asset_value?: number;
    max_asset_value?: number | null;
  }) => void;
  onThresholds: (p: Partial<PlanThresholds>) => void;
}) {
  const t = band.thresholds;
  const [extrasText, setExtrasText] = useState(extrasToText(t.extras));

  useEffect(() => {
    setExtrasText(extrasToText(band.thresholds.extras));
  }, [band.id, band.thresholds.extras]);

  return (
    <div className="space-y-4 rounded-box border border-base-300 bg-base-200/30 p-4">
      <p className="font-semibold">
        {band.label} band · from {formatMoney(t.annual_price)}/yr
        {t.extras.max_units_covered != null ? (
          <span className="font-normal opacity-70">
            {" "}
            · up to {String(t.extras.max_units_covered)} pieces of equipment
          </span>
        ) : null}
      </p>
      <p className="text-xs opacity-60">
        Edit <code className="text-xs">max_units_covered</code> in extras below to change the unit
        cap for this band.
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
        <FormRow label="Annual price">
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
