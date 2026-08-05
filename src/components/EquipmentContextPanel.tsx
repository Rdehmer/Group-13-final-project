import Link from "next/link";
import type { EquipmentContextFields } from "@/lib/equipmentCoverage";

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return value.slice(0, 10);
}

type Props = {
  equipment: EquipmentContextFields | null | undefined;
  /** When set (manager), name links to the equipment catalog with highlight. */
  catalogHref?: string | null;
};

/**
 * Shared on-site equipment identity for technician schedule and work order detail.
 */
export function EquipmentContextPanel({ equipment, catalogHref }: Props) {
  if (!equipment?.name) {
    return (
      <div className="rounded-box bg-base-200 p-3 text-sm">
        <p className="text-xs font-medium uppercase tracking-wide opacity-60">Equipment</p>
        <p className="mt-1">No equipment linked</p>
      </div>
    );
  }

  const makeModel = [equipment.manufacturer, equipment.model].filter(Boolean).join(" · ");
  const title = catalogHref ? (
    <Link href={catalogHref} className="link link-hover font-medium">
      {equipment.name}
    </Link>
  ) : (
    <p className="font-medium">{equipment.name}</p>
  );

  return (
    <div className="rounded-box bg-base-200 p-3 text-sm">
      <p className="text-xs font-medium uppercase tracking-wide opacity-60">Equipment</p>
      <div className="mt-1 space-y-1">
        {title}
        {makeModel ? <p className="opacity-70">{makeModel}</p> : null}
        <p>
          <span className="opacity-60">Serial:</span>{" "}
          <span className="font-mono text-xs">{equipment.serial_number ?? "—"}</span>
        </p>
        <p>
          <span className="opacity-60">Location:</span> {equipment.location ?? "—"}
        </p>
        {equipment.operating_status ? (
          <p>
            <span className="opacity-60">Status:</span> {equipment.operating_status}
          </p>
        ) : null}
        <p>
          <span className="opacity-60">Last service:</span> {formatDate(equipment.last_service_date)}
        </p>
      </div>
    </div>
  );
}
