"use client";

import Link from "next/link";

type Props = {
  contractName: string;
};

export function ContractRequestSuccess({ contractName }: Props) {
  return (
    <div className="card bg-base-100 shadow">
      <div className="card-body gap-4 text-center sm:text-left">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-success/20 text-2xl text-success sm:mx-0">
          ✓
        </div>
        <div>
          <h2 className="text-xl font-bold">Contract request submitted</h2>
          <p className="mt-2 text-sm opacity-70">
            <span className="font-medium">{contractName}</span> is pending Ridley&apos;s review.
            Pricing will be confirmed before activation.
          </p>
        </div>

        <div className="rounded-box bg-base-200/60 p-4 text-left">
          <p className="mb-3 text-sm font-medium">What happens next</p>
          <ul className="steps steps-vertical w-full sm:steps-horizontal">
            <li className="step step-primary">Submitted</li>
            <li className="step">Ridley review</li>
            <li className="step">Activation</li>
          </ul>
        </div>

        <div className="flex flex-wrap justify-center gap-2 sm:justify-start">
          <Link href="/customer/contracts?filter=pending" className="btn btn-primary btn-sm">
            View in My Contracts
          </Link>
          <Link href="/customer" className="btn btn-outline btn-sm">
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
