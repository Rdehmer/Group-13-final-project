"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { InvoiceCashReport } from "@/components/InvoiceCashReport";
import type { Profile } from "@/lib/types";

/**
 * This business faces manager-only financial visibility risk when invoice reports are buried.
 * Our app reduces the risk by giving service managers a dedicated Invoice & Cash report in the nav.
 */
export default function InvoiceCashReportsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        router.replace("/login");
        return;
      }
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      const profileData = p as Profile | null;
      setProfile(profileData);
      if (
        profileData?.role !== "service_manager" &&
        profileData?.role !== "administrator"
      ) {
        router.replace("/reports");
        return;
      }
      setReady(true);
    })();
  }, [router]);

  if (
    !ready ||
    (profile?.role !== "service_manager" && profile?.role !== "administrator")
  ) {
    return <div className="p-8 text-center opacity-60">Loading…</div>;
  }

  return (
    <div>
      <PageHeader
        title="Invoice & Cash"
        description="Revenue recognition on completed work, with invoice, payment, and AR detail"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/reports" className="btn btn-ghost btn-sm">
              ← Financial Reports
            </Link>
            <Link href="/reports/contracts" className="btn btn-outline btn-sm">
              Contract profitability
            </Link>
          </div>
        }
      />
      <InvoiceCashReport />
    </div>
  );
}
