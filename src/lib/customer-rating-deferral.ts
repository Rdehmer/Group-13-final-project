import type { ServiceHistoryWorkOrder } from "@/lib/invoices";

function storageKey(customerId: string): string {
  return `customer-rating-deferred:${customerId}`;
}

function readDeferredIds(customerId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(storageKey(customerId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function writeDeferredIds(customerId: string, ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(storageKey(customerId), JSON.stringify([...ids]));
  } catch {
    /* ignore quota / private browsing */
  }
}

export function getDeferredRatingWorkOrderIds(customerId: string): Set<string> {
  return readDeferredIds(customerId);
}

export function deferRatingWorkOrders(customerId: string, workOrderIds: string[]): void {
  if (workOrderIds.length === 0) return;
  const ids = readDeferredIds(customerId);
  for (const id of workOrderIds) ids.add(id);
  writeDeferredIds(customerId, ids);
}

export function filterOutDeferredWorkOrders<T extends Pick<ServiceHistoryWorkOrder, "id">>(
  customerId: string,
  workOrders: T[],
): T[] {
  const deferred = readDeferredIds(customerId);
  if (deferred.size === 0) return workOrders;
  return workOrders.filter((wo) => !deferred.has(wo.id));
}
