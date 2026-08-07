"use client";

/**
 * Ranked vendor preference matrix — product (AP) or service scorecard UI.
 * Labels, visible metrics, and copy come from admin vendor_matrix_config.
 */

import Link from "next/link";
import { Star } from "lucide-react";
import { StatusBadge, statusTone } from "@/components/ui";
import { DualHorizontalScroll } from "@/components/DualHorizontalScroll";
import type {
  VendorMatrixCategory,
  VendorMatrixFamily,
  VendorMatrixRow,
  VendorMatrixSettings,
} from "@/lib/vendor-matrix";
import {
  formatHours,
  formatMoneyShort,
  formatOverallEquation,
  formatStars,
  formatWeightLegend,
  normalizeMatrixSettings,
  resolveScorecardCopy,
} from "@/lib/vendor-matrix";

type Props = {
  rows: VendorMatrixRow[];
  settings: VendorMatrixSettings;
  /** Which matrix this panel is showing. */
  family: VendorMatrixFamily;
  /** Service matrix subcategory filter (technicians / materials). */
  category?: VendorMatrixCategory;
  onCategoryChange?: (c: VendorMatrixCategory) => void;
  canEditPreferred: boolean;
  /** Admin-only: link to /settings/vendor-matrix scorecard editor. */
  canCustomizeScorecard?: boolean;
  busyId: string | null;
  onTogglePreferred: (vendorId: string, next: boolean) => void;
  onDeactivate: (vendorId: string) => void;
};

function IndexCell({
  index,
  raw,
  title,
}: {
  index: number | null;
  raw: string;
  title: string;
}) {
  return (
    <td className="tabular-nums" title={title}>
      {index != null ? (
        <>
          <span className="font-medium">{index}</span>
          <span className="text-xs opacity-40">/100</span>
          <p className="text-[11px] leading-snug opacity-55">{raw}</p>
        </>
      ) : (
        <span className="opacity-40">—</span>
      )}
    </td>
  );
}

export function VendorMatrixFamilyTabs({
  family,
  productLabel,
  serviceLabel,
}: {
  family: VendorMatrixFamily;
  productLabel?: string;
  serviceLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="Vendor matrix type"
      className="tabs tabs-boxed w-fit bg-base-200 p-1"
    >
      <Link
        role="tab"
        href="/vendors?view=matrix"
        aria-selected={family === "product"}
        className={`tab ${family === "product" ? "tab-active !bg-primary !text-primary-content" : ""}`}
      >
        {productLabel ?? "Product suppliers"}
      </Link>
      <Link
        role="tab"
        href="/service-vendors?view=matrix"
        aria-selected={family === "service"}
        className={`tab ${family === "service" ? "tab-active !bg-primary !text-primary-content" : ""}`}
      >
        {serviceLabel ?? "Service vendors"}
      </Link>
    </div>
  );
}

