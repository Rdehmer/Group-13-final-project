"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ServiceHistoryWorkOrder } from "@/lib/invoices";
import {
  deferRatingWorkOrders,
  filterOutDeferredWorkOrders,
} from "@/lib/customer-rating-deferral";
import {
  fetchUnratedCompletedWorkOrders,
  shouldPromptForRating,
} from "@/lib/service-ratings";
import type { Profile } from "@/lib/types";
import { RateServiceModal } from "@/app/(app)/customer/order-history/RateServiceModal";

const CUSTOMER_HOME = "/customer";

type CustomerRatingGateContextValue = {
  isGateActive: boolean;
  pendingCount: number;
  activeWorkOrder: ServiceHistoryWorkOrder | null;
  refreshPending: () => Promise<void>;
  dismissRatingPrompt: () => void;
  blockNavigation: (event: MouseEvent<HTMLElement>) => void;
};

const CustomerRatingGateContext = createContext<CustomerRatingGateContextValue | null>(null);

export function useCustomerRatingGate(): CustomerRatingGateContextValue {
  const value = useContext(CustomerRatingGateContext);
  if (!value) {
    return {
      isGateActive: false,
      pendingCount: 0,
      activeWorkOrder: null,
      refreshPending: async () => {},
      dismissRatingPrompt: () => {},
      blockNavigation: () => {},
    };
  }
  return value;
}

export function CustomerRatingGateProvider({
  profile,
  children,
}: {
  profile: Profile;
  children: ReactNode;
}) {
  const isCustomer = profile.role === "customer" && profile.customer_id != null;

  if (!isCustomer) {
    return <>{children}</>;
  }

  return (
    <CustomerRatingGateProviderInner profile={profile}>
      {children}
    </CustomerRatingGateProviderInner>
  );
}

function CustomerRatingGateProviderInner({
  profile,
  children,
}: {
  profile: Profile;
  children: ReactNode;
}) {
  const supabase = createClient();
  const router = useRouter();
  const pathname = usePathname();
  const customerId = profile.customer_id!;

  const [pendingQueue, setPendingQueue] = useState<ServiceHistoryWorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const isGateActive = pendingQueue.length > 0;
  const activeWorkOrder = pendingQueue[0] ?? null;
  const pendingCount = pendingQueue.length;
  const shouldShowRatingPrompt =
    activeWorkOrder != null && shouldPromptForRating(activeWorkOrder);

  const refreshPending = useCallback(async () => {
    const unrated = await fetchUnratedCompletedWorkOrders(supabase, customerId);
    setPendingQueue(filterOutDeferredWorkOrders(customerId, unrated));
    setLoading(false);
  }, [customerId, supabase]);

  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  useEffect(() => {
    if (loading || !isGateActive) return;
    if (pathname !== CUSTOMER_HOME) {
      router.replace(CUSTOMER_HOME);
    }
  }, [isGateActive, loading, pathname, router]);

  useEffect(() => {
    if (loading || !isGateActive || !shouldShowRatingPrompt) {
      setModalOpen(false);
      return;
    }
    if (pathname === CUSTOMER_HOME) {
      setModalOpen(true);
    }
  }, [isGateActive, loading, pathname, shouldShowRatingPrompt]);

  function handleAlreadyRated(workOrderId: string) {
    setPendingQueue((prev) => prev.filter((wo) => wo.id !== workOrderId));
    void refreshPending();
  }

  function handleRated(workOrderId: string) {
    setPendingQueue((prev) => prev.filter((wo) => wo.id !== workOrderId));
    void refreshPending();
  }

  function handleModalClose() {
    setModalOpen(false);
  }

  const dismissRatingPrompt = useCallback(() => {
    if (pendingQueue.length === 0) {
      setModalOpen(false);
      return;
    }
    deferRatingWorkOrders(
      customerId,
      pendingQueue.map((wo) => wo.id),
    );
    setPendingQueue([]);
    setModalOpen(false);
  }, [customerId, pendingQueue]);

  function blockNavigation(event: MouseEvent<HTMLElement>) {
    if (!isGateActive) return;
    event.preventDefault();
    event.stopPropagation();
  }

  const value = useMemo(
    () => ({
      isGateActive,
      pendingCount,
      activeWorkOrder,
      refreshPending,
      dismissRatingPrompt,
      blockNavigation,
    }),
    [activeWorkOrder, blockNavigation, dismissRatingPrompt, isGateActive, pendingCount, refreshPending],
  );

  return (
    <CustomerRatingGateContext.Provider value={value}>
      {children}
      {activeWorkOrder && modalOpen && shouldShowRatingPrompt ? (
        <RateServiceModal
          open={modalOpen}
          required
          supabase={supabase}
          customerId={customerId}
          workOrder={activeWorkOrder}
          onClose={handleModalClose}
          onDismissLater={dismissRatingPrompt}
          onSubmitted={() => handleRated(activeWorkOrder.id)}
          onAlreadyRated={() => handleAlreadyRated(activeWorkOrder.id)}
        />
      ) : null}
    </CustomerRatingGateContext.Provider>
  );
}
