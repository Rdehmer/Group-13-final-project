import type { Equipment } from "@/lib/types";

export type EquipmentIdentityFields = Pick<
  Equipment,
  "name" | "model" | "serial_number" | "installation_date" | "manufacturer" | "location" | "category"
>;

/** Short label for selects: Name · Model · S/N · Installed */
export function equipmentLabel(eq: {
  name?: string | null;
  model?: string | null;
  serial_number?: string | null;
  installation_date?: string | null;
}): string {
  const bits = [eq.name || "Equipment"];
  if (eq.model) bits.push(`Model ${eq.model}`);
  if (eq.serial_number) bits.push(`S/N ${eq.serial_number}`);
  if (eq.installation_date) bits.push(`Installed ${eq.installation_date}`);
  return bits.join(" · ");
}

export function formatInstallDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso.includes("T") ? iso : `${iso}T12:00:00`).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export const EMPTY_EQUIPMENT_DRAFT: EquipmentIdentityFields = {
  name: "",
  model: null,
  serial_number: null,
  installation_date: null,
  manufacturer: null,
  location: null,
  category: null,
};
