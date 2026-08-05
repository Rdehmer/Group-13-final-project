"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { AddEquipmentModal } from "@/components/AddEquipmentModal";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatCard, StatusBadge, statusTone } from "@/components/ui";
import type { Equipment, Profile, WorkOrder } from "@/lib/types";

type ServiceKind = "repair" | "follow_up" | "routine";
type Timing = "asap" | "this_week" | "flexible";
type TimeOfDay = "morning" | "afternoon" | "either";
type WizardStep = "type" | "equipment" | "details" | "confirm";

type RequestForm = {
  service_kind: ServiceKind | "";
  equipment_id: string;
  preferred_date: string;
  timing: Timing;
  time_of_day: TimeOfDay;
  equipment_running: "yes" | "no" | "";
  details: string;
  contact_phone: string;
  access_notes: string;
};

const EMPTY_FORM: RequestForm = {
  service_kind: "",
  equipment_id: "",
  preferred_date: "",
  timing: "this_week",
  time_of_day: "either",
  equipment_running: "",
  details: "",
  contact_phone: "",
  access_notes: "",
};

const SERVICE_OPTIONS: {
  kind: ServiceKind;
  title: string;
  description: string;
  workOrderType: string;
  detailsPlaceholder: string;
}[] = [
  {
    kind: "repair",
    title: "One-off repair",
    description: "Something needs fixing now or soon — not part of a regular visit.",
    workOrderType: "Repair",
    detailsPlaceholder: "Describe the issue, symptoms, alarms, error codes, and when it started…",
  },
  {
    kind: "follow_up",
    title: "Follow-up visit",
    description: "Come back to finish work, re-check a repair, or continue an open issue.",
    workOrderType: "Follow-Up Service",
    detailsPlaceholder: "What should we re-check or finish? Include a prior work order number if you have one…",
  },
  {
    kind: "routine",
    title: "Routine check",
    description: "Schedule preventive maintenance or a wellness inspection.",
    workOrderType: "Preventive Maintenance",
    detailsPlaceholder: "Any areas to focus on, seasonal concerns, or units that need extra attention…",
  },
];

const TIMING_OPTIONS = [
  { value: "asap" as const, label: "As soon as possible" },
  { value: "this_week" as const, label: "This week if possible" },
  { value: "flexible" as const, label: "Next available is fine" },
];

const TIME_OF_DAY_OPTIONS = [
  { value: "morning" as const, label: "Morning" },
  { value: "afternoon" as const, label: "Afternoon" },
  { value: "either" as const, label: "Either is fine" },
];

const STEPS: WizardStep[] = ["type", "equipment", "details", "confirm"];

function resolveWorkOrderType(form: RequestForm): string {
  if (form.service_kind === "repair") {
    return form.equipment_running === "no" ? "Emergency Repair" : "Repair";
  }
  return SERVICE_OPTIONS.find((o) => o.kind === form.service_kind)?.workOrderType ?? "Follow-Up Service";
}

function resolvePriority(form: RequestForm): WorkOrder["priority"] {
  if (form.service_kind === "repair" && form.equipment_running === "no") {
    return form.timing === "asap" ? "Critical" : "High";
  }
  if (form.service_kind === "repair") {
    return form.timing === "asap" ? "High" : "Normal";
  }
  if (form.service_kind === "follow_up") {
    return form.timing === "asap" ? "High" : "Normal";
  }
  if (form.timing === "asap") return "Normal";
  if (form.timing === "flexible") return "Low";
  return "Low";
}

function timingLabel(timing: Timing) {
  return TIMING_OPTIONS.find((o) => o.value === timing)?.label ?? timing;
}

