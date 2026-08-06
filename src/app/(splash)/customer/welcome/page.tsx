import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { homeForRole } from "@/lib/roles";
import { CustomerWelcomePageClient } from "./CustomerWelcomePageClient";

export default async function CustomerWelcomePage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "customer") redirect(homeForRole(profile.role));

  return <CustomerWelcomePageClient displayName={profile.full_name} />;
}
