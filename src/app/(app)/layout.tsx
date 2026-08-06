import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { CustomerRatingGateProvider } from "@/contexts/CustomerRatingGateContext";
import { getProfile } from "@/lib/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return (
    <CustomerRatingGateProvider profile={profile}>
      <AppShell profile={profile}>{children}</AppShell>
    </CustomerRatingGateProvider>
  );
}