function timeOfDayLabel(value: TimeOfDay) {
  return TIME_OF_DAY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

function buildRequestedService(
  form: RequestForm,
  equipmentName: string | null,
  photoName: string | null,
  photoUrl: string | null,
): string {
  const option = SERVICE_OPTIONS.find((o) => o.kind === form.service_kind);
  const parts = [
    option ? `Request type: ${option.title}` : null,
    equipmentName ? `Equipment: ${equipmentName}` : "Equipment: General / unspecified",
    form.preferred_date ? `Preferred date: ${form.preferred_date}` : "Preferred date: not specified",
    `Timing: ${timingLabel(form.timing)}`,
    `Preferred time of day: ${timeOfDayLabel(form.time_of_day)}`,
    form.contact_phone.trim() ? `On-site contact phone: ${form.contact_phone.trim()}` : null,
    form.access_notes.trim() ? `Access notes: ${form.access_notes.trim()}` : null,
    form.service_kind === "repair" && form.equipment_running
      ? `Equipment currently running: ${form.equipment_running === "yes" ? "Yes" : "No"}`
      : null,
    form.details.trim() ? `Details: ${form.details.trim()}` : null,
    photoName ? `Photo attachment: ${photoName}` : null,
    photoUrl ? `Photo URL: ${photoUrl}` : null,
  ];
  return parts.filter(Boolean).join("\n");
}

/**
 * This business faces customer communication gap risk when service requests feel unclear or alarm-driven.
 * Our app reduces the risk with a guided request wizard, clear visit types, and a confirm-before-submit step.
 */
export default function CustomerPortalPage() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [contractCount, setContractCount] = useState(0);
  const [activeContractCount, setActiveContractCount] = useState(0);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [form, setForm] = useState<RequestForm>(EMPTY_FORM);
  const [step, setStep] = useState<WizardStep>("type");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [submittedWo, setSubmittedWo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAddEquipment, setShowAddEquipment] = useState(false);

  const loadData = useCallback(async (customerId: string) => {
    const [{ data: eq }, { data: wo }, { data: sc }] = await Promise.all([
      supabase.from("equipment").select("*").eq("customer_id", customerId).order("name"),
      supabase.from("work_orders").select("*").eq("customer_id", customerId).order("created_at", { ascending: false }),
      supabase.from("service_contracts").select("id, status").eq("customer_id", customerId),
    ]);
    setEquipment((eq as Equipment[]) ?? []);
    setWorkOrders((wo as WorkOrder[]) ?? []);
    const contracts = sc ?? [];
    setContractCount(contracts.length);
    setActiveContractCount(contracts.filter((c) => c.status === "Active").length);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).single();
      setProfile(p as Profile);
      if (!p?.customer_id) return;
      await loadData(p.customer_id);
      if (p.phone) {
        setForm((prev) => (prev.contact_phone ? prev : { ...prev, contact_phone: p.phone ?? "" }));
      }
    })();
  }, [loadData, supabase]);

  const selectedOption = SERVICE_OPTIONS.find((o) => o.kind === form.service_kind) ?? null;
  const selectedEquipment = useMemo(
    () => equipment.find((eq) => eq.id === form.equipment_id) ?? null,
    [equipment, form.equipment_id],
  );
  const stepIndex = STEPS.indexOf(step);

  function resetWizard() {
    setForm((prev) => ({
      ...EMPTY_FORM,
      contact_phone: prev.contact_phone || profile?.phone || "",
    }));
    setPhotoFile(null);
    setStep("type");
  }

  function validateStep(current: WizardStep): string | null {
    if (current === "type" && !form.service_kind) {
      return "Please choose what kind of visit you need.";
    }
    if (current === "equipment") {
      if (form.service_kind === "repair" && !form.equipment_id) {
        return "Please select the equipment that needs repair.";
      }
      if (form.service_kind === "repair" && !form.equipment_running) {
        return "Please tell us whether the equipment is still running.";
      }
    }
    if (current === "details") {
      if (!form.details.trim()) {
        return "Please add a short description so we know how to help.";
      }
      if (photoFile && photoFile.size > 5 * 1024 * 1024) {
        return "Photo must be 5 MB or smaller.";
      }
    }
    return null;
  }

  function goNext() {
    const problem = validateStep(step);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  }

  function goBack() {
    setError(null);
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  }

  async function uploadPhotoIfPresent(customerId: string, woNumber: string) {
    if (!photoFile) return { photoName: null as string | null, photoUrl: null as string | null };

    const safeName = photoFile.name.replace(/[^\w.\-]+/g, "_");
    const path = `${customerId}/${woNumber}-${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage
      .from("customer-request-attachments")
      .upload(path, photoFile, { upsert: false, contentType: photoFile.type || undefined });

    if (uploadError) {
      // Storage may not be configured yet; still record that the customer selected a photo.
      return { photoName: `${photoFile.name} (noted; upload unavailable)`, photoUrl: null };
    }

    const { data } = supabase.storage.from("customer-request-attachments").getPublicUrl(path);
    return { photoName: photoFile.name, photoUrl: data.publicUrl };
  }

  async function submitRequest() {
    if (!profile?.customer_id || !form.service_kind) return;
    const problem = validateStep("details") ?? validateStep("equipment") ?? validateStep("type");
    if (problem) {
      setError(problem);
      setStep(problem.includes("equipment") || problem.includes("running") ? "equipment" : problem.includes("visit") ? "type" : "details");
      return;
    }

    setBusy(true);
    setMessage(null);
    setSubmittedWo(null);
    setError(null);

    const woNumber = `WO-${Date.now().toString().slice(-8)}`;
    const { photoName, photoUrl } = await uploadPhotoIfPresent(profile.customer_id, woNumber);
    const priority = resolvePriority(form);
    const workOrderType = resolveWorkOrderType(form);
    const requestedService = buildRequestedService(
      form,
      selectedEquipment?.name ?? null,
      photoName,
      photoUrl,
    );

    const { data: { user } } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase.from("work_orders").insert({
      work_order_number: woNumber,
      customer_id: profile.customer_id,
      equipment_id: form.equipment_id || null,
      work_order_type: workOrderType,
      priority,
      problem_description: form.details.trim(),
      requested_service: requestedService,
      scheduled_date: form.preferred_date || null,
      status: "Requested",
      customer_approval_required: true,
    }).select().single();

    if (insertError) {
      setError(insertError.message);
      setBusy(false);
      return;
    }

    const preferredDate = form.preferred_date;

    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "service_request",
      recordType: "work_order",
      recordId: data.id,
      newValue: woNumber,
    });

    resetWizard();
    setSubmittedWo(woNumber);
    setMessage(
      preferredDate
        ? `Request ${woNumber} submitted. We'll review it and confirm a visit around your preferred date.`
        : `Request ${woNumber} submitted. A coordinator will review and schedule your visit.`,
    );
    await loadData(profile.customer_id);
    setBusy(false);
  }

  if (!profile) return <div className="p-8 text-center opacity-60">Loading…</div>;

  if (!profile.customer_id) {
    return (
      <EmptyState title="No customer account linked" description="Contact Ridley Equipment Services to link your portal account." />
    );
  }

  const openRequests = workOrders.filter((w) => !["Completed", "Closed", "Canceled"].includes(w.status)).length;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        title="My Portal"
        description={`Welcome, ${profile.full_name ?? profile.email}. Submit a service request below, or open a section for more detail.`}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link href="/customer/contracts" className="block rounded-box transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <StatCard label="My Contracts" value={contractCount} hint={`${activeContractCount} active · View →`} />
        </Link>
        <Link href="/customer/equipment" className="block rounded-box transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <StatCard label="Equipment" value={equipment.length} hint="View & register →" />
        </Link>
        <Link href="/customer/open-request" className="block rounded-box transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <StatCard label="Open Request" value={openRequests} hint="View status & stage →" />
        </Link>
        <Link href="/customer/order-history" className="block rounded-box transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <StatCard label="Order History" value={workOrders.length} hint="View history →" />
        </Link>
      </div>

      <div className="mx-auto max-w-2xl">
        <div className="card bg-base-100 shadow">
          <div className="card-body gap-4">
            <div>
              <h2 className="card-title text-base">Request Service</h2>
              <p className="text-sm opacity-70">Tell us what kind of visit you need!</p>
            </div>

            <ul className="steps steps-horizontal w-full text-xs sm:text-sm">
              <li className={`step ${stepIndex >= 0 ? "step-primary" : ""}`}>Type</li>
              <li className={`step ${stepIndex >= 1 ? "step-primary" : ""}`}>Equipment</li>
              <li className={`step ${stepIndex >= 2 ? "step-primary" : ""}`}>Details</li>
              <li className={`step ${stepIndex >= 3 ? "step-primary" : ""}`}>Confirm</li>
            </ul>

            {message ? (
              <div role="alert" className="alert alert-success text-sm">
                <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>{message}</span>
                  {submittedWo ? (
                    <Link href="/customer/open-request" className="btn btn-sm btn-primary">
                      Track this request
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}
            {error ? (
              <div role="alert" className="alert alert-error text-sm">
                <span>{error}</span>
              </div>
            ) : null}

            {step === "type" ? (
              <fieldset>
                <legend className="mb-2 text-sm font-medium">1. What do you need?</legend>
                <div className="grid gap-3">
                  {SERVICE_OPTIONS.map((option) => {
                    const selected = form.service_kind === option.kind;
                    return (
                      <label
                        key={option.kind}
                        className={`cursor-pointer rounded-box border p-4 transition ${
                          selected ? "border-primary bg-primary/10" : "border-base-300 hover:border-primary/40"
                        }`}
                      >
                        <input
                          type="radio"
                          name="service_kind"
                          className="radio radio-primary radio-sm mr-3 align-middle"
                          checked={selected}
                          onChange={() => {
                            setForm({
                              ...form,
                              service_kind: option.kind,
                              equipment_running: option.kind === "repair" ? form.equipment_running : "",
                            });
                            setError(null);
                          }}
                        />
                        <span className="align-middle font-medium">{option.title}</span>
                        <p className="mt-1 pl-8 text-sm opacity-70">{option.description}</p>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}

            {step === "equipment" ? (
              <div className="space-y-4">
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      2. Which equipment?
                      {form.service_kind === "repair" ? " *" : ""}
                    </p>
                    <button type="button" className="btn btn-ghost btn-xs" onClick={() => setShowAddEquipment(true)}>
                      Add equipment
                    </button>
                  </div>
                  {equipment.length === 0 ? (
                    <EmptyState
                      title="No equipment on file"
                      description="Register a unit so we can send the right technician."
                      action={
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowAddEquipment(true)}>
                          Add equipment
                        </button>
                      }
                    />
                  ) : (
                    <div className="grid gap-2">
                      {form.service_kind !== "repair" ? (
                        <label className={`cursor-pointer rounded-box border p-3 text-sm ${form.equipment_id === "" ? "border-primary bg-primary/10" : "border-base-300"}`}>
                          <input
                            type="radio"
                            name="equipment_id"
                            className="radio radio-primary radio-sm mr-2"
                            checked={form.equipment_id === ""}
                            onChange={() => setForm({ ...form, equipment_id: "" })}
                          />
                          General / site visit (no specific unit)
                        </label>
                      ) : null}
                      {equipment.map((eq) => (
                        <label
                          key={eq.id}
                          className={`flex cursor-pointer items-center justify-between gap-3 rounded-box border p-3 text-sm ${
                            form.equipment_id === eq.id ? "border-primary bg-primary/10" : "border-base-300"
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="equipment_id"
                              className="radio radio-primary radio-sm"
                              checked={form.equipment_id === eq.id}
                              onChange={() => setForm({ ...form, equipment_id: eq.id })}
                            />
                            <span>
                              <span className="font-medium">{eq.name}</span>
                              {eq.location ? <span className="block opacity-60">{eq.location}</span> : null}
                            </span>
                          </span>
                          <StatusBadge label={eq.operating_status} tone={statusTone(eq.operating_status)} />
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {form.service_kind === "repair" ? (
                  <fieldset>
                    <legend className="mb-2 text-sm font-medium">Is the equipment still running? *</legend>
                    <div className="flex flex-wrap gap-3">
                      <label className={`cursor-pointer rounded-box border px-4 py-3 text-sm ${form.equipment_running === "yes" ? "border-primary bg-primary/10" : "border-base-300"}`}>
                        <input
                          type="radio"
                          name="equipment_running"
                          className="radio radio-primary radio-sm mr-2"
                          checked={form.equipment_running === "yes"}
                          onChange={() => setForm({ ...form, equipment_running: "yes" })}
                        />
                        Yes — still operating
                      </label>
                      <label className={`cursor-pointer rounded-box border px-4 py-3 text-sm ${form.equipment_running === "no" ? "border-primary bg-primary/10" : "border-base-300"}`}>
                        <input
                          type="radio"
                          name="equipment_running"
                          className="radio radio-primary radio-sm mr-2"
                          checked={form.equipment_running === "no"}
                          onChange={() => setForm({ ...form, equipment_running: "no" })}
                        />
                        No — down or unsafe
                      </label>
                    </div>
                  </fieldset>
                ) : null}
              </div>
            ) : null}

            {step === "details" ? (
              <div className="space-y-4">
                <fieldset>
                  <legend className="mb-2 text-sm font-medium">3. When should we come?</legend>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {TIMING_OPTIONS.map((option) => (
                      <label
                        key={option.value}
                        className={`cursor-pointer rounded-box border px-3 py-3 text-sm ${
                          form.timing === option.value ? "border-primary bg-primary/10" : "border-base-300"
                        }`}
                      >
                        <input
                          type="radio"
                          name="timing"
                          className="radio radio-primary radio-sm mr-2"
                          checked={form.timing === option.value}
                          onChange={() => setForm({ ...form, timing: option.value })}
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                  <label className="form-control mt-3">
                    <span className="label-text text-sm opacity-70">Preferred date (optional)</span>
                    <input
                      type="date"
                      min={today}
                      className="input input-bordered w-full"
                      value={form.preferred_date}
                      onChange={(e) => setForm({ ...form, preferred_date: e.target.value })}
                    />
                  </label>
                  <div className="mt-3">
                    <p className="mb-2 text-sm opacity-70">Preferred time of day</p>
                    <div className="flex flex-wrap gap-2">
                      {TIME_OF_DAY_OPTIONS.map((option) => (
                        <label
                          key={option.value}
                          className={`cursor-pointer rounded-box border px-3 py-2 text-sm ${
                            form.time_of_day === option.value ? "border-primary bg-primary/10" : "border-base-300"
                          }`}
                        >
                          <input
                            type="radio"
                            name="time_of_day"
                            className="radio radio-primary radio-sm mr-2"
                            checked={form.time_of_day === option.value}
                            onChange={() => setForm({ ...form, time_of_day: option.value })}
                          />
                          {option.label}
                        </label>
                      ))}
                    </div>
                  </div>
                </fieldset>

                <FormRow label="On-site contact phone">
                  <input
                    type="tel"
                    className="input input-bordered w-full"
                    placeholder="Best number for the day of the visit"
                    value={form.contact_phone}
                    onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                  />
                </FormRow>

                <FormRow label="Access notes">
                  <textarea
                    className="textarea textarea-bordered w-full"
                    rows={2}
                    placeholder="Gate codes, loading dock, who to check in with…"
                    value={form.access_notes}
                    onChange={(e) => setForm({ ...form, access_notes: e.target.value })}
                  />
                </FormRow>

                <FormRow label="What should we know?" required>
                  <textarea
                    className="textarea textarea-bordered w-full"
                    rows={4}
                    placeholder={selectedOption?.detailsPlaceholder ?? "Add details…"}
                    value={form.details}
                    onChange={(e) => setForm({ ...form, details: e.target.value })}
                    required
                  />
                </FormRow>

                <FormRow label="Photo (optional)">
                  <input
                    type="file"
                    accept="image/*"
                    className="file-input file-input-bordered w-full"
                    onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                  />
                  <p className="mt-1 text-xs opacity-60">
                    Optional photo of the issue, nameplate, or error code (max 5 MB).
                    {photoFile ? ` Selected: ${photoFile.name}` : ""}
                  </p>
                </FormRow>
              </div>
            ) : null}

            {step === "confirm" ? (
              <div className="space-y-3 rounded-box bg-base-200/60 p-4 text-sm">
                <h3 className="font-semibold">Review your request</h3>
                <dl className="space-y-2">
                  <div className="flex justify-between gap-3">
                    <dt className="opacity-70">Visit type</dt>
                    <dd className="text-right font-medium">{selectedOption?.title}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="opacity-70">Equipment</dt>
                    <dd className="text-right font-medium">{selectedEquipment?.name ?? "General / site visit"}</dd>
                  </div>
                  {form.service_kind === "repair" ? (
                    <div className="flex justify-between gap-3">
                      <dt className="opacity-70">Still running?</dt>
                      <dd className="text-right font-medium">{form.equipment_running === "yes" ? "Yes" : "No — down/unsafe"}</dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-3">
                    <dt className="opacity-70">Timing</dt>
                    <dd className="text-right font-medium">{timingLabel(form.timing)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="opacity-70">Preferred date</dt>
                    <dd className="text-right font-medium">{form.preferred_date || "Not specified"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="opacity-70">Time of day</dt>
                    <dd className="text-right font-medium">{timeOfDayLabel(form.time_of_day)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="opacity-70">Contact phone</dt>
                    <dd className="text-right font-medium">{form.contact_phone.trim() || "Not provided"}</dd>
                  </div>
                  <div>
                    <dt className="opacity-70">Access notes</dt>
                    <dd className="mt-1 whitespace-pre-wrap">{form.access_notes.trim() || "None"}</dd>
                  </div>
                  <div>
                    <dt className="opacity-70">Details</dt>
                    <dd className="mt-1 whitespace-pre-wrap">{form.details.trim()}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="opacity-70">Photo</dt>
                    <dd className="text-right font-medium">{photoFile?.name ?? "None"}</dd>
                  </div>
                </dl>
              </div>
            ) : null}

            <div className="flex flex-wrap justify-between gap-2">
              {step === "type" ? (
                <span />
              ) : (
                <button type="button" className="btn btn-ghost" onClick={goBack} disabled={busy}>
                  Back
                </button>
              )}
              {step !== "confirm" ? (
                <button type="button" className="btn btn-primary" onClick={goNext}>
                  Continue
                </button>
              ) : (
                <button type="button" className="btn btn-primary" onClick={submitRequest} disabled={busy}>
                  {busy ? "Submitting…" : "Submit service request"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <AddEquipmentModal
        supabase={supabase}
        customerId={profile.customer_id}
        open={showAddEquipment}
        onClose={() => setShowAddEquipment(false)}
        onAdded={(item) => {
          setEquipment((prev) => [...prev, item].sort((a, b) => a.name.localeCompare(b.name)));
          setForm((prev) => ({ ...prev, equipment_id: item.id }));
        }}
      />
    </div>
  );
}