export function VendorMatrixPanel({
  rows,
  settings: settingsProp,
  family,
  category = "all",
  onCategoryChange,
  canEditPreferred,
  canCustomizeScorecard = false,
  busyId,
  onTogglePreferred,
  onDeactivate,
}: Props) {
  const settings = normalizeMatrixSettings(settingsProp);
  const config = settings.vendor_matrix_config;
  const copy = resolveScorecardCopy(settings);
  const familyLabel = family === "product" ? copy.productLabel : copy.serviceLabel;
  const equation = formatOverallEquation(settings);
  const weightLegend = formatWeightLegend(settings);
  const costRawLabel = family === "product" ? "avg order $" : "avg job $";
  const speedRawLabel = family === "product" ? "lead time" : "response";
  const m = config.metrics;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{config.title || "Vendor Matrix"}</h2>
          <p className="mt-1 max-w-2xl text-sm opacity-70">
            {familyLabel}: {config.summary}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCustomizeScorecard ? (
            <Link href="/settings/vendor-matrix" className="btn btn-outline btn-sm">
              Customize scorecard
            </Link>
          ) : null}
          <Link
            href={family === "product" ? "/vendors" : "/service-vendors"}
            className="btn btn-ghost btn-sm"
          >
            {family === "product" ? "Supplier directory" : "Services directory"}
          </Link>
        </div>
      </div>

      <VendorMatrixFamilyTabs
        family={family}
        productLabel={config.productTabLabel}
        serviceLabel={config.serviceTabLabel}
      />

      {family === "service" && onCategoryChange ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium opacity-60">Service category</span>
          <select
            className="select select-bordered select-sm"
            value={category}
            onChange={(e) => onCategoryChange(e.target.value as VendorMatrixCategory)}
            aria-label="Service vendor category"
          >
            <option value="technician">Technicians</option>
            <option value="materials">Materials</option>
            <option value="all">All service</option>
          </select>
        </div>
      ) : null}

      {config.showEquation ? (
        <div className="rounded-box border border-base-300 bg-base-100 px-4 py-3 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide opacity-60">
            Overall equation
          </p>
          <p className="mt-1 font-mono text-sm font-semibold tracking-tight sm:text-base">
            {equation}
          </p>
          <p className="mt-1 text-xs opacity-60">
            Weights: {weightLegend}. Each term is a 0–100 index (higher is better).
          </p>
        </div>
      ) : null}

      {config.showHowItWorks ? (
        <details className="rounded-box border border-base-300 bg-base-200/40 px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium">How the scorecard works</summary>
          <div className="mt-3 space-y-3 text-xs leading-relaxed opacity-90">
            <ol className="list-decimal space-y-2 pl-4">
              {m.cost.enabled ? (
                <li>
                  <span className="font-semibold">{m.cost.label} index</span> — {costRawLabel};{" "}
                  {m.cost.lowerIsBetter
                    ? "lowest peer = 100, highest = 0"
                    : "highest peer = 100, lowest = 0"}
                  . {m.cost.helpText}
                </li>
              ) : null}
              {m.speed.enabled ? (
                <li>
                  <span className="font-semibold">{m.speed.label} index</span> — {speedRawLabel};{" "}
                  {m.speed.lowerIsBetter
                    ? "fastest peer = 100, slowest = 0"
                    : "slowest peer = 100, fastest = 0"}
                  . {m.speed.helpText}
                </li>
              ) : null}
              {m.rating.enabled ? (
                <li>
                  <span className="font-semibold">{m.rating.label} index</span> — (avg ★ ÷ 5) ×
                  100. {m.rating.helpText}
                  {config.minRatingCount > 0
                    ? ` Needs at least ${config.minRatingCount} review${config.minRatingCount === 1 ? "" : "s"}.`
                    : ""}
                </li>
              ) : null}
              <li>
                <span className="font-semibold">Overall</span> — plug enabled indexes into the
                equation above. Missing KPIs drop out and remaining weights re-scale.
              </li>
              <li>
                <span className="font-semibold">Rank</span> — {copy.rankRule}
              </li>
              <li>
                <span className="font-semibold">Preferred / Prune</span> — {copy.preferredRule}{" "}
                {copy.pruneRule}
              </li>
            </ol>
          </div>
        </details>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-box border border-base-300 bg-base-100 px-4 py-6 text-center text-sm opacity-60">
          No approved {family === "product" ? "product suppliers" : "service vendors"} in this view
          yet.
        </p>
      ) : (
        <div className="card bg-base-100 shadow">
          <div className="card-body p-0">
            <DualHorizontalScroll>
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th scope="col" title={copy.rankRule}>
                      Rank
                    </th>
                    <th scope="col">Vendor</th>
                    <th scope="col">Type</th>
                    <th scope="col" title={equation}>
                      Overall
                    </th>
                    {m.cost.enabled ? (
                      <th
                        scope="col"
                        title={`${m.cost.label} index (0–100). Raw: ${costRawLabel}. Weight ${settings.vendor_matrix_weight_cost}%`}
                      >
                        {m.cost.label}
                      </th>
                    ) : null}
                    {m.speed.enabled ? (
                      <th
                        scope="col"
                        title={`${m.speed.label} index (0–100). Raw: ${speedRawLabel}. Weight ${settings.vendor_matrix_weight_speed}%`}
                      >
                        {m.speed.label}
                      </th>
                    ) : null}
                    {m.rating.enabled ? (
                      <th
                        scope="col"
                        title={`${m.rating.label} index (0–100). Weight ${settings.vendor_matrix_weight_rating}%`}
                      >
                        {m.rating.label}
                      </th>
                    ) : null}
                    {config.showPreferredBadge ? (
                      <th scope="col" title={copy.preferredRule}>
                        Preferred
                      </th>
                    ) : null}
                    <th scope="col" title={copy.pruneRule}>
                      Status
                    </th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={`${row.family}-${row.id}`}
                      className={row.shouldPrune ? "bg-error/5" : undefined}
                    >
                      <td className="tabular-nums font-medium">{row.rank}</td>
                      <td>
                        <Link href={row.detailHref} className="link link-hover font-medium">
                          {row.name}
                        </Link>
                        <p className="text-xs opacity-50">{row.subtitle}</p>
                      </td>
                      <td className="text-xs">{row.typeLabel}</td>
                      <td className="font-semibold tabular-nums">
                        {row.compositeScore != null ? (
                          <span title={equation}>
                            {row.compositeScore}
                            <span className="ml-0.5 text-xs font-normal opacity-50">/100</span>
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      {m.cost.enabled ? (
                        <IndexCell
                          index={row.costScore}
                          raw={formatMoneyShort(row.avgRepairCost)}
                          title={`${m.cost.label} index from ${formatMoneyShort(row.avgRepairCost)}`}
                        />
                      ) : null}
                      {m.speed.enabled ? (
                        <IndexCell
                          index={row.speedScore}
                          raw={formatHours(row.avgResponseHours)}
                          title={`${m.speed.label} index from ${formatHours(row.avgResponseHours)}`}
                        />
                      ) : null}
                      {m.rating.enabled ? (
                        <IndexCell
                          index={row.ratingScore}
                          raw={
                            row.avgStarRating != null
                              ? `${formatStars(row.avgStarRating)}${
                                  row.ratingCount ? ` · ${row.ratingCount}` : ""
                                }`
                              : "—"
                          }
                          title={`${m.rating.label} index from ${formatStars(row.avgStarRating)}`}
                        />
                      ) : null}
                      {config.showPreferredBadge ? (
                        <td>
                          {canEditPreferred ? (
                            <button
                              type="button"
                              className={`btn btn-ghost btn-xs gap-1 ${
                                row.isPreferred ? "text-warning" : ""
                              }`}
                              disabled={busyId === row.id}
                              onClick={() => onTogglePreferred(row.id, !row.isPreferred)}
                              title={copy.preferredRule}
                            >
                              <Star
                                className={`h-3.5 w-3.5 ${row.isPreferred ? "fill-current" : ""}`}
                              />
                              {row.isPreferred ? "Yes" : "No"}
                            </button>
                          ) : row.isPreferred ? (
                            <span className="inline-flex items-center gap-1 text-warning">
                              <Star className="h-3.5 w-3.5 fill-current" /> Yes
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      ) : null}
                      <td>
                        {row.shouldPrune ? (
                          <StatusBadge label="Prune" tone={statusTone("Rejected")} />
                        ) : row.isPreferred && config.showPreferredBadge ? (
                          <StatusBadge label="Preferred" tone={statusTone("Accepted")} />
                        ) : (
                          <StatusBadge label="OK" tone={statusTone("Assigned")} />
                        )}
                        {row.pruneReasons.length ? (
                          <p className="mt-1 max-w-[12rem] text-[11px] leading-snug text-error">
                            {row.pruneReasons[0]}
                          </p>
                        ) : null}
                      </td>
                      <td>
                        {row.shouldPrune && canEditPreferred ? (
                          <button
                            type="button"
                            className="btn btn-error btn-outline btn-xs"
                            disabled={busyId === row.id}
                            onClick={() => onDeactivate(row.id)}
                          >
                            Deactivate
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DualHorizontalScroll>
          </div>
        </div>
      )}
    </div>
  );
}
