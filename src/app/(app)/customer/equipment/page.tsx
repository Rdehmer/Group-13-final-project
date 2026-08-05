"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AddEquipmentModal } from "@/components/AddEquipmentModal";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import type { Equipment, Profile } from "@/lib/types";

/**
 * This business faces customer communication gap risk when equipment records are unclear.
 * Our app reduces the risk by letting customers view and register their equipment.
 */
export default function CustomerEquipmentPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddEquipment, setShowAddEquipment] = useState(false);

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
      const { data: eq } = await supabase
        .from("equipment")
        .select("*")
        .eq("customer_id", p.customer_id)
        .order("name");
      setEquipment((eq as Equipment[]) ?? []);
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
        title="My Equipment"
        description="Equipment registered to your account."
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowAddEquipment(true)}>
            Add Equipment
          </button>
        }
      />

      {equipment.length === 0 ? (
        <EmptyState
          title="No equipment on file"
          description="Register equipment to request service or include it in a contract."
          action={
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowAddEquipment(true)}>
              Add Equipment
            </button>
          }
        />
      ) : (
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <ul className="space-y-2">
              {equipment.map((eq) => (
                <li key={eq.id} className="flex items-center justify-between rounded-box bg-base-200 p-3 text-sm">
                  <div>
                    <p className="font-medium">{eq.name}</p>
                    <p className="opacity-60">
                      {[eq.manufacturer, eq.model, eq.location].filter(Boolean).join(" · ") || "No details on file"}
                    </p>
                  </div>
                  <StatusBadge label={eq.operating_status} tone={statusTone(eq.operating_status)} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <AddEquipmentModal
        supabase={supabase}
        customerId={profile.customer_id}
        open={showAddEquipment}
        onClose={() => setShowAddEquipment(false)}
        onAdded={(item) => setEquipment((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)))}
      />
    </div>
  );
}
