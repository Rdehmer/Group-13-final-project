import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth";
import { homeForRole } from "@/lib/roles";
import { HomeLanding } from "@/components/home/HomeLanding";

export default async function HomePage() {
  const profile = await getProfile();
  if (profile) redirect(homeForRole(profile.role));

  return <HomeLanding />;
}
