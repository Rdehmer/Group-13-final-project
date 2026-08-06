import type { UserRole } from "@/lib/types";

/** Shared demo password (also shown on the login page). */
export const DEMO_PASSWORD = "DemoPass123!";

export type DemoPersona = {
  id: string;
  label: string;
  email: string;
  role: UserRole;
};

export const DEMO_PERSONAS: DemoPersona[] = [
  {
    id: "hot-customer",
    label: "Hot Customer",
    email: "customer2@ridley-demo.test",
    role: "customer",
  },
  {
    id: "contract-customer",
    label: "Contract Customer",
    email: "customer1@ridley-demo.test",
    role: "customer",
  },
  {
    id: "technician",
    label: "Technician",
    email: "tech1@ridley-demo.test",
    role: "technician",
  },
  {
    id: "manager",
    label: "Manager",
    email: "manager@ridley-demo.test",
    role: "service_manager",
  },
  {
    id: "billing",
    label: "Billing",
    email: "billing@ridley-demo.test",
    role: "billing",
  },
  {
    id: "vendor",
    label: "Vendor",
    email: "vendor1@ridley-demo.test",
    role: "vendor",
  },
  {
    id: "admin",
    label: "Admin",
    email: "admin@ridley-demo.test",
    role: "administrator",
  },
];

export function personaForEmail(email: string | null | undefined): DemoPersona | undefined {
  if (!email) return undefined;
  const normalized = email.trim().toLowerCase();
  return DEMO_PERSONAS.find((p) => p.email.toLowerCase() === normalized);
}
