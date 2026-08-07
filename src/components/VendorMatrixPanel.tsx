"use client";

/**
 * Ranked vendor preference matrix — product (AP) or service scorecard UI.
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
  VENDOR_SCORECARD_SPEC,
  formatHours,
  formatMoneyShort,
  formatOverallEquation,
  formatStars,
  formatWeightLegend,
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

export function VendorMatrixFamilyTabs({ family }: { family: VendorMatrixFamily }) {
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
        Product suppliers
      </Link>
      <Link
        role="tab"
        href="/service-vendors?view=matrix"
        aria-selected={family === "service"}
        className={`tab ${family === "service" ? "tab-active !bg-primary !text-primary-content" : ""}`}
      >
        Service vendors
      </Link>
    </div>
  );
}

export function VendorMatrixPanel({
  rows,
  settings,
  family,
  category = "all",
  onCategoryChange,
  canEditPreferred,
  busyId,
  onTogglePreferred,
  onDeactivate,
}: Props) {
  const familyLabel =
    family === "product" ? VENDOR_SCORECARD_SPEC.productLabel : VENDOR_SCORECARD_SPEC.serviceLabel;
  const equation = formatOverallEquation(settings);
  const weightLegend = formatWeightLegend(settings);
  const costRawLabel = family === "product" ? "avg order $" : "avg job $";
  const speedRawLabel = family === "product" ? "lead time" : "response";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Vendor Matrix</h2>
          <p className="mt-1 max-w-2xl text-sm opacity-70">
            {familyLabel}: {VENDOR_SCORECARD_SPEC.summary}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/settings/vendor-matrix" className="btn btn-outline btn-sm">
            Customize weights
          </Link>
          <Link
            href={family === "product" ? "/vendors" : "/service-vendors"}
            className="btn btn-ghost btn-sm"
          >
            {family === "product" ? "Supplier directory" : "Services directory"}
          </Link>
        </div>
      </div>

      <VendorMatrixFamilyTabs family={family} />

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

      <div className="rounded-box border border-base-300 bg-base-100 px-4 py-3 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide opacity-60">Overall equation</p>
        <p className="mt-1 font-mono text-sm font-semibold tracking-tight sm:text-base">{equation}</p>
        <p className="mt-1 text-xs opacity-60">
          Weights: {weightLegend}. Each term is a 0–100 index (higher is better).
        </p>
      </div>

      <details className="rounded-box border border-base-300 bg-base-200/40 px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium">How the scorecard works</summary>
        <div className="mt-3 space-y-3 text-xs leading-relaxed opacity-90">
          <ol className="list-decimal space-y-2 pl-4">
            <li>
              <span className="font-semibold">Cost index</span> — {costRawLabel}; lowest peer = 100,
              highest = 0.
            </li>
            <li>
              <span className="font-semibold">Speed index</span> — {speedRawLabel}; fastest peer =
              100, slowest = 0.
            </li>
            <li>
              <span className="font-semibold">Stars index</span> — (avg ★ ÷ 5) × 100.
            </li>
            <li>
              <span className="font-semibold">Overall</span> — plug the three indexes into the
              equation above. Missing KPIs drop out and remaining weights re-scale.
            </li>
            <li>
              <span className="font-semibold">Rank</span> — {VENDOR_SCORECARD_SPEC.rankRule}
            </li>
            <li>
              <span className="font-semibold">Preferred / Prune</span> —{" "}
              {VENDOR_SCORECARD_SPEC.preferredRule} {VENDOR_SCORECARD_SPEC.pruneRule}
            </li>
          </ol>
        </div>
      </details>

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
                    <th scope="col" title={VENDOR_SCORECARD_SPEC.rankRule}>
                      Rank
                    </th>
                    <th scope="col">Vendor</th>
                    <th scope="col">Type</th>
                    <th scope="col" title={equation}>
                      Overall
                    </th>
                    <th
                      scope="col"
                      title={`Cost index (0–100). Raw: ${costRawLabel}. Weight ${settings.vendor_matrix_weight_cost}%`}
                    >
                      Cost
                    </th>
                    <th
                      scope="col"
                      title={`Speed index (0–100). Raw: ${speedRawLabel}. Weight ${settings.vendor_matrix_weight_speed}%`}
                    >
                      Speed
                    </th>
                    <th
                      scope="col"
                      title={`Stars index (0–100). Weight ${settings.vendor_matrix_weight_rating}%`}
                    >
                      Stars
                    </th>
                    <th scope="col" title={VENDOR_SCORECARD_SPEC.preferredRule}>
                      Preferred
                    </th>
                    <th scope="col" title={VENDOR_SCORECARD_SPEC.pruneRule}>
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
                      <IndexCell
                        index={row.costScore}
                        raw={formatMoneyShort(row.avgRepairCost)}
                        title={`Cost index from ${formatMoneyShort(row.avgRepairCost)}`}
                      />
                      <IndexCell
                        index={row.speedScore}
                        raw={formatHours(row.avgResponseHours)}
                        title={`Speed index from ${formatHours(row.avgResponseHours)}`}
                      />
                      <IndexCell
                        index={row.ratingScore}
                        raw={
                          row.avgStarRating != null
                            ? `${formatStars(row.avgStarRating)}${
                                row.ratingCount ? ` · ${row.ratingCount}` : ""
                              }`
                            : "—"
                        }
                        title={`Stars index from ${formatStars(row.avgStarRating)}`}
                      />
                      <td>
                        {canEditPreferred ? (
                          <button
                            type="button"
                            className={`btn btn-ghost btn-xs gap-1 ${
                              row.isPreferred ? "text-warning" : ""
                            }`}
                            disabled={busyId === row.id}
                            onClick={() => onTogglePreferred(row.id, !row.isPreferred)}
                            title={VENDOR_SCORECARD_SPEC.preferredRule}
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
                      <td>
                        {row.shouldPrune ? (
                          <StatusBadge label="Prune" tone={statusTone("Rejected")} />
                        ) : row.isPreferred ? (
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
