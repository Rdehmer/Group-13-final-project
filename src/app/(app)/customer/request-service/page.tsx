"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/activity";
import { AddEquipmentModal } from "@/components/AddEquipmentModal";
import { PageHeader, FormRow } from "@/components/PageHeader";
import { EmptyState, StatusBadge, statusTone } from "@/components/ui";
import {
  CONTRACT_SERVICE_REQUEST_WAIT_DAYS,
  CONTRACT_START_DATE_ONE_OFF_TITLE,
  contractStartDateBlockMessage,
  findBlockingContractForServiceRequest,
  isContractStartDateBlockError,
  parseCustomerContracts,
  type CustomerContract,
} from "@/lib/contracts";
import {
  CUSTOMER_DELINQUENCY_LOCK_MESSAGE,
  DEFAULT_DELINQUENCY_GRACE_DAYS,
  customerIsDelinquencyLocked,
  findDelinquentMonthlyInvoices,
  isDelinquencyLockError,
  type DelinquencyLockPolicy,
  type DelinquentMonthlyInvoice,
} from "@/lib/contract-billing";
import type { Equipment, Invoice, Profile, WorkOrder } from "@/lib/types";
import type { WorkOrderType } from "@/lib/work-order-types";

type ServiceKind = "repair" | "follow_up" | "routine" | "emergency_repair";
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
  workOrderType: WorkOrderType;
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
  {
    kind: "emergency_repair",
    title: "Emergency repair",
    description: "Urgent breakdown — equipment is down or unsafe and needs immediate attention.",
    workOrderType: "Emergency Repair",
    detailsPlaceholder: "Describe the emergency, safety concerns, alarms, and when the unit went down…",
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

function isRepairLike(kind: ServiceKind | ""): boolean {
  return kind === "repair" || kind === "emergency_repair";
}

function resolveWorkOrderType(form: RequestForm): WorkOrderType {
  if (form.service_kind === "emergency_repair") return "Emergency Repair";
  if (form.service_kind === "repair") {
    return form.equipment_running === "no" ? "Emergency Repair" : "Repair";
  }
  return SERVICE_OPTIONS.find((o) => o.kind === form.service_kind)?.workOrderType ?? "Follow-Up Service";
}

function resolvePriority(form: RequestForm): WorkOrder["priority"] {
  if (form.service_kind === "emergency_repair") {
    return form.timing === "asap" ? "Critical" : "High";
  }
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
  oneOffOutsideContract: boolean,
): string {
  const option = SERVICE_OPTIONS.find((o) => o.kind === form.service_kind);
  const parts = [
    oneOffOutsideContract
      ? `Billing: ${CONTRACT_START_DATE_ONE_OFF_TITLE} — time & materials at standard rates (outside contract coverage)`
      : null,
    option ? `Request type: ${option.title}` : null,
    equipmentName ? `Equipment: ${equipmentName}` : "Equipment: General / unspecified",
    form.preferred_date ? `Preferred date: ${form.preferred_date}` : "Preferred date: not specified",
    `Timing: ${timingLabel(form.timing)}`,
    `Preferred time of day: ${timeOfDayLabel(form.time_of_day)}`,
    form.contact_phone.trim() ? `On-site contact phone: ${form.contact_phone.trim()}` : null,
    form.access_notes.trim() ? `Access notes: ${form.access_notes.trim()}` : null,
    isRepairLike(form.service_kind) && form.equipment_running
      ? `Equipment currently running: ${form.equipment_running === "yes" ? "Yes" : "No"}`
      : null,
    form.details.trim() ? `Details: ${form.details.trim()}` : null,
    photoName ? `Photo attachment: ${photoName}` : null,
    photoUrl ? `Photo URL: ${photoUrl}` : null,
  ];
  return parts.filter(Boolean).join("\n");
}

export default function RequestServicePage() {
  return (
    <Suspense fallback={<div className="p-8 text-center opacity-60">Loading…</div>}>
      <RequestServicePageInner />
    </Suspense>
  );
}

function RequestServicePageInner() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectEquipmentId = searchParams.get("equipment_id");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [contracts, setContracts] = useState<CustomerContract[]>([]);
  const [form, setForm] = useState<RequestForm>(EMPTY_FORM);
  const [step, setStep] = useState<WizardStep>("type");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showAddEquipment, setShowAddEquipment] = useState(false);
  const [customerPhone, setCustomerPhone] = useState("");
  const [appliedPreselect, setAppliedPreselect] = useState(false);
  const [oneOffOutsideContract, setOneOffOutsideContract] = useState(false);
  const [blockingContract, setBlockingContract] = useState<CustomerContract | null>(null);
  const [waitDays, setWaitDays] = useState(CONTRACT_SERVICE_REQUEST_WAIT_DAYS);
  const [delinquencyPolicy, setDelinquencyPolicy] = useState<DelinquencyLockPolicy>({
    enabled: true,
    graceDays: DEFAULT_DELINQUENCY_GRACE_DAYS,
  });
  const [delinquentInvoices, setDelinquentInvoices] = useState<DelinquentMonthlyInvoice[]>([]);
  const [delinquencyLocked, setDelinquencyLocked] = useState(false);

  const loadData = useCallback(async (customerId: string) => {
    const [{ data: eq }, { data: sc }, { data: customer }, { data: settings }, { data: inv }] =
      await Promise.all([
      supabase.from("equipment").select("*").eq("customer_id", customerId).order("name"),
      supabase
        .from("service_contracts")
        .select(`
          *,
          contract_equipment (
            equipment ( id, name, category, location )
          )
        `)
        .eq("customer_id", customerId),
      supabase.from("customers").select("phone").eq("id", customerId).single(),
      supabase
        .from("company_settings")
        .select(
          "contract_service_request_wait_days, delinquency_service_request_grace_days, delinquency_service_request_lock_enabled",
        )
        .limit(1)
        .maybeSingle(),
      supabase
        .from("invoices")
        .select("*")
        .eq("customer_id", customerId)
        .is("work_order_id", null)
        .gt("recurring_service_charge", 0),
    ]);
    setEquipment((eq as Equipment[]) ?? []);
    const parsedContracts = parseCustomerContracts(sc ?? []);
    setContracts(parsedContracts);
    const loadedWait = settings?.contract_service_request_wait_days;
    setWaitDays(
      typeof loadedWait === "number" && Number.isFinite(loadedWait)
        ? Math.max(0, Math.floor(loadedWait))
        : CONTRACT_SERVICE_REQUEST_WAIT_DAYS,
    );
    const policy: DelinquencyLockPolicy = {
      enabled: settings?.delinquency_service_request_lock_enabled ?? true,
      graceDays:
        typeof settings?.delinquency_service_request_grace_days === "number" &&
        Number.isFinite(settings.delinquency_service_request_grace_days)
          ? Math.max(0, Math.floor(settings.delinquency_service_request_grace_days))
          : DEFAULT_DELINQUENCY_GRACE_DAYS,
    };
    setDelinquencyPolicy(policy);
    const invoices = (inv as Invoice[]) ?? [];
    const delinquent = findDelinquentMonthlyInvoices(parsedContracts, invoices, policy.graceDays);
    setDelinquentInvoices(delinquent);
    setDelinquencyLocked(customerIsDelinquencyLocked(parsedContracts, invoices, policy));
    const phone = customer?.phone ?? "";
    setCustomerPhone(phone);
    if (phone) {
      setForm((prev) => (prev.contact_phone ? prev : { ...prev, contact_phone: phone }));
    }
    return (eq as Equipment[]) ?? [];
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
      const loadedEquipment = await loadData(p.customer_id);
      if (!appliedPreselect && preselectEquipmentId) {
        const match = loadedEquipment.find((eq) => eq.id === preselectEquipmentId);
        if (match) {
          setForm((prev) => ({ ...prev, equipment_id: match.id }));
          setStep("equipment");
          setAppliedPreselect(true);
        }
      }
    })();
  }, [appliedPreselect, loadData, preselectEquipmentId, supabase]);

  const selectedOption = SERVICE_OPTIONS.find((o) => o.kind === form.service_kind) ?? null;
  const selectedEquipment = useMemo(
    () => equipment.find((eq) => eq.id === form.equipment_id) ?? null,
    [equipment, form.equipment_id],
  );
  const stepIndex = STEPS.indexOf(step);

  function clearOneOffSelection() {
    setOneOffOutsideContract(false);
    setBlockingContract(null);
    setError(null);
  }

  function resetWizard() {
    setForm((prev) => ({
      ...EMPTY_FORM,
      contact_phone: prev.contact_phone || customerPhone || "",
    }));
    setPhotoFile(null);
    setStep("type");
    setOneOffOutsideContract(false);
    setBlockingContract(null);
  }

  function validateStep(current: WizardStep): string | null {
    if (current === "type" && !form.service_kind) {
      return "Please choose what kind of visit you need.";
    }
    if (current === "equipment") {
      if (isRepairLike(form.service_kind) && !form.equipment_id) {
        return "Please select the equipment that needs repair.";
      }
      if (isRepairLike(form.service_kind) && !form.equipment_running) {
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
      return { photoName: `${photoFile.name} (noted; upload unavailable)`, photoUrl: null };
    }

    const { data } = supabase.storage.from("customer-request-attachments").getPublicUrl(path);
    return { photoName: photoFile.name, photoUrl: data.publicUrl };
  }

  async function submitRequest(asOneOff?: boolean) {
    const useOneOff = typeof asOneOff === "boolean" ? asOneOff : oneOffOutsideContract;
    if (!profile?.customer_id || !form.service_kind) return;
    const problem = validateStep("details") ?? validateStep("equipment") ?? validateStep("type");
    if (problem) {
      setError(problem);
      setStep(
        problem.includes("equipment") || problem.includes("running")
          ? "equipment"
          : problem.includes("visit")
            ? "type"
            : "details",
      );
      return;
    }

    if (delinquencyLocked && delinquencyPolicy.enabled) {
      setError(CUSTOMER_DELINQUENCY_LOCK_MESSAGE);
      return;
    }

    const blocking = findBlockingContractForServiceRequest(
      contracts,
      form.equipment_id || null,
      waitDays,
    );
    if (blocking && !useOneOff) {
      setBlockingContract(blocking);
      setError(contractStartDateBlockMessage(waitDays));
      return;
    }

    setBusy(true);
    setError(null);
    setOneOffOutsideContract(useOneOff);
    if (useOneOff) setBlockingContract(blocking);

    const woNumber = `WO-${Date.now().toString().slice(-8)}`;
    const { photoName, photoUrl } = await uploadPhotoIfPresent(profile.customer_id, woNumber);
    const priority = resolvePriority(form);
    const workOrderType = resolveWorkOrderType(form);
    const requestedService = buildRequestedService(
      form,
      selectedEquipment?.name ?? null,
      photoName,
      photoUrl,
      useOneOff,
    );

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase
      .from("work_orders")
      .insert({
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
        outside_contract: useOneOff,
      })
      .select()
      .single();

    if (insertError) {
      if (isDelinquencyLockError(insertError.message)) {
        setDelinquencyLocked(true);
        setError(CUSTOMER_DELINQUENCY_LOCK_MESSAGE);
      } else if (isContractStartDateBlockError(insertError.message) && !useOneOff) {
        setBlockingContract(
          blocking ??
            findBlockingContractForServiceRequest(contracts, form.equipment_id || null, waitDays),
        );
        setError(contractStartDateBlockMessage(waitDays));
      } else {
        setError(insertError.message);
      }
      setBusy(false);
      return;
    }

    await logActivity(supabase, {
      userId: user?.id ?? null,
      action: "service_request",
      recordType: "work_order",
      recordId: data.id,
      newValue: woNumber,
    });

    setBusy(false);
    router.push(`/customer/open-request?highlight=${data.id}`);
  }

  async function submitAsOneOffCall() {
    setOneOffOutsideContract(true);
    setError(null);
    await submitRequest(true);
  }

  if (!profile) return <div className="p-8 text-center opacity-60">Loading…</div>;

  if (!profile.customer_id) {
    return (
      <EmptyState
        title="No customer account linked"
        description="Contact EquipmentIQ to link your portal account."
      />
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Request Service"
        description="Tell us what kind of visit you need. We'll review your request and confirm scheduling."
        actions={
          <Link href="/customer" className="btn btn-ghost btn-sm">
            ← Dashboard
          </Link>
        }
      />

      <div className="mx-auto max-w-2xl">
        <div className="card bg-base-100 shadow">
          <div className="card-body gap-4">
            <ul className="steps steps-horizontal w-full text-xs sm:text-sm">
              <li className={`step ${stepIndex >= 0 ? "step-primary" : ""}`}>Type</li>
              <li className={`step ${stepIndex >= 1 ? "step-primary" : ""}`}>Equipment</li>
              <li className={`step ${stepIndex >= 2 ? "step-primary" : ""}`}>Details</li>
              <li className={`step ${stepIndex >= 3 ? "step-primary" : ""}`}>Confirm</li>
            </ul>

            {delinquencyLocked && delinquencyPolicy.enabled ? (
              <div role="alert" className="alert alert-error text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <div className="flex w-full flex-col gap-3">
                  <div>
                    <p className="font-semibold">{CUSTOMER_DELINQUENCY_LOCK_MESSAGE}</p>
                    {delinquentInvoices[0] ? (
                      <p className="mt-1 opacity-80">
                        {delinquentInvoices[0].contractName ? (
                          <>
                            Contract <span className="font-medium">{delinquentInvoices[0].contractName}</span>
                            {" · "}
                          </>
                        ) : null}
                        Invoice {delinquentInvoices[0].invoiceNumber} was due{" "}
                        {delinquentInvoices[0].dueDate} ({delinquentInvoices[0].daysPastDue} days past due).
                        {delinquencyPolicy.graceDays > 0
                          ? ` Grace period is ${delinquencyPolicy.graceDays} days after the due date.`
                          : null}
                      </p>
                    ) : null}
                  </div>
                  <Link href="/customer/pay" className="btn btn-primary btn-sm w-fit">
                    Pay outstanding balance
                  </Link>
                </div>
              </div>
            ) : error && isContractStartDateBlockError(error) && !oneOffOutsideContract ? (
              <div role="alert" className="alert alert-warning text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <div className="flex w-full flex-col gap-3">
                  <div>
                    <p className="font-semibold">{error}</p>
                    {blockingContract ? (
                      <p className="mt-1 opacity-80">
                        Your contract <span className="font-medium">{blockingContract.name}</span> started on{" "}
                        {blockingContract.start_date}. Included contract visits aren&apos;t available during the first{" "}
                        {waitDays} days.
                      </p>
                    ) : null}
                  </div>
                  <div className="border-t border-warning/30 pt-3">
                    <p className="font-medium">Need service sooner?</p>
                    <p className="mt-1 opacity-80">
                      Submit a <strong>{CONTRACT_START_DATE_ONE_OFF_TITLE}</strong> — a billable visit outside your
                      contract coverage. Standard rates apply and this visit will not count toward included contract
                      visits.
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm mt-3"
                      onClick={submitAsOneOffCall}
                      disabled={busy}
                    >
                      {busy ? "Submitting…" : `Request ${CONTRACT_START_DATE_ONE_OFF_TITLE}`}
                    </button>
                  </div>
                </div>
              </div>
            ) : error ? (
              <div role="alert" className="alert alert-error text-sm">
                <span>{error}</span>
              </div>
            ) : null}
            {oneOffOutsideContract ? (
              <div role="status" className="alert alert-info text-sm">
                <span>
                  This request will be submitted as a <strong>{CONTRACT_START_DATE_ONE_OFF_TITLE}</strong> outside your
                  contract coverage. It will be billed time &amp; materials at standard rates.
                </span>
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
                              equipment_running: isRepairLike(option.kind) ? form.equipment_running : "",
                              timing: option.kind === "emergency_repair" ? "asap" : form.timing,
                            });
                            setError(null);
                            clearOneOffSelection();
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
                      {isRepairLike(form.service_kind) ? " *" : ""}
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm gap-1"
                      onClick={() => setShowAddEquipment(true)}
                    >
                      <Plus className="h-4 w-4" />
                      Add Equipment
                    </button>
                  </div>
                  {equipment.length === 0 ? (
                    <EmptyState
                      title="No equipment on file"
                      description="Register a unit so we can send the right technician."
                      action={
                        <button
                          type="button"
                          className="btn btn-primary btn-sm gap-1"
                          onClick={() => setShowAddEquipment(true)}
                        >
                          <Plus className="h-4 w-4" />
                          Add Equipment
                        </button>
                      }
                    />
                  ) : (
                    <div className="grid gap-2">
                      {!isRepairLike(form.service_kind) ? (
                        <label
                          className={`cursor-pointer rounded-box border p-3 text-sm ${form.equipment_id === "" ? "border-primary bg-primary/10" : "border-base-300"}`}
                        >
                          <input
                            type="radio"
                            name="equipment_id"
                            className="radio radio-primary radio-sm mr-2"
                            checked={form.equipment_id === ""}
                            onChange={() => {
                              setForm({ ...form, equipment_id: "" });
                              clearOneOffSelection();
                            }}
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
                              onChange={() => {
                                setForm({ ...form, equipment_id: eq.id });
                                clearOneOffSelection();
                              }}
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

                {isRepairLike(form.service_kind) ? (
                  <fieldset>
                    <legend className="mb-2 text-sm font-medium">Is the equipment still running? *</legend>
                    <div className="flex flex-wrap gap-3">
                      <label
                        className={`cursor-pointer rounded-box border px-4 py-3 text-sm ${form.equipment_running === "yes" ? "border-primary bg-primary/10" : "border-base-300"}`}
                      >
                        <input
                          type="radio"
                          name="equipment_running"
                          className="radio radio-primary radio-sm mr-2"
                          checked={form.equipment_running === "yes"}
                          onChange={() => setForm({ ...form, equipment_running: "yes" })}
                        />
                        Yes — still operating
                      </label>
                      <label
                        className={`cursor-pointer rounded-box border px-4 py-3 text-sm ${form.equipment_running === "no" ? "border-primary bg-primary/10" : "border-base-300"}`}
                      >
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
                  {oneOffOutsideContract ? (
                    <div className="flex justify-between gap-3">
                      <dt className="opacity-70">Billing</dt>
                      <dd className="text-right font-medium">{CONTRACT_START_DATE_ONE_OFF_TITLE} (outside contract)</dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-3">
                    <dt className="opacity-70">Visit type</dt>
                    <dd className="text-right font-medium">{selectedOption?.title}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="opacity-70">Equipment</dt>
                    <dd className="text-right font-medium">{selectedEquipment?.name ?? "General / site visit"}</dd>
                  </div>
                  {isRepairLike(form.service_kind) ? (
                    <div className="flex justify-between gap-3">
                      <dt className="opacity-70">Still running?</dt>
                      <dd className="text-right font-medium">
                        {form.equipment_running === "yes" ? "Yes" : "No — down/unsafe"}
                      </dd>
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
                <button type="button" className="btn btn-primary" onClick={() => void submitRequest()} disabled={busy || (delinquencyLocked && delinquencyPolicy.enabled)}>
                  {busy ? "Submitting…" : oneOffOutsideContract ? `Submit ${CONTRACT_START_DATE_ONE_OFF_TITLE}` : "Submit service request"}
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
