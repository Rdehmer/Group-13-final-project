import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { WelcomePageClient } from "./WelcomePageClient";

export default async function WelcomePage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");

  return <WelcomePageClient displayName={profile.full_name} role={profile.role} />;
}
