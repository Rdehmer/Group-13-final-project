export type EquipmentCoverage = {
  covered: boolean;
  contractName?: string;
  contractType?: string;
  endDate?: string;
};

export type ContractEquipmentLink = {
  equipment_id: string;
  service_contracts:
    | {
        name: string;
        contract_type: string;
        status: string;
        start_date: string;
        end_date: string;
      }
    | {
        name: string;
        contract_type: string;
        status: string;
        start_date: string;
        end_date: string;
      }[]
    | null;
};

const CONTRACT_SELECT =
  "equipment_id, service_contracts(name, contract_type, status, start_date, end_date)";

function resolveContract(link: ContractEquipmentLink) {
  const raw = link.service_contracts;
  if (!raw) return null;
  return Array.isArray(raw) ? raw[0] ?? null : raw;
}

function isActiveCoverage(
  contract: {
    status: string;
    start_date: string;
    end_date: string;
  },
  today: string,
) {
  if (contract.status !== "Active") return false;
  return contract.start_date <= today && contract.end_date >= today;
}

/** Build a map of equipment_id → active contract coverage from contract_equipment join rows. */
export function buildCoverageMap(
  links: ContractEquipmentLink[] | null | undefined,
  today = new Date().toISOString().slice(0, 10),
): Map<string, EquipmentCoverage> {
  const coverageByEquipment = new Map<string, EquipmentCoverage>();
  for (const link of links ?? []) {
    const contract = resolveContract(link);
    if (!contract || !isActiveCoverage(contract, today)) continue;
    if (coverageByEquipment.get(link.equipment_id)?.covered) continue;
    coverageByEquipment.set(link.equipment_id, {
      covered: true,
      contractName: contract.name,
      contractType: contract.contract_type,
      endDate: contract.end_date,
    });
  }
  return coverageByEquipment;
}

export function coverageFor(
  map: Map<string, EquipmentCoverage>,
  equipmentId: string,
): EquipmentCoverage {
  return map.get(equipmentId) ?? { covered: false };
}

export const EQUIPMENT_COVERAGE_SELECT = CONTRACT_SELECT;

export type EquipmentContextFields = {
  id?: string;
  name: string | null;
  serial_number?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  location?: string | null;
  operating_status?: string | null;
  last_service_date?: string | null;
};

export const EQUIPMENT_CONTEXT_SELECT =
  "id, name, serial_number, manufacturer, model, location, operating_status, last_service_date";
