"use client";

import type { ContractRequestPreviewData } from "@/lib/contracts";

type Props = {
  preview: ContractRequestPreviewData;
  compact?: boolean;
};

export function ContractRequestPreview({ preview, compact = false }: Props) {
  return (
    <div className={`rounded-box bg-base-200/60 ${compact ? "p-4 text-sm" : "p-5"}`}>
      <h3 className="font-semibold">{compact ? "Review your request" : "Your request preview"}</h3>
      <p className="mt-1 text-xs opacity-70">
        {preview.tierName} — {preview.tierTagline}
      </p>

      <dl className="mt-4 space-y-2 text-sm">
        <div>
          <dt className="opacity-70">Agreement name</dt>
          <dd className="font-medium">{preview.contractName}</dd>
        </div>
        <div>
          <dt className="opacity-70">Type</dt>
          <dd className="font-medium">{preview.contractType}</dd>
        </div>
        <div>
          <dt className="opacity-70">Term</dt>
          <dd className="font-medium">
            {preview.term}
            {preview.renewal ? ` · ${preview.renewal}` : ""}
          </dd>
        </div>
        <div>
          <dt className="opacity-70">Coverage</dt>
          <dd className="font-medium">{preview.coverageSummary}</dd>
        </div>
        <div>
          <dt className="opacity-70">Equipment</dt>
          <dd className="font-medium">
            {preview.equipmentNames.length > 0
              ? preview.equipmentNames.join(", ")
              : "None selected yet"}
          </dd>
        </div>
        <div>
          <dt className="opacity-70">Billing</dt>
          <dd className="font-medium">
            {preview.billingMethod} · {preview.paymentTerms}
          </dd>
        </div>
        {preview.notes ? (
          <div>
            <dt className="opacity-70">Notes</dt>
            <dd className="whitespace-pre-wrap">{preview.notes}</dd>
          </div>
        ) : null}
      </dl>

      {!compact ? (
        <ul className="mt-4 space-y-1 border-t border-base-300 pt-3 text-xs opacity-80">
          {preview.tierCoverages.slice(0, 5).map((item) => (
            <li key={item} className="flex gap-2">
              <span className="text-primary">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
