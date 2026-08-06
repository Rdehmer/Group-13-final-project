"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Mail, UserCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import type { Customer, Profile } from "@/lib/types";
import type { CustomerAddressFields } from "@/lib/customer-address";
import { formatCustomerPhone } from "@/lib/technician-field";
import { BusinessLocationCard, emptyBusinessLocationAddress } from "../BusinessLocationCard";

type CustomerAccount = Pick<
  Customer,
  | "name"
  | "primary_contact_name"
  | "email"
  | "phone"
  | "status"
  | "payment_terms"
  | "service_address"
  | "billing_address"
  | "city"
  | "state"
  | "zip_code"
>;

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs opacity-60">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

export default function CustomerAccountPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [customer, setCustomer] = useState<CustomerAccount | null>(null);
  const [customerAddress, setCustomerAddress] = useState<CustomerAddressFields>(
    emptyBusinessLocationAddress(),
  );

  const loadCustomer = useCallback(async (customerId: string) => {
    const { data } = await supabase
      .from("customers")
      .select(`
        name, primary_contact_name, email, phone, status, payment_terms,
        service_address, billing_address, city, state, zip_code
      `)
      .eq("id", customerId)
      .single();

    if (data) {
      setCustomer(data as CustomerAccount);
      setCustomerAddress({
        service_address: data.service_address,
        billing_address: data.billing_address,
        city: data.city,
        state: data.state,
        zip_code: data.zip_code,
      });
    }
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
      if (!p?.customer_id) return;
      await loadCustomer(p.customer_id);
    })();
  }, [loadCustomer, supabase]);

  if (!profile) return <div className="p-8 text-center opacity-60">Loading…</div>;

  if (!profile.customer_id) {
    return (
      <EmptyState
        title="No customer account linked"
        description="Contact EquipmentIQ to link your portal account."
      />
    );
  }

  if (!customer) return <div className="p-8 text-center opacity-60">Loading account…</div>;

  return (
    <div>
      <PageHeader
        title="Account Information"
        description="View your business account details on file with EquipmentIQ."
        actions={
          <Link href="/customer" className="btn btn-ghost btn-sm">
            ← Dashboard
          </Link>
        }
      />

      <div className="mx-auto max-w-3xl space-y-6">
        <div className="card bg-base-100 shadow">
          <div className="card-body gap-4">
            <div className="flex items-start gap-3">
              <div className="rounded-box bg-primary/10 p-2.5 text-primary">
                <Building2 className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="card-title text-base">{customer.name}</h2>
                  <StatusBadge label={customer.status} tone={statusTone(customer.status)} />
                </div>
                <p className="mt-1 text-sm opacity-70">
                  This is the business account EquipmentIQ uses for contracts, service, and billing.
                </p>
              </div>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <DetailRow
                label="Payment terms"
                value={customer.payment_terms?.trim() || "Standard terms"}
              />
            </dl>
          </div>
        </div>

        <div className="card bg-base-100 shadow">
          <div className="card-body gap-4">
            <div className="flex items-start gap-3">
              <div className="rounded-box bg-primary/10 p-2.5 text-primary">
                <Mail className="h-5 w-5" aria-hidden />
              </div>
              <div>
                <h2 className="card-title text-base">Contact information</h2>
                <p className="text-sm opacity-70">
                  Who EquipmentIQ should reach for scheduling and account questions.
                </p>
              </div>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <DetailRow
                label="Primary contact"
                value={customer.primary_contact_name?.trim() || "Not on file"}
              />
              <DetailRow label="Account email" value={customer.email?.trim() || "Not on file"} />
              <DetailRow
                label="Phone"
                value={
                  customer.phone?.trim()
                    ? formatCustomerPhone(customer.phone)
                    : "Not on file"
                }
              />
            </dl>
            <div role="status" className="alert alert-info text-sm">
              <span>
                To update contact details, message us in{" "}
                <Link href="/customer/inbox" className="link link-hover font-medium">
                  Inbox
                </Link>{" "}
                or call EquipmentIQ.
              </span>
            </div>
          </div>
        </div>

        <BusinessLocationCard address={customerAddress} onUpdated={setCustomerAddress} />

        <div className="card bg-base-100 shadow">
          <div className="card-body gap-4">
            <div className="flex items-start gap-3">
              <div className="rounded-box bg-primary/10 p-2.5 text-primary">
                <UserCircle className="h-5 w-5" aria-hidden />
              </div>
              <div>
                <h2 className="card-title text-base">Portal access</h2>
                <p className="text-sm opacity-70">
                  Your sign-in for this customer portal, separate from the account contact email above.
                </p>
              </div>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <DetailRow label="Name" value={profile.full_name?.trim() || "Not set"} />
              <DetailRow label="Login email" value={profile.email} />
            </dl>
          </div>
        </div>
      </div>
    </div>
  );
}
