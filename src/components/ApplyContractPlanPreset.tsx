"use client";

/**
 * Shared Industry → Tier → Asset value → Apply preset controls for manager contract forms.
 * Levels come from the company catalog (dynamic).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FormRow } from "@/components/PageHeader";
import { ContractPricingSummary } from "@/components/ContractPricingSummary";
import { loadCompanyCatalog } from "@/lib/company-catalog";
import { createClient } from "@/lib/supabase/client";
import {
  CUSTOM_PACK_ID,
  applyPlanToContractForm,
  formatBandRange,
  listActivePacks,
  resolvePlan,
  type IndustryPack,
  type ManagerContractFormFields,
  type ServiceLevelId,
} from "@/lib/contract-plans";
import {
  DEFAULT_SERVICE_FEE_OPTION,
  formatMonthlyPremium,
  type ServiceFeeOption,
  premiumForFeeOption,
} from "@/lib/contract-pricing";

type Props<T extends ManagerContractFormFields> = {
  form: T;
  onApply: (next: T) => void;
  suggestedAssetValue?: number;
  customerName?: string;
  updateName?: boolean;
  compact?: boolean;
  initialPackId?: string | null;
  initialTierId?: ServiceLevelId | null;
};

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
  const supabase = useMemo(() => createClient(), []);
  const [packs, setPacks] = useState<IndustryPack[]>([]);
  const [packId, setPackId] = useState<string>(CUSTOM_PACK_ID);
  const [tierId, setTierId] = useState<ServiceLevelId>("gold");
  const [assetValue, setAssetValue] = useState(
    String(suggestedAssetValue > 0 ? suggestedAssetValue : 100_000),
  );
  const [serviceFeeOption, setServiceFeeOption] = useState<ServiceFeeOption>(DEFAULT_SERVICE_FEE_OPTION);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { catalog } = await loadCompanyCatalog(supabase);
      const loaded = listActivePacks(catalog);
      setPacks(loaded);
      setPackId((prev) => {
        if (initialPackId && loaded.some((p) => p.id === initialPackId)) return initialPackId;
        if (prev !== CUSTOM_PACK_ID && loaded.some((p) => p.id === prev)) return prev;
        return loaded[0]?.id ?? CUSTOM_PACK_ID;
      });
      if (initialTierId) setTierId(initialTierId);
    })();
  }, [supabase, initialPackId, initialTierId]);

  useEffect(() => {
    if (suggestedAssetValue > 0) {
      setAssetValue(String(suggestedAssetValue));
    }
  }, [suggestedAssetValue]);

  const activePack = packs.find((p) => p.id === packId) ?? null;
  const levels = activePack?.levels ?? [];

  useEffect(() => {
    if (levels.length && !levels.some((l) => l.id === tierId)) {
      setTierId(levels.find((l) => l.recommended)?.id ?? levels[0].id);
    }
  }, [levels, tierId]);

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
      serviceFeeOption,
    });
    onApply(next);
    const monthly = premiumForFeeOption(resolved.thresholds, serviceFeeOption);
    setHint(
      `Applied ${resolved.pack.name} · ${resolved.level.name} · ${resolved.band.label} (${formatBandRange(resolved.band)}) · ${formatMonthlyPremium(monthly)}/mo.`,
    );
  }

  return (
    <div className={`space-y-3 ${compact ? "" : "rounded-box border border-base-300 bg-base-100 p-4"}`}>
      {!compact ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Apply industry plan preset</h3>
          <Link href="/settings/contract-plans" className="link link-primary text-xs">
            Edit company plans
          </Link>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <FormRow label="Industry">
          <select
            className="select select-bordered select-sm w-full"
            value={packId}
            onChange={(e) => setPackId(e.target.value)}
          >
            {packs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value={CUSTOM_PACK_ID}>Custom (manual)</option>
          </select>
        </FormRow>
        <FormRow label="Protection level">
          <select
            className="select select-bordered select-sm w-full"
            value={tierId}
            onChange={(e) => setTierId(e.target.value)}
            disabled={packId === CUSTOM_PACK_ID || levels.length === 0}
          >
            {levels.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Covered asset value ($)">
          <input
            type="number"
            min={0}
            className="input input-bordered input-sm w-full"
            value={assetValue}
            onChange={(e) => setAssetValue(e.target.value)}
            disabled={packId === CUSTOM_PACK_ID}
          />
        </FormRow>
        <FormRow label="Service fee / visit">
          <select
            className="select select-bordered select-sm w-full"
            value={serviceFeeOption}
            onChange={(e) => setServiceFeeOption(Number(e.target.value) as ServiceFeeOption)}
            disabled={packId === CUSTOM_PACK_ID}
          >
            <option value={125}>$125</option>
            <option value={100}>$100</option>
          </select>
        </FormRow>
      </div>

      {preview ? (
        <ContractPricingSummary
          variant="prospect"
          resolved={preview}
          serviceFeeOption={serviceFeeOption}
          onServiceFeeOptionChange={setServiceFeeOption}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary btn-sm" onClick={apply}>
          Apply preset
        </button>
        {hint ? <p className="text-xs opacity-70">{hint}</p> : null}
      </div>
    </div>
  );
}
