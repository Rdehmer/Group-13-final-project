"use client";

/**
 * Shared Industry → Tier → Asset value → Apply preset controls for manager contract forms.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { FormRow } from "@/components/PageHeader";
import { formatMoney } from "@/lib/calculations";
import {
  CUSTOM_PACK_ID,
  applyPlanToContractForm,
  formatBandRange,
  listActivePacks,
  loadCatalog,
  resolvePlan,
  type ManagerContractFormFields,
  type ServiceLevelId,
} from "@/lib/contract-plans";

type Props<T extends ManagerContractFormFields> = {
  form: T;
  onApply: (next: T) => void;
  /** Suggested covered asset value (e.g. sum of equipment replacement_cost). */
  suggestedAssetValue?: number;
  customerName?: string;
  updateName?: boolean;
  compact?: boolean;
  /** Pre-select industry from pending request notes. */
  initialPackId?: string | null;
  initialTierId?: ServiceLevelId | null;
};

const TIERS: { id: ServiceLevelId; label: string }[] = [
  { id: "gold", label: "Gold" },
  { id: "silver", label: "Silver" },
  { id: "bronze", label: "Bronze" },
];

export function ApplyContractPlanPreset<T extends ManagerContractFormFields>({
  form,
  onApply,
  suggestedAssetValue = 0,
  customerName,
  updateName = false,
  compact = false,
  initialPackId = null,
  initialTierId = null,
}: Props<T>) {
  const [packs, setPacks] = useState(() =>
    typeof window !== "undefined" ? listActivePacks(loadCatalog()) : [],
  );
  const [packId, setPackId] = useState<string>(CUSTOM_PACK_ID);
  const [tierId, setTierId] = useState<ServiceLevelId>("gold");
  const [assetValue, setAssetValue] = useState(
    String(suggestedAssetValue > 0 ? suggestedAssetValue : 100_000),
  );
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    const loaded = listActivePacks(loadCatalog());
    setPacks(loaded);
    setPackId((prev) => {
      if (initialPackId && loaded.some((p) => p.id === initialPackId)) return initialPackId;
      if (prev !== CUSTOM_PACK_ID && loaded.some((p) => p.id === prev)) return prev;
      return loaded[0]?.id ?? CUSTOM_PACK_ID;
    });
    if (initialTierId) setTierId(initialTierId);
  }, [initialPackId, initialTierId]);

  useEffect(() => {
    if (suggestedAssetValue > 0) {
      setAssetValue(String(suggestedAssetValue));
    }
  }, [suggestedAssetValue]);

  const assetNum = Number(assetValue) || 0;
  const preview = packId === CUSTOM_PACK_ID ? null : resolvePlan(packId, tierId, assetNum);

  function apply() {
    if (packId === CUSTOM_PACK_ID) {
      setHint("Custom selected — enter price and thresholds manually.");
      return;
    }
    const resolved = resolvePlan(packId, tierId, assetNum);
    if (!resolved) {
      setHint("Could not resolve that plan. Pick another industry or tier.");
      return;
    }
    const next = applyPlanToContractForm(form, resolved, {
      updateName,
      customerName,
    });
    onApply(next);
    setHint(
      `Applied ${resolved.pack.name} · ${resolved.level.name} · ${resolved.band.label} (${formatMoney(resolved.thresholds.annual_price)}/yr).`,
    );
  }

  return (
    <div
      className={`rounded-box border border-primary/30 bg-primary/5 ${compact ? "p-3" : "p-4"} space-y-3`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Apply industry plan preset</p>
          <p className="text-xs opacity-70">
            Price and thresholds scale by covered asset value.{" "}
            <Link href="/settings/contract-plans" className="link">
              Edit plans
            </Link>
          </p>
        </div>
      </div>

      <div className={`grid gap-2 ${compact ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
        <FormRow label="Industry">
          <select
            className="select select-bordered select-sm w-full"
            value={packId}
            onChange={(e) => setPackId(e.target.value)}
          >
            <option value={CUSTOM_PACK_ID}>Custom (manual)</option>
            {packs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Level">
          <select
            className="select select-bordered select-sm w-full"
            value={tierId}
            onChange={(e) => setTierId(e.target.value as ServiceLevelId)}
            disabled={packId === CUSTOM_PACK_ID}
          >
            {TIERS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Covered asset value ($)">
          <input
            type="number"
            min={0}
            step={1000}
            className="input input-bordered input-sm w-full"
            value={assetValue}
            onChange={(e) => setAssetValue(e.target.value)}
            disabled={packId === CUSTOM_PACK_ID}
          />
        </FormRow>
      </div>

      {preview ? (
        <p className="text-xs opacity-70">
          Resolves to <span className="font-medium">{preview.band.label}</span> band (
          {formatBandRange(preview.band)}) ·{" "}
          <span className="font-medium tabular-nums">
            {formatMoney(preview.thresholds.annual_price)}
          </span>
          /yr · {preview.thresholds.included_service_visits} visits ·{" "}
          {preview.thresholds.included_labor_hours} labor hrs
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary btn-sm" onClick={apply}>
          Apply preset
        </button>
        {suggestedAssetValue > 0 ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setAssetValue(String(suggestedAssetValue))}
            disabled={packId === CUSTOM_PACK_ID}
          >
            Use equipment total ({formatMoney(suggestedAssetValue)})
          </button>
        ) : null}
      </div>

      {hint ? <p className="text-xs text-primary">{hint}</p> : null}
    </div>
  );
}
