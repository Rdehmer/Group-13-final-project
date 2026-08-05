import Link from "next/link";
import { CheckCircle2, ListOrdered } from "lucide-react";

const DEMO_STEPS = [
  {
    role: "Admin / Manager",
    login: "admin@ridley-demo.test or manager@ridley-demo.test",
    path: "Dashboard → book/confirm a job → open job → attach equipment (model/serial/install)",
    href: "/work-orders",
  },
  {
    role: "Technician",
    login: "tech1@ridley-demo.test",
    path: "Technician schedule → arrive/start → labor + parts → New PO + receipt → Ready for Review",
    href: "/technician",
  },
  {
    role: "Billing",
    login: "billing@ridley-demo.test",
    path: "Billing → Ready to invoice → draft → status/assignee → PO/equipment → payments",
    href: "/billing",
  },
  {
    role: "Customer",
    login: "customer1@ridley-demo.test",
    path: "My Portal → review equipment & open a service request",
    href: "/customer",
  },
] as const;

/**
 * End-to-end demo checklist for presentation (managers on dashboard).
 */
export function DemoWalkthrough() {
  return (
    <section className="rounded-2xl border border-base-300/80 bg-base-100 p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <ListOrdered className="h-5 w-5 text-primary" />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-base-content/50">
            Presentation
          </p>
          <h2 className="text-base font-semibold tracking-tight">Demo walkthrough</h2>
        </div>
      </div>
      <p className="mb-3 text-sm text-base-content/65">
        Password for all demo users: <code className="rounded bg-base-200 px-1.5 py-0.5 text-xs">DemoPass123!</code>
        One presenter per role works best. Run{" "}
        <code className="rounded bg-base-200 px-1.5 py-0.5 text-xs">run_all_billing_features.sql</code> in Supabase
        once if assign/PO/equipment fields fail.
      </p>
      <ol className="space-y-3">
        {DEMO_STEPS.map((step, i) => (
          <li key={step.role} className="flex gap-3 rounded-xl bg-base-200/40 p-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-sm">{step.role}</p>
                <Link href={step.href} className="link link-primary text-xs">
                  Open
                </Link>
              </div>
              <p className="text-xs text-base-content/55">{step.login}</p>
              <p className="mt-1 text-sm text-base-content/80">{step.path}</p>
            </div>
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-base-content/25" />
          </li>
        ))}
      </ol>
    </section>
  );
}
