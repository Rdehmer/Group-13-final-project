"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import type { Profile, ServiceContract } from "@/lib/types";

type ContractRow = ServiceContract & { equipment_count?: number };

/**
 * This business faces customer communication gap risk when agreements are hard to find.
 * Our app reduces the risk by giving customers a clear contracts view in their portal.
 */
export default function CustomerContractsPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [contracts, setContracts] = useState<ContractRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
      if (!p?.customer_id) {
        setLoading(false);
        return;
      }
      const [{ data: sc }, { data: ce }] = await Promise.all([
        supabase.from("service_contracts").select("*").eq("customer_id", p.customer_id).order("created_at", { ascending: false }),
        supabase.from("contract_equipment").select("contract_id"),
      ]);
      const countByContract = new Map<string, number>();
      for (const row of ce ?? []) {
        const id = row.contract_id as string;
        countByContract.set(id, (countByContract.get(id) ?? 0) + 1);
      }
      setContracts(
        ((sc as ServiceContract[]) ?? []).map((c) => ({
          ...c,
          equipment_count: countByContract.get(c.id) ?? 0,
        })),
      );
      setLoading(false);
    })();
  }, []);

  if (loading || !profile) return <div className="p-8 text-center opacity-60">Loading…</div>;

  if (!profile.customer_id) {
    return (
      <EmptyState title="No customer account linked" description="Contact Ridley Equipment Services to link your portal account." />
    );
  }

  return (
    <div>
      <PageHeader
        title="My Contracts"
        description="Review your service agreements and coverage."
        actions={
          <Link href="/customer/request-contract" className="btn btn-primary btn-sm">
            Request Contract
          </Link>
        }
      />

      {contracts.length === 0 ? (
        <EmptyState
          title="No contracts yet"
          description="Submit a contract request to start a new agreement."
          action={
            <Link href="/customer/request-contract" className="btn btn-primary btn-sm">
              Request Contract
            </Link>
          }
        />
      ) : (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Term</th>
                    <th>Equipment</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td>{c.contract_type}</td>
                      <td><StatusBadge label={c.status} tone={statusTone(c.status)} /></td>
                      <td>{c.start_date} — {c.end_date}</td>
                      <td>{c.equipment_count ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
