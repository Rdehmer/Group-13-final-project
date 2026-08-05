"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ContractRequestForm } from "@/app/(app)/customer/request-contract/ContractRequestForm";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/ui";
import type { Equipment, Profile } from "@/lib/types";

export default function RequestContractPage() {
  const router = useRouter();
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [equipment, setEquipment] = useState<Equipment[]>([]);

  const reloadEquipment = useCallback(async (customerId: string) => {
    const { data: eq } = await supabase
      .from("equipment")
      .select("*")
      .eq("customer_id", customerId)
      .order("name");
    setEquipment((eq as Equipment[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
      if (!p?.customer_id) return;
      await reloadEquipment(p.customer_id);
    })();
  }, [reloadEquipment, supabase]);

  if (!profile) return <div className="p-8 text-center opacity-60">Loading…</div>;

  if (!profile.customer_id) {
    return (
      <EmptyState title="No customer account linked" description="Contact Ridley Equipment Services to link your portal account." />
    );
  }

  return (
    <div>
      <PageHeader
        title="Request a Service Contract"
        description="Start a maintenance or repair agreement. Ridley will review your request and confirm pricing before activation."
      />

      <div className="card bg-base-100 shadow">
        <div className="card-body">
          <ContractRequestForm
            supabase={supabase}
            customerId={profile.customer_id}
            equipment={equipment}
            onSuccess={() => router.push("/customer")}
            onEquipmentAdded={(item) => {
              setEquipment((prev) =>
                prev.some((e) => e.id === item.id)
                  ? prev
                  : [...prev, item].sort((a, b) => a.name.localeCompare(b.name)),
              );
            }}
          />
        </div>
      </div>
    </div>
  );
}
